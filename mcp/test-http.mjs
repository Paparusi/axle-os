// Thử cổng MCP HTTP tại chỗ: cửa trước (front.js) + máy chủ riêng từng agent (http.js). `npm test`.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const D = mkdtempSync(path.join(tmpdir(), 'axle-http-'));
const SOCKS = path.join(D, 'socks');
mkdirSync(SOCKS);
const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL_ = `http://127.0.0.1:${PORT}/mcp`;
const tok = () => `axle_${randomBytes(24).toString('base64url')}`;
const T = { status: tok(), writer: tok(), ghost: tok() };
const hash = (t) => createHash('sha256').update(t).digest('hex');
writeFileSync(path.join(D, 'clients.json'), JSON.stringify({
  status: { hash: hash(T.status), tools: ['system_status'] },
  writer: { hash: hash(T.writer), tools: ['system_status', 'file_write'] },
  ghost: { hash: hash(T.ghost), tools: ['system_status'] },       // không có máy chủ đang chạy
}));

const out = { front: '', status: '', writer: '' };
const start = (name, file, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(import.meta.dirname, file)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => { out[name] += d; });
  p.stderr.on('data', () => resolve(p));
  setTimeout(() => resolve(p), 1500);
  return p;
});
const procs = [
  await start('status', 'http.js', { AXLE_CLIENT: 'status', AXLE_MCP_BACKEND_SOCKET: path.join(SOCKS, 'status.sock'), AXLE_AUDIT: '-' }),
  await start('writer', 'http.js', { AXLE_CLIENT: 'writer', AXLE_MCP_BACKEND_SOCKET: path.join(SOCKS, 'writer.sock'), AXLE_AUDIT: '-' }),
  await start('front', 'front.js', { AXLE_MCP_HTTP_PORT: String(PORT), AXLE_MCP_CLIENTS: path.join(D, 'clients.json'), AXLE_MCP_SOCK_DIR: SOCKS }),
];

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const connect = async (token, extra = {}) => {
  const c = new Client({ name: 'ten-tu-khai', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${token}`, ...extra } } }));
  return c;
};
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } };
const post = (headers, body = JSON.stringify(init)) => fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });

ok((await post({})).status === 401, 'không token → 401');
ok((await post({ Authorization: `Bearer ${tok()}` })).status === 401, 'token lạ → 401');
ok((await post({ Authorization: `Bearer ${T.status.slice(0, -1)}X` })).status === 401, 'token sai 1 ký tự → 401');
ok((await fetch(URL_, { headers: { Authorization: `Bearer ${T.status}` } })).status === 405, 'GET → 405 (chỉ POST)');
// Cổng trả 413 rồi đóng kết nối KHÔNG đọc hết thân → tuỳ thời điểm, bên gửi thấy 413 hoặc bị ngắt khi đang ghi (ECONNRESET/EPIPE)
const big = await post({ Authorization: `Bearer ${T.status}` }, 'x'.repeat(3 * 1024 * 1024)).then((r) => r.status, (e) => e.cause?.code || 'lỗi');
ok([413, 'ECONNRESET', 'EPIPE'].includes(big), `yêu cầu > 2MB → bị chặn (${big})`);
ok((await fetch(`http://127.0.0.1:${PORT}/khac`, { method: 'POST', headers: { Authorization: `Bearer ${T.status}` } })).status === 404, 'đường khác → 404');
ok((await post({ Authorization: `Bearer ${T.ghost}` })).status === 502, 'agent chưa chạy → 502');

const cs = await connect(T.status, { 'x-axle-tools': 'file_write,run_command', 'x-axle-client': 'writer' });
const ls = (await cs.listTools()).tools.map((t) => t.name);
ok(ls.join() === 'system_status', `tự gắn header x-axle-tools/x-axle-client để nới quyền → vô hiệu, vẫn chỉ thấy: ${ls.join(', ')}`);
const st = await cs.callTool({ name: 'system_status', arguments: {} });
ok(!st.isError && st.content[0].text.includes('host:'), 'gọi được công cụ được cấp');
let denied;
try { denied = await cs.callTool({ name: 'file_write', arguments: { path: '~/work/x', content: 'x' } }); } catch (e) { denied = { isError: true }; }
ok(denied.isError, 'gọi công cụ KHÔNG được cấp bị từ chối');
await cs.close();

const cw = await connect(T.writer);
ok((await cw.listTools()).tools.length === 2, 'token "writer" thấy đúng 2 công cụ');
await cw.close();

// Nối thẳng vào máy chủ của agent (bỏ qua cửa trước) nhưng xưng tên agent khác → 403
const direct = await new Promise((resolve) => {
  const r = httpRequest({ socketPath: path.join(SOCKS, 'status.sock'), path: '/mcp', method: 'POST',
    headers: { 'x-axle-client': 'writer', 'x-axle-tools': 'file_write', 'content-type': 'application/json' } }, (res) => resolve(res.statusCode));
  r.end(JSON.stringify(init));
});
ok(direct === 403, 'máy chủ agent từ chối yêu cầu xưng tên agent khác (403)');

ok(out.status.includes('"client":"http:status"'), 'nhật ký công cụ ra stdout (→ journal), tên theo token');
ok((out.front.match(/"tool":"http_auth"/g) || []).length >= 3, 'cửa trước ghi các lần sai token');
ok(![out.front, out.status, out.writer].some((o) => Object.values(T).some((t) => o.includes(t))), 'nhật ký không chứa token');

procs.forEach((p) => p.kill());
rmSync(D, { recursive: true, force: true });
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ cổng MCP HTTP (cửa trước + máy chủ từng agent) đạt');
