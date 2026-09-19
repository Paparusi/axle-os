// Agent riêng dùng vault + xin duyệt, danh tính theo socket riêng của agent.
//   node build/agent-full-smoke.mjs <url /mcp> <token agent bot2 (preset full)> <url Telegram giả> <owner id> <khoá TEST_TOKEN>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const [url, token, mock, owner, testSecret] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = new Client({ name: 'xung-la-chu-may', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const call = async (name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 180_000 }); return { err: !!r.isError, text: r.content[0].text }; }
  catch (e) { return { err: true, text: e.message }; }
};
const messages = async () => (await (await fetch(`${mock}/_messages`)).json()).messages;
async function waitMessage(needle) {
  for (let i = 0; i < 100; i++) {
    const hit = Object.entries(await messages()).find(([, m]) => m.text.includes(needle));
    if (hit) return { id: hit[0], ...hit[1] };
    await sleep(200);
  }
  throw new Error(`Không thấy tin nhắn chứa ${needle}`);
}
const press = (id, d) => fetch(`${mock}/_press`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message_id: id, decision: d, from_id: Number(owner) }) });

const tools = (await c.listTools()).tools.map((t) => t.name);
ok(tools.includes('http_request') && tools.includes('run_command') && !tools.includes('snapshot_undo') && !tools.includes('docker_ps'),
  'preset full: có vault + duyệt, KHÔNG có snapshot_undo / Docker');

// Vault: chỉ thấy + dùng khoá được cấp cho mình
const vl = (await call('vault_list')).text;
ok(vl.includes('TEST_TOKEN') && !vl.includes('AXLE_TG_TOKEN'), 'vault_list chỉ có khoá được cấp cho agent (không thấy token bot)');
const hr = await call('http_request', { url: 'http://localhost:8088/echo', headers: { Authorization: 'Bearer {{secret.TEST_TOKEN}}' } });
ok(!hr.err && hr.text.startsWith('HTTP 200') && !hr.text.includes(testSecret), 'dùng được khoá được cấp, giá trị vẫn bị ẩn');
const stolen = await call('http_request', { url: 'http://localhost:8088/echo', headers: { Authorization: '{{secret.AXLE_TG_TOKEN}}' } });
ok(stolen.err && stolen.text.includes('Không có khoá AXLE_TG_TOKEN'), 'KHÔNG dùng được khoá không cấp (token bot) — như thể không tồn tại');

// Duyệt: lệnh chạy bằng user agent, trong hộp cát
let p = call('run_command', { command: 'whoami; echo "HOME=$HOME"; ls /home', waitSec: 60 });
let m = await waitMessage('whoami; echo');
ok(m.text.includes('Agent: http:bot2 (user ag-bot2)'), 'tin Telegram ghi danh tính theo socket (không theo tên tự khai)');
ok(m.text.includes('bằng user ag-bot2, hộp cát'), 'tin Telegram ghi rõ chạy bằng user agent trong hộp cát');
await press(m.id, 'a');
let r = await p;
ok(r.text.startsWith('✅') && r.text.includes('\nag-bot2\n') && r.text.includes('HOME=/home/ag-bot2'), 'lệnh đã duyệt chạy bằng ag-bot2, HOME của nó');
ok(/\/home\/ag-bot2\n\s*ag-bot2\s*$/.test(r.text) || /\nag-bot2\s*$/.test(r.text), 'trong hộp cát, ls /home chỉ thấy ag-bot2');

ok((await call('run_command', { command: 'ls', cwd: '/home/admin_1' })).text.includes('Agent chỉ chạy lệnh trong /home/ag-bot2'),
  'xin chạy lệnh trong home chủ máy → bị chặn ngay, không gửi xin');

// Xoá file trong home của agent → thùng rác của agent
p = call('file_delete', { path: '~/work/b.txt', waitSec: 60 });
m = await waitMessage('/home/ag-bot2/work/b.txt');
await press(m.id, 'a');
r = await p;
ok(r.text.startsWith('✅') && r.text.includes('/home/ag-bot2/.local/share/axle-trash/'), 'file_delete của agent vào thùng rác của CHÍNH agent');

await c.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ agent riêng dùng vault + duyệt đạt');
