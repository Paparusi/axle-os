// Thử gộp nhật ký duyệt (Sổ) và bản cắt cho app: node approve/test-mota.mjs
import { banChoApp, gopNhatKy, moTaNgan } from './mota.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const t = (m) => new Date(Date.now() - m * 60_000).toISOString();
const J = (o) => JSON.stringify(o);
const dong = [
  J({ ts: t(50), id: 'aaaa0001', state: 'pending', action: 'claude_tool', client: 'ssh:claude', params: { tool: 'Bash', command: 'npm test', cwd: '/w' } }),
  J({ ts: t(49), id: 'aaaa0001', decision: 'h', via: 'qua app iPhone' }),
  J({ ts: t(49), id: 'aaaa0001', state: 'running', action: 'claude_tool', client: 'ssh:claude' }),
  J({ ts: t(48), id: 'aaaa0001', state: 'done', action: 'claude_tool', client: 'ssh:claude', exitCode: 0 }),
  J({ ts: t(30), id: 'aaaa0003', state: 'auto', action: 'claude_tool', client: 'ssh:claude', params: { tool: 'Edit', file: '/w/a.js' }, by: 'phiên 1 giờ #3' }),
  J({ ts: t(30), id: 'aaaa0003', state: 'done', action: 'claude_tool', client: 'ssh:claude', exitCode: 0 }),
  'không phải json', J({ ts: t(20), warn: 'gì đó không có id' }),
  J({ ts: t(10), id: 'aaaa0004', state: 'pending', action: 'run_command', client: 'ssh:claude', params: { command: 'rm -rf x', cwd: '/w', asRoot: true } }),
  J({ ts: t(9), id: 'aaaa0004', decision: 'r', via: 'tại máy' }),
  J({ ts: t(9), id: 'aaaa0004', state: 'rejected', action: 'run_command', client: 'ssh:claude' }),
  J({ ts: t(5), id: 'aaaa0005', state: 'done', action: 'x', client: 'y' }),   // trạng thái của id chưa từng xin → bỏ
];
const so = gopNhatKy(dong);
ok(so.map((x) => x.id).join(',') === 'aaaa0004,aaaa0003,aaaa0001', 'gộp theo id, mới nhất trước, bỏ dòng rác và id lạ');
ok(so[2].quyet_dinh === 'h' && so[2].via === 'qua app iPhone' && so[2].ket_qua === 'done' && so[2].exitCode === 0, 'chữ quyết định + qua đâu + kết quả cuối dính vào đúng việc');
ok(so[1].tu_duyet === 'phiên 1 giờ #3' && so[1].quyet_dinh === null, 'tự duyệt giữ tên luật/phiên, không có chữ quyết định');
ok(so[0].viec === 'lệnh `rm -rf x` (root)' && so[0].ket_qua === 'rejected', 'mô tả ngắn có (root); từ chối');
ok(moTaNgan('claude_tool', { tool: 'Edit', file: '/w/a.js' }) === 'Claude Edit /w/a.js' && moTaNgan('login', {}) === 'đăng nhập', 'moTaNgan');

const ban = { ts: 'x', host: 'h', pending: [{ id: 'p', text: 'x'.repeat(5000) }], homNay: { chu_duyet: 1 }, agents: [],
  so: Array.from({ length: 400 }, (_, i) => ({ id: `id${i}`, viec: 'v'.repeat(300), agent: 'a', ket_qua: 'done' })) };
const app = banChoApp(ban);
ok(!('pending' in app) && app.homNay.chu_duyet === 1 && app.host === 'h', 'bản cho app: bỏ pending, giữ số hôm nay');
ok(Buffer.byteLength(JSON.stringify(app)) <= 48000 && app.so.length > 0 && app.so.length < 400, `cắt sổ cho vừa hộp: ${app.so.length} việc, ${Buffer.byteLength(JSON.stringify(app))} byte`);
ok(banChoApp({ ts: 'x', host: 'h', so: [] }).so.length === 0, 'sổ rỗng vẫn trả được');

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ mota (Sổ + bản cho app) đạt');
