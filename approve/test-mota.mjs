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

// 24/9: lệnh chỉ đọc tự duyệt ("chỉ đọc") vẫn nằm trong nhật ký gốc nhưng Sổ không hiện (khỏi đầy ls/cat)
{
  const { gopNhatKy: gop } = await import('./mota.js');
  const dong = [
    JSON.stringify({ id: 'r1', ts: '2026-09-24T04:00:00Z', state: 'auto', by: 'chỉ đọc', action: 'claude_tool', client: 'ssh:claude', params: { tool: 'Bash', command: 'ls' } }),
    JSON.stringify({ id: 'r1', state: 'done', exitCode: 0 }),
    JSON.stringify({ id: 'r2', ts: '2026-09-24T04:01:00Z', state: 'auto', by: 'phiên 1 giờ #3 (tới 12:00)', action: 'claude_tool', client: 'ssh:claude', params: { tool: 'Bash', command: 'mv a b' } }),
  ];
  const so = gop(dong);
  ok(so.length === 1 && so[0].id === 'r2', `Sổ bỏ lệnh chỉ đọc tự duyệt, giữ việc tự duyệt theo phiên (${so.map((x) => x.id).join(',')})`);
}

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ mota (Sổ + bản cho app) đạt');

// ---- tên tệp đính kèm an toàn ----
import { tenTepAnToan } from './mota.js';
{
  let f3 = 0;
  const ok3 = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) f3++; };
  ok3(tenTepAnToan('Bảng lương T9 (đã chốt).xlsx') === 'Bang-luong-T9-da-chot.xlsx', `tiếng Việt có dấu → không dấu, khoảng trắng/ngoặc → - (${tenTepAnToan('Bảng lương T9 (đã chốt).xlsx')})`);
  ok3(tenTepAnToan('../../etc/passwd') === 'passwd', 'bỏ đường dẫn, không leo thư mục');
  ok3(tenTepAnToan('HỢP ĐỒNG.DOCX', 2) === 'HOP-DONG.docx', 'đuôi về chữ thường, giữ tên');
  ok3(tenTepAnToan('', 3) === 'tep-3' && tenTepAnToan('.....', 4) === 'tep-4', 'tên rỗng/hỏng → tep-<i>');
  ok3(tenTepAnToan('x'.repeat(200) + '.pdf').length <= 60, 'cắt tên dài');
  if (f3) { console.log(`✗ ${f3} mục hỏng`); process.exit(1); }
  console.log('✓ tên tệp an toàn đạt');
}

// ---- lệnh mô tả cho công cụ MCP (đích thật cho tin duyệt + luật "luôn") ----
import { lenhCongCu } from './mota.js';
{
  let f2 = 0;
  const ok2 = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) f2++; };
  const bang = { pid: 1, app: 'libreoffice', cua_so: 'Bảng lương T9 — Calc', luc: Date.now() / 1000 - 30,
    muc: { 37: { duong: [0, 1], vai: 'push button', ten: 'Lưu' }, 12: { duong: [0, 2], vai: 'text', ten: 'B4' } } };
  ok2(lenhCongCu('Bash', { command: 'ls' }) === null, 'công cụ thường (Bash/Edit) → null, giữ đường cũ');
  ok2(lenhCongCu('mcp__axle__web_click', { app: 'zalo', vai: 'button', ten: 'Gửi' }).command === 'web_click zalo: button "Gửi"', 'web_click: app + vai + tên');
  ok2(lenhCongCu('mcp__axle__tay_click', { so: 37 }, bang).command === 'tay_click libreoffice "Bảng lương T9 — Calc": push button "Lưu"', 'tay_click #37 → đổi thành nút "Lưu" trong Calc');
  ok2(lenhCongCu('mcp__axle__tay_type', { so: 12, chu: '500000' }, bang).command === 'tay_type libreoffice "Bảng lương T9 — Calc": text "B4"', 'tay_type nhớ theo ô, không theo chữ gõ');
  const m1 = lenhCongCu('mcp__axle__tay_click', { so: 99 }, bang);
  ok2(m1.mo === true && m1.command.includes('#99'), 'số không có trong bảng → mờ (bậc 3, không nhớ)');
  ok2(lenhCongCu('mcp__axle__tay_click', { so: 37 }, null).mo === true, 'chưa có bảng → mờ');
  ok2(lenhCongCu('mcp__axle__tay_click', { so: 37 }, { ...bang, luc: Date.now() / 1000 - 700 }).mo === true, 'bảng quá 10 phút → mờ');
  ok2(lenhCongCu('mcp__axle__tay_open', { app: 'libreoffice-calc' }).command === 'tay_open libreoffice-calc', 'tay_open theo app');
  ok2(lenhCongCu('mcp__axle__web_type', { app: 'gmail', vai: 'textbox', ten: 'x'.repeat(300) }).command.length < 200, 'cắt tên dài');
  if (f2) { console.log(`✗ ${f2} mục hỏng`); process.exit(1); }
  console.log('✓ lệnh mô tả công cụ MCP đạt');
}
