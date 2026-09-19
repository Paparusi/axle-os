// Thử duyệt qua Telegram (dùng Telegram giả build/tg-mock.py). Agent gọi qua SSH như thật; bài thử giả làm chủ bấm nút.
//   node build/approve-smoke.mjs <url Telegram giả> <owner id> <đối số ssh…>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const [mock, owner, ...ssh] = process.argv.slice(2);
const client = new Client({ name: 'approve-smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: 'ssh', args: [...ssh, 'axle', 'mcp'], stderr: 'inherit' }));

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (name, args) => {
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
    return { err: !!r.isError, text: r.content.map((c) => c.text).join('\n') };
  } catch (e) { return { err: true, text: e.message }; }
};
const messages = async () => (await (await fetch(`${mock}/_messages`)).json());
async function waitMessage(needle) {
  for (let i = 0; i < 100; i++) {
    const hit = Object.entries((await messages()).messages).find(([, m]) => m.text.includes(needle));
    if (hit) return { id: hit[0], ...hit[1] };
    await sleep(200);
  }
  throw new Error(`Không thấy tin nhắn chứa ${needle}`);
}
const press = (id, decision, from = owner) => fetch(`${mock}/_press`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message_id: id, decision, from_id: Number(from) }) });

// run_command đã gửi đi (chưa chờ) → đợi kết quả qua approval_status
async function approvalOut(pending) {
  const first = await pending;
  const id = first.text.match(/#([0-9a-f]{8})/)?.[1];
  return first.text.startsWith('⏳') ? call('approval_status', { id, waitSec: 60 }) : first;
}
let p2, m2;

// 1. Chủ duyệt → chạy đúng lệnh, bằng user agent
let p = call('run_command', { command: 'touch ~/work/duyet.txt && echo da-chay && whoami', waitSec: 60 });
let m = await waitMessage('duyet.txt');
ok(m.text.includes('Agent: approve-smoke') && m.text.includes('bằng user admin_1') && m.text.includes('touch ~/work/duyet.txt'),
  'tin Telegram ghi rõ agent, user chạy, lệnh đầy đủ');
await press(m.id, 'a');
let r = await p;
ok(r.text.startsWith('✅ Đã duyệt và chạy xong') && r.text.includes('da-chay') && r.text.includes('admin_1'), 'chủ duyệt → chạy xong, bằng admin_1');
ok((await messages()).messages[m.id].edits.some((e) => e.includes('xong')), 'tin Telegram được sửa thành kết quả');

// 2. Chủ từ chối → không chạy
p = call('run_command', { command: 'touch ~/work/tuchoi.txt', waitSec: 60 });
m = await waitMessage('tuchoi.txt');
await press(m.id, 'r');
r = await p;
ok(r.text.startsWith('❌ Chủ đã từ chối'), 'chủ từ chối → báo từ chối');
ok((await call('file_read', { path: '~/work/tuchoi.txt' })).text.includes('Không tồn tại'), 'lệnh bị từ chối KHÔNG chạy');

// 3. Người lạ bấm duyệt → bị bỏ qua, vẫn chờ
r = await call('run_command', { command: 'touch ~/work/nguoila.txt', waitSec: 0 });
const id = r.text.match(/#([0-9a-f]{8})/)?.[1];
m = await waitMessage('nguoila.txt');
await press(m.id, 'a', 999999);
await sleep(3000);
r = await call('approval_status', { id, waitSec: 0 });
ok(r.text.startsWith('⏳'), 'người lạ bấm duyệt → bị bỏ qua, vẫn đang chờ');
await press(m.id, 'r');
r = await call('approval_status', { id, waitSec: 10 });
ok(r.text.startsWith('❌'), 'approval_status theo dõi được tới khi chủ quyết');
ok((await call('file_read', { path: '~/work/nguoila.txt' })).text.includes('Không tồn tại'), 'lệnh người lạ "duyệt" KHÔNG chạy');

// 4. Lệnh root → tin nhắn cảnh báo ROOT
p = call('run_command', { command: 'id -u', asRoot: true, waitSec: 60 });
m = await waitMessage('id -u');
ok(m.text.includes('⚠️ BẰNG QUYỀN ROOT'), 'lệnh root có cảnh báo ⚠️ ROOT trong tin nhắn');
await press(m.id, 'a');
r = await p;
ok(r.text.startsWith('✅') && /\n0\s*$/.test(r.text), 'lệnh root chạy bằng root (id -u = 0)');

// 5. Khởi động lại dịch vụ
p = call('service_restart', { unit: 'cron', waitSec: 60 });
m = await waitMessage('khởi động lại dịch vụ cron');
await press(m.id, 'a');
r = await p;
ok(r.text.startsWith('✅') && r.text.includes('active'), 'service_restart sau khi duyệt → dịch vụ chạy lại');
ok((await call('service_restart', { unit: 'cron; rm -rf /' })).err, 'tên dịch vụ có ký tự lạ bị chặn ngay, không gửi xin');

// 6. Bấm lại nút của yêu cầu đã xong → không chạy lần 2
const before = (await messages()).messages[m.id].edits.length;
await press(m.id, 'a');
await sleep(3000);
ok((await messages()).messages[m.id].edits.length === before, 'bấm lại nút cũ → không chạy lần nữa');

// 7. Không ai bấm → hết hạn (máy thử đặt 15 giây)
r = await call('run_command', { command: 'touch ~/work/hethan.txt', waitSec: 30 });
ok(r.text.startsWith('⌛'), 'không ai bấm → hết hạn, không chạy');
ok((await call('file_read', { path: '~/work/hethan.txt' })).text.includes('Không tồn tại'), 'lệnh hết hạn KHÔNG chạy');

// 9. Xoá file → vào thùng rác
await call('file_write', { path: '~/work/xoa.txt', content: 'rac', mode: 'overwrite' });
p = call('file_delete', { path: '~/work/xoa.txt', waitSec: 60 });
m = await waitMessage('xoá (chuyển vào thùng rác) /home/admin_1/work/xoa.txt');
ok(m.text.includes('Loại: file, 3 byte'), 'tin xin xoá ghi rõ đường dẫn thật + loại + dung lượng');
await press(m.id, 'a');
r = await p;
ok(r.text.startsWith('✅') && r.text.includes('.local/share/axle-trash/'), 'duyệt xoá → chuyển vào thùng rác');
ok((await call('file_read', { path: '~/work/xoa.txt' })).text.includes('Không tồn tại'), 'file đã rời chỗ cũ');
ok((await call('file_delete', { path: '~/.ssh/authorized_keys' })).text.includes('bảo vệ'), 'xoá trong ~/.ssh bị chặn ngay, không gửi xin');
ok((await call('file_delete', { path: '/etc/passwd' })).text.includes('Chỉ xoá trong'), 'xoá ngoài home bị chặn ngay');
ok((await call('file_delete', { path: '~/.local' })).text.includes('bảo vệ'), 'xoá thư mục CHA của vùng bảo vệ cũng bị chặn');

// 10. Undo snapshot: chỉ đảo đúng các thay đổi chủ đã thấy lúc xin
const snap = Number((await call('snapshot_create', { description: 'trước khi thử undo' })).text.match(/#(\d+)/)[1]);
p = call('run_command', { command: 'touch /etc/axle-undo-mcp', asRoot: true, waitSec: 60 });
m = await waitMessage('touch /etc/axle-undo-mcp');
await press(m.id, 'a');
await p;
p = call('snapshot_undo', { number: snap, waitSec: 60 });
m = await waitMessage(`như snapshot #${snap}`);
ok(m.text.includes('/etc/axle-undo-mcp') && /\d+ thay đổi sẽ bị đảo lại/.test(m.text), 'tin xin undo liệt kê đúng file sẽ bị đảo');
ok(!m.text.includes('/var/log'), 'undo không cuốn theo nhật ký (/var/log nằm ngoài snapshot)');
p2 = call('run_command', { command: 'touch /etc/axle-sau-khi-xin', asRoot: true, waitSec: 60 });
m2 = await waitMessage('touch /etc/axle-sau-khi-xin');
await press(m2.id, 'a');
await p2;
await press(m.id, 'a');
r = await p;
ok(r.text.startsWith('✅') && r.text.includes('Muốn quay lại như trước khi undo: snapshot_undo'), 'duyệt undo → chạy, kèm cách quay ngược');
const chk = call('run_command', { command: 'ls /etc/axle-undo-mcp /etc/axle-sau-khi-xin 2>&1; true', asRoot: true, waitSec: 60 });
m = await waitMessage('ls /etc/axle-undo-mcp');
await press(m.id, 'a');
const lsOut = (await approvalOut(chk)).text;
ok(lsOut.includes("cannot access '/etc/axle-undo-mcp'"), 'thay đổi chủ đã thấy → bị đảo');
ok(/\n\/etc\/axle-sau-khi-xin/.test(lsOut), 'thay đổi xảy ra SAU lúc xin → giữ nguyên');

// 8. Token bot đi qua vault, dịch vụ duyệt không cầm
const tokens = (await messages()).tokens;
ok(tokens.length === 1 && !tokens[0].includes('{{') && tokens[0] === process.env.AXLE_TEST_TG_TOKEN, 'Telegram nhận đúng token do vault điền');

await client.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ duyệt qua Telegram đạt');
