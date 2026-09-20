// Thử màn hình riêng của agent (docs/DESKTOP.md D2) qua cổng MCP HTTP — chạy TRÊN máy Axle.
//   node build/screen-smoke.mjs <url /mcp> <token agent đã bật màn hình>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const [url, token] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = new Client({ name: 'thu-man-hinh', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

const call = async (name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }); return { err: !!r.isError, content: r.content }; }
  catch (e) { return { err: true, content: [{ type: 'text', text: e.message }] }; }
};
const text = (r) => r.content.map((x) => x.text ?? `[${x.type}]`).join(' ');

const names = (await c.listTools()).tools.map((t) => t.name);
ok(names.includes('screen_shot') && names.includes('screen_click'), `agent thấy công cụ màn hình (${names.filter((n) => n.startsWith('screen_')).length} cái)`);

// Màn hình trống thì PNG chỉ vài trăm byte — đừng lấy kích thước làm thước đo, phải soi đúng là ảnh PNG
const isPng = (b64) => Buffer.from((b64 || '').slice(0, 12), 'base64').subarray(0, 8)
  .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const shot = await call('screen_shot', { scale: 60 });
const img = shot.content.find((x) => x.type === 'image');
ok(!shot.err && !!img && isPng(img.data), `chụp được màn hình (PNG ${Buffer.from(img?.data ?? '', 'base64').length} byte)`);

const bad = await call('screen_open', { app: 'khong-co-app-nay' });
ok(bad.err, 'app ngoài danh sách bị từ chối');

const open = await call('screen_open', { app: process.env.THU_APP || 'dongho' });
ok(!open.err, `mở app được: ${text(open).slice(0, 60)}`);
await sleep(4000);

const wins = await call('screen_windows');
ok(!wins.err && !/chưa có cửa sổ/.test(text(wins)), `cửa sổ hiện ra: ${text(wins).split('\n')[0].slice(0, 70)}`);

ok(!(await call('screen_click', { x: 200, y: 200 })).err, 'bấm chuột được');
ok(!(await call('screen_key', { keys: 'alt+Tab' })).err, 'bấm phím được');
ok((await call('screen_key', { keys: 'rm -rf /' })).err, 'tổ hợp phím bậy bị chặn');
ok(!(await call('screen_scroll', { direction: 'down', amount: 2 })).err, 'cuộn được');

// Ảnh sau khi mở app phải KHÁC ảnh lúc màn hình trống → đúng là đang chụp màn hình thật của agent
const shot2 = await call('screen_shot', { scale: 60 });
const img2 = shot2.content.find((x) => x.type === 'image');
ok(!!img2 && isPng(img2.data) && img2.data !== img?.data, 'ảnh đổi sau khi mở app (chụp thật, không phải ảnh tĩnh)');

console.log(fail ? `✗ ${fail} mục hỏng` : '✓ màn hình riêng của agent đạt');
process.exit(fail ? 1 : 0);
