// Vai trợ lý chính (khoá SSH chỉ mở MCP) + dừng khẩn cấp qua Telegram (/agents, /dung, /mo).
//   node build/role-smoke.mjs <url Telegram giả> <owner id> <url cửa trước /mcp> <token bot2> <khoá cog> <đối số ssh…>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const [mock, owner, front, tokB, cogKey, ...ssh] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const messages = async () => (await (await fetch(`${mock}/_messages`)).json()).messages;
async function waitMessage(needle, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const hit = Object.entries(await messages()).find(([, m]) => m.text.includes(needle));
    if (hit) return { id: hit[0], ...hit[1] };
    await sleep(200);
  }
  return null;
}
const post = (path, body) => fetch(`${mock}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const press = (id, d) => post('/_press', { message_id: id, decision: d, from_id: Number(owner) });
const say = (text, from = owner) => post('/_send', { text, from_id: Number(from) });
const httpInit = async () => (await fetch(front, { method: 'POST', headers: { Authorization: `Bearer ${tokB}`, 'content-type': 'application/json',
  accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) })).status;

async function cog() {
  const c = new Client({ name: 'gia-danh-chu-may', version: '1' });
  // lệnh "bat-ky" bị authorized_keys phớt lờ: khoá này chỉ chạy được `axle mcp --as cog`
  await c.connect(new StdioClientTransport({ command: 'ssh', args: ['-i', cogKey, ...ssh, 'bat-ky'], stderr: 'ignore' }));
  const call = async (name, args = {}) => {
    try { const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }); return { err: !!r.isError, text: r.content[0].text }; }
    catch (e) { return { err: true, text: e.message }; }
  };
  return { c, call };
}

// ---- trợ lý chính ----
let A = await cog();
ok((await A.c.listTools()).tools.length === 22, 'trợ lý chính thấy đủ 22 công cụ của chủ');
ok(!(await A.call('system_status')).err, 'system_status chạy bằng quyền chủ');
ok((await A.call('file_read', { path: '~/work/smoke.txt' })).text.includes('dong 1'), 'đọc được file của chủ (không cần hỏi)');
ok((await A.call('file_read', { path: '~/.ssh/authorized_keys' })).err, 'vẫn KHÔNG đọc được vùng bí mật (~/.ssh)');
let p = A.call('run_command', { command: 'whoami', waitSec: 60 });
let m = await waitMessage('Agent: ssh:cog');
ok(m && m.text.includes('bằng user admin_1'), 'tin duyệt ghi Agent: ssh:cog (theo khoá, không theo tên tự khai), chạy bằng quyền chủ');
await press(m.id, 'a');
ok((await p).text.includes('\nadmin_1'), '"làm thay chủ có duyệt": lệnh chạy bằng admin_1');
const au = (await A.call('audit_recent', { lines: 20 })).text;
ok(au.includes('"client":"ssh:cog"') && !au.includes('gia-danh-chu-may'), 'nhật ký ghi ssh:cog, bỏ tên tự khai');

// ---- Telegram: /agents, /dung, /mo ----
await say('/agents');
m = await waitMessage('trợ lý chính (quyền của admin_1');
ok(m && m.text.includes('bot2 · agent phụ'), '/agents liệt kê trợ lý chính + agent phụ');

ok(await httpInit() === 200, 'bot2 đang gọi được');
await say('/dung bot2', 999999);
await sleep(5000);
ok(await httpInit() === 200, 'người lạ nhắn /dung → bị bỏ qua');
await say('/dung bot2');
ok(!!(await waitMessage('⛔ Đã dừng bot2')), 'chủ nhắn /dung bot2 → bot xác nhận');
ok(await httpInit() === 403, 'bot2 bị chặn ngay (403)');
await say('/mo bot2');
ok(!!(await waitMessage('▶ Đã mở lại bot2')), '/mo bot2 → bot xác nhận');
await sleep(1000);
ok(await httpInit() === 200, 'bot2 gọi lại được');

// Dừng trợ lý chính GIỮA phiên, lúc nó đang có yêu cầu chờ duyệt
const pend = await A.call('run_command', { command: 'echo con-cho-duyet', waitSec: 0 });
const pendMsg = await waitMessage('echo con-cho-duyet');
let closed = false;
A.c.onclose = () => { closed = true; };
await say('/dung cog');
ok(!!(await waitMessage('⛔ Đã dừng cog')), 'chủ nhắn /dung cog → bot xác nhận');
for (let i = 0; i < 30 && !closed; i++) await sleep(200);
ok(closed, 'phiên đang chạy của cog bị ngắt ngay');
await sleep(4000);
ok((await messages())[pendMsg.id].edits.some((e) => e.includes('⛔ Agent đã bị dừng khẩn cấp')), `yêu cầu đang chờ của cog (${pend.text.slice(0, 20)}…) bị huỷ`);
let refused = false;
try { const B = await cog(); await B.c.listTools(); await B.c.close(); } catch { refused = true; }
ok(refused, 'cog mở phiên mới → bị từ chối khi đang tạm dừng');
await say('/mo cog');
ok(!!(await waitMessage('▶ Đã mở lại cog')), '/mo cog → bot xác nhận');
A = await cog();
ok((await A.c.listTools()).tools.length === 22, 'cog dùng lại được');
await A.c.close();

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ vai trợ lý chính + dừng khẩn cấp đạt');
