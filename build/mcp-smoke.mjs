// Gọi thử cổng MCP của Axle qua SSH, đúng cách một agent ở máy khác sẽ dùng.
//   node build/mcp-smoke.mjs <đối số ssh…>   ví dụ: -p 2223 admin_1@localhost
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const sshArgs = process.argv.slice(2);
const client = new Client({ name: 'axle-smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: 'ssh', args: [...sshArgs, 'axle', 'mcp'], stderr: 'inherit' }));

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };
const call = async (name, args = {}) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { err: !!r.isError, text: r.content?.map((c) => c.text).join('\n') ?? '' };
  } catch (e) {
    return { err: true, text: e.message };
  }
};

const { tools } = await client.listTools();
ok(tools.length === 22, `có ${tools.length} công cụ: ${tools.map((t) => t.name).join(', ')}`);

const st = await call('system_status');
ok(!st.err && /host: \S+ · axle /.test(st.text), 'system_status');
const lg = await call('logs', { unit: 'ssh', lines: 5 });
ok(!lg.err && lg.text.length > 0, 'logs đọc được journal không cần sudo');
ok(!(await call('docker_ps')).err, 'docker_ps');
ok(!(await call('pm2_list')).err, 'pm2_list');

const cr = await call('snapshot_create', { description: 'mcp smoke' });
const num = cr.text.match(/#(\d+)/)?.[1];
ok(!cr.err && num, `snapshot_create → #${num}`);
ok((await call('snapshot_list')).text.includes('mcp smoke'), 'snapshot_list thấy snapshot vừa chụp');
ok(!(await call('snapshot_diff', { number: Number(num) })).err, 'snapshot_diff');

const bad = await call('service_status', { unit: 'ssh; rm -rf /' });
ok(bad.err, 'tên dịch vụ có ký tự lạ bị chặn');

const secret = 'noi-dung-khong-duoc-vao-nhat-ky';
const w = await call('file_write', { path: '~/work/smoke.txt', content: `dong 1 ${secret}\n`, mode: 'overwrite' });
ok(!w.err, `file_write ~/work/smoke.txt`);
const rd = await call('file_read', { path: '~/work/smoke.txt' });
ok(!rd.err && rd.text.includes(secret), 'file_read đọc lại đúng');
ok((await call('file_search', { path: '~/work', text: 'DONG 1' })).text.includes('smoke.txt'), 'file_search tìm thấy');
ok((await call('file_list', { path: '~' })).text.includes('work/'), 'file_list thấy ~/work');
ok((await call('file_read', { path: '~/.ssh/authorized_keys' })).err, 'file_read ~/.ssh bị chặn');
ok((await call('file_write', { path: '/etc/axle/mcp.json', content: '{}', mode: 'overwrite' })).err, 'file_write /etc/axle bị chặn (agent không tự nới quyền)');

const SECRET = process.env.AXLE_TEST_SECRET;
if (SECRET) {
  const vl = await call('vault_list');
  ok(!vl.err && vl.text.includes('TEST_TOKEN → localhost') && !vl.text.includes(SECRET), 'vault_list có tên + nơi gửi, không có giá trị');
  const hr = await call('http_request', { url: 'http://localhost:8088/echo', headers: { Authorization: 'Bearer {{secret.TEST_TOKEN}}' } });
  ok(!hr.err && hr.text.startsWith('HTTP 200'), 'http_request dùng khoá gọi được');
  ok(!hr.text.includes(SECRET) && hr.text.includes('[ĐÃ ẨN:TEST_TOKEN]'), 'phản hồi dội lại khoá → vault đã ẩn');
  const other = await call('http_request', { url: 'http://127.0.0.1:8088/echo', headers: { Authorization: '{{secret.TEST_TOKEN}}' } });
  ok(other.err && other.text.includes('không được gửi tới 127.0.0.1'), 'gửi khoá tới nơi khác bị từ chối');
  ok((await call('http_request', { url: 'http://localhost:8088/', headers: { A: '{{secret.KHONG_CO}}' } })).err, 'khoá không tồn tại bị từ chối');
}

const au = await call('audit_recent', { lines: 50 });
ok(au.text.includes('"sha256"') && !au.text.includes(secret) && !(SECRET && au.text.includes(SECRET)), 'nhật ký file_write chỉ có byte + hash, không có nội dung');
ok(au.text.includes('"tool":"snapshot_create"') && au.text.includes('"client":"axle-smoke"'), 'nhật ký ghi đủ lần gọi, có tên agent');

await client.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ cổng MCP đạt');
