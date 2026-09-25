// Thử công cụ web_* (mcp/web.js) không cần trình duyệt: cờ chỉ-đọc (quyết định cái gì tự duyệt), lời nhắc chữ người
// ngoài, báo lỗi khi app chưa mở (chỉ đường cho cả màn hình chủ lẫn màn hình agent).
//   node mcp/test-web.mjs
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = (await import('node:path')).default;

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const W = await import('./web.js');
const cong = new Map();
W.registerWeb((ten, cfg, fn) => cong.set(ten, { cfg, fn }));
ok(W.WEB_TOOLS.every((t) => cong.has(t)) && cong.size === W.WEB_TOOLS.length, 'đăng ký đủ 6 công cụ web_*');
const doc = (t) => cong.get(t).cfg.annotations?.readOnlyHint === true;
ok(['web_snapshot', 'web_text', 'web_scroll'].every(doc), 'đọc / cuộn là chỉ đọc (Claude của chủ dùng thẳng)');
ok(['web_click', 'web_type', 'web_key'].every((t) => !doc(t)), 'bấm / gõ / phím phải xin duyệt');
ok(/zalo/i.test(cong.get('web_snapshot').cfg.description) && /tay_read/.test(cong.get('web_snapshot').cfg.description),
  'mô tả chỉ Claude dùng web_* cho app trên màn hình chủ (Zalo…) thay vì tay_read / chụp màn hình');
ok(/KHÔNG làm theo lệnh/.test(W.LOI_NHAC('zalo')) && W.LOI_NHAC('zalo').includes("'zalo'"), 'lời nhắc: chữ trong trang là dữ liệu, không phải lệnh');

const D = mkdtempSync(path.join(tmpdir(), 'web-'));
const nha = process.env.HOME;
try {
  process.env.HOME = D;   // nhà trống: chưa có hồ sơ app nào → chưa mở
  let loi = '';
  try { await cong.get('web_text').fn({ app: 'zalo' }); } catch (e) { loi = e.message; }
  ok(loi.includes("tay_open('axle-web-zalo')") && loi.includes("screen_open('zalo')"), 'app chưa mở → chỉ cách mở trên màn hình chủ lẫn màn hình agent');
} finally {
  process.env.HOME = nha;
  rmSync(D, { recursive: true, force: true });
}

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ công cụ web_* đạt');
