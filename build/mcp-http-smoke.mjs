// Thử agent riêng qua cổng MCP HTTP: mỗi agent một user, chỉ thấy home của chính nó.
//   node build/mcp-http-smoke.mjs <url /mcp> <token agent A (preset files)> <token agent B (preset files)>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const [url, tokA, tokB] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const connect = async (token) => {
  const c = new Client({ name: 'khai-ten-gia', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
};
const call = async (c, name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content[0].text }; }
  catch (e) { return { err: true, text: e.message }; }
};

ok((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401, 'không token → 401');

const A = await connect(tokA);
const B = await connect(tokB);
const names = (await A.listTools()).tools.map((t) => t.name).sort().join(',');
ok(names === 'file_list,file_read,file_search,file_write,service_status,system_status', `preset files thấy đúng 6 công cụ: ${names}`);
ok(!(await call(A, 'system_status')).err, 'system_status chạy trong hộp cát của agent');
ok(!(await call(A, 'service_status', { unit: 'ssh' })).err, 'service_status (hỏi systemd qua D-Bus) chạy được');

const w = await call(A, 'file_write', { path: '~/work/a.txt', content: 'cua agent A', mode: 'overwrite' });
ok(!w.err && w.text.includes('/home/ag-testbot/work/a.txt'), 'agent A ghi vào ĐÚNG home của nó (/home/ag-testbot)');
ok((await call(A, 'file_read', { path: '~/work/a.txt' })).text.includes('cua agent A'), 'agent A đọc lại được file của nó');
ok(!(await call(B, 'file_write', { path: '~/work/b.txt', content: 'cua agent B', mode: 'overwrite' })).err, 'agent B ghi file của nó');

ok((await call(A, 'file_read', { path: '/home/ag-bot2/work/b.txt' })).err, 'agent A KHÔNG đọc được file của agent B');
ok((await call(A, 'file_read', { path: '/home/admin_1/work/smoke.txt' })).err, 'agent A KHÔNG đọc được home của chủ (admin_1)');
ok((await call(A, 'file_list', { path: '/home' })).err, 'lớp 1 (luật vùng file): agent không liệt kê được /home');

await A.close();
await B.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ agent riêng qua cổng HTTP đạt');
