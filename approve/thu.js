// Thư của Axle (nhịp D18, 24/9) — gửi + nhận thư theo tên miền của chủ (hrvn.asia) qua Resend. Bi: "cho claude sử dụng
// gửi mail và nhận mail". Máy văn phòng KHÔNG tự làm máy chủ thư (cần nhà mạng đặt tên ngược cho IP + mở cổng 25 — Bi:
// "phức tạp nhỉ") → Resend lo đường đi, thư vẫn về nằm trên máy.
//   /etc/axle/thu.json { ten_mien, tu: "Tên <dia@chi>", bat } — `sudo axle thu setup`
//   Khoá Resend trong vault: RESEND_API_KEY → chỉ gửi tới api.resend.com. Bộ duyệt (root) gọi qua vault.
//   NHẬN: bộ duyệt 2 phút hỏi GET /emails/receiving (danh sách của CẢ tài khoản → lọc thư tới @ten_mien), mỗi thư mới →
//         ~chủ/Axle/Thu/Den/<YYYY-MM>/<YYYYMMDD-HHMM>-<id8>/ thu.json + thu.md + tệp đính kèm (của chủ; mở được từ nút Tệp
//         của app). Báo lặng lên Bàn + app.
//   GỬI:  việc thu_gui (bậc 3 — duyệt TỪNG lá trên điện thoại, thấy đủ người nhận / tiêu đề / nội dung / tệp). Bản đã gửi
//         → ~chủ/Axle/Thu/Di/…
// Hàm ở đây thuần hoặc chỉ đụng thư mục được truyền vào → approve/test-thu.mjs thử được không cần mạng.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tenTepAnToan } from './mota.js';

export const CAU_HINH = process.env.AXLE_THU_CFG || '/etc/axle/thu.json';
export const TOI_DA_TEP_GUI = 10 * 1024 * 1024;    // tổng tệp một lá gửi đi (base64 ~13,3 MB < 16 MB của vault)
export const TOI_DA_TEP_NHAN = 20 * 1024 * 1024;   // mỗi tệp thư đến

export function docCauHinh(file = CAU_HINH) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (!j?.ten_mien || !j?.tu) return null;
    return { bat: j.bat !== false, ten_mien: String(j.ten_mien).toLowerCase(), tu: String(j.tu) };
  } catch { return null; }
}

const DIA_CHI = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
/** "Tên <a@b.vn>" hoặc "a@b.vn" → { ten, dia_chi } (ném lỗi tiếng Việt khi sai) */
export function tachDiaChi(s) {
  const t = String(s ?? '').trim();
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(t);
  const dc = (m ? m[2] : t).trim().toLowerCase();
  if (!DIA_CHI.test(dc)) throw new Error(`Địa chỉ thư không hợp lệ: "${t}"`);
  return { ten: m ? m[1].trim().replace(/^"|"$/g, '').trim() : '', dia_chi: dc };
}
const tenHien = (s) => { try { const d = tachDiaChi(s); return d.ten || d.dia_chi; } catch { return String(s ?? '?'); } };

/** Kiểm + chuẩn hoá yêu cầu gửi (chưa đụng tệp — bộ duyệt tự kiểm tệp trong nhà chủ bằng approve/tep.js). */
export function chuanThuGui(p = {}, cfg) {
  if (!cfg?.bat) throw new Error('Thư của Axle chưa bật trên máy này (sudo axle thu setup)');
  const ds = (x) => (Array.isArray(x) ? x : x ? [x] : []).map((d) => tachDiaChi(d).dia_chi);
  const den = [...new Set(ds(p.den))];
  const cc = [...new Set(ds(p.cc))].filter((x) => !den.includes(x));
  if (!den.length) throw new Error('Cần ít nhất một người nhận');
  if (den.length + cc.length > 20) throw new Error('Tối đa 20 người nhận một lá');
  const tieuDe = String(p.tieu_de ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!tieuDe || tieuDe.length > 200) throw new Error('Tiêu đề 1–200 ký tự');
  const noiDung = String(p.noi_dung ?? '').replace(/\r\n/g, '\n').trim();
  if (!noiDung || noiDung.length > 50_000) throw new Error('Nội dung 1–50.000 ký tự');
  const tep = (Array.isArray(p.tep) ? p.tep : p.tep ? [p.tep] : []).map(String);
  if (tep.length > 10) throw new Error('Tối đa 10 tệp đính kèm');
  const traLoi = p.tra_loi ? String(p.tra_loi).trim().slice(0, 80) : null;
  return { den, cc, tieu_de: tieuDe, noi_dung: noiDung, tep, tra_loi: traLoi };
}

const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** Chữ hiện trên điện thoại khi xin duyệt: đủ người nhận, tiêu đề, nội dung (cắt 1.500 ký tự), tệp kèm cỡ. */
export function moTaThuGui(p, cfg, { tepCo = [], thuGoc = null } = {}) {
  const nd = p.noi_dung.length > 1500 ? `${p.noi_dung.slice(0, 1500)}\n… (còn ${p.noi_dung.length - 1500} ký tự)` : p.noi_dung;
  return [`gửi thư từ ${cfg?.tu ?? '?'}`, `Tới: ${p.den.join(', ')}`, ...(p.cc.length ? [`Cc: ${p.cc.join(', ')}`] : []),
    `Tiêu đề: ${p.tieu_de}`, ...(thuGoc ? [`Trả lời thư của ${tenHien(thuGoc.tu)}: "${thuGoc.tieu_de}"`] : []),
    '─────', nd, '─────',
    tepCo.length ? `Đính kèm: ${tepCo.map((t) => `${t.ten} (${kb(t.co)})`).join(', ')}` : 'Không có tệp đính kèm'].join('\n');
}

/** Thân yêu cầu POST https://api.resend.com/emails */
export function thanhThu(p, cfg, { tep = [], thuGoc = null } = {}) {
  const b = { from: cfg.tu, to: p.den, subject: p.tieu_de, text: p.noi_dung };
  if (p.cc.length) b.cc = p.cc;
  if (thuGoc?.message_id) {
    const refs = [thuGoc.references, thuGoc.message_id].filter(Boolean).join(' ').trim();
    b.headers = { 'In-Reply-To': thuGoc.message_id, References: refs };
  }
  if (tep.length) b.attachments = tep.map((t) => ({ filename: t.ten, content: Buffer.from(t.bytes).toString('base64') }));
  return b;
}

/** Thư đến (mục trong GET /emails/receiving) có gửi tới tên miền của Axle không (to / cc / received_for) */
export function cuaMinh(e, tenMien) {
  return [...(e?.to || []), ...(e?.cc || []), ...(e?.received_for || [])]
    .some((x) => { try { return tachDiaChi(x).dia_chi.endsWith(`@${tenMien}`); } catch { return false; } });
}

const THUC_THE = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
/** HTML thư → chữ đọc được (khi thư không có bản text) */
export function htmlSangChu(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, u, t) => (t.replace(/<[^>]+>/g, '').trim() === u ? u : `${t} (${u})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#\d/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return THUC_THE[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const hai = (n) => String(n).padStart(2, '0');
const nhanLuc = (d) => `${d.getFullYear()}${hai(d.getMonth() + 1)}${hai(d.getDate())}-${hai(d.getHours())}${hai(d.getMinutes())}`;
const gioDoc = (d) => `${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()} ${hai(d.getHours())}:${hai(d.getMinutes())}`;

function taoThuMuc(goc, hop, id, luc, chown) {
  const d = new Date(luc);
  let dir = goc;
  for (const phan of [hop, `${d.getFullYear()}-${hai(d.getMonth() + 1)}`, `${nhanLuc(d)}-${String(id).replace(/[^A-Za-z0-9-]/g, '').slice(0, 8)}`]) {
    dir = path.join(dir, phan);
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chown(dir); }
  }
  return dir;
}
function ghiTep(f, data, chown) { writeFileSync(f, data, { mode: 0o600 }); chown(f); }

function thuMd(t, hopDen) {
  return `# ${t.tieu_de || '(không tiêu đề)'}\n\n- ${hopDen ? 'Từ' : 'Gửi từ'}: ${t.tu}\n- Tới: ${(t.den || []).join(', ')}\n`
    + `${t.cc?.length ? `- Cc: ${t.cc.join(', ')}\n` : ''}- Lúc: ${gioDoc(new Date(t.luc))}\n`
    + `${t.tep?.length ? `- Tệp: ${t.tep.map((x) => x.ten + (x.bo ? ` (không lấy: ${x.bo})` : '')).join(', ')}\n` : ''}\n---\n\n${t.chu || '(không có chữ)'}\n`;
}

/**
 * Lưu một thư đến vào <goc>/Den/…: e = đối tượng Resend (GET /emails/receiving/{id}, thiếu thân thì dùng mục danh sách),
 * tep = [{ten, bytes} | {ten, bo: 'lý do'}]. Trả { dir, t } — t là thu.json.
 */
export function luuThuDen(goc, e, { tep = [], chown = () => {} } = {}) {
  const luc = e.created_at || new Date().toISOString();
  const dir = taoThuMuc(goc, 'Den', e.id, luc, chown);
  const daCo = new Set(['thu.json', 'thu.md']);
  const tepLuu = tep.map((x, i) => {
    if (!x.bytes) return { ten: x.ten, bo: x.bo || 'không tải được' };
    let ten = tenTepAnToan(x.ten, i + 1);
    for (let k = 2; daCo.has(ten); k++) ten = `${k}-${ten}`;
    daCo.add(ten);
    ghiTep(path.join(dir, ten), x.bytes, chown);
    return { ten: x.ten, tep: ten, co: x.bytes.length };
  });
  const chu = (e.text && String(e.text).trim()) || htmlSangChu(e.html) || (e.thieu_than ? '(thư quá lớn để lấy nội dung — xem trên Resend)' : '');
  const t = { id: e.id, luc, tu: e.from || '?', den: e.to || [], cc: e.cc || [], tieu_de: e.subject || '', message_id: e.message_id || null,
    references: e.headers?.references || e.headers?.References || null, chu: chu.slice(0, 200_000), tep: tepLuu,
    ...(e.authentication ? { xac_thuc: e.authentication } : {}) };
  ghiTep(path.join(dir, 'thu.json'), JSON.stringify(t, null, 1), chown);
  ghiTep(path.join(dir, 'thu.md'), thuMd(t, true), chown);
  return { dir, t };
}

/** Lưu bản đã gửi vào <goc>/Di/… */
export function luuThuDi(goc, { id, p, cfg, tepCo = [] }, { chown = () => {} } = {}) {
  const luc = new Date().toISOString();
  const dir = taoThuMuc(goc, 'Di', id || 'gui', luc, chown);
  const t = { id, luc, tu: cfg.tu, den: p.den, cc: p.cc, tieu_de: p.tieu_de, chu: p.noi_dung, tra_loi: p.tra_loi || null,
    tep: tepCo.map((x) => ({ ten: x.ten, co: x.co })) };
  ghiTep(path.join(dir, 'thu.json'), JSON.stringify(t, null, 1), chown);
  ghiTep(path.join(dir, 'thu.md'), thuMd(t, false), chown);
  return { dir, t };
}

// ---- Đọc kho thư (công cụ của Claude, `axle thu`) ----
function moiThu(goc, hop) {
  const ra = [];
  const h = path.join(goc, hop);
  let thang = [];
  try { thang = readdirSync(h).filter((x) => /^\d{4}-\d{2}$/.test(x)).sort().reverse(); } catch { return ra; }
  for (const m of thang) {
    let ds = [];
    try { ds = readdirSync(path.join(h, m)).sort().reverse(); } catch { continue; }
    for (const x of ds) ra.push(path.join(h, m, x));
  }
  return ra;
}
function docThuJson(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, 'thu.json'), 'utf8')); } catch { return null; }
}

/** Danh sách thư (mới trước): hop 'den' | 'di', tìm trong tiêu đề / người gửi / người nhận / nội dung. */
export function dsThu(goc, { hop = 'den', so = 20, tim = '' } = {}) {
  const q = String(tim || '').toLowerCase().trim();
  const ra = [];
  for (const dir of moiThu(goc, hop === 'di' ? 'Di' : 'Den')) {
    if (ra.length >= Math.min(Math.max(1, so), 200)) break;
    const t = docThuJson(dir);
    if (!t) continue;
    if (q && ![t.tieu_de, t.tu, ...(t.den || []), t.chu].some((x) => String(x || '').toLowerCase().includes(q))) continue;
    ra.push({ id: t.id, luc: gioDoc(new Date(t.luc)), tu: t.tu, den: t.den, tieu_de: t.tieu_de,
      trich: String(t.chu || '').replace(/\s+/g, ' ').slice(0, 160), so_tep: (t.tep || []).filter((x) => x.tep || x.co).length });
  }
  return ra;
}

/** Một thư theo id (đủ ≥ 6 ký tự đầu), tìm cả hai hộp. Trả thu.json + đường tuyệt đối của tệp kèm, hoặc null. */
export function timThu(goc, id) {
  const k = String(id || '').trim();
  if (k.length < 6) return null;
  for (const hop of ['Den', 'Di']) {
    for (const dir of moiThu(goc, hop)) {
      const id8 = path.basename(dir).slice(14);          // "YYYYMMDD-HHMM-" rồi 8 ký tự đầu của mã
      const n = Math.min(id8.length, k.length);
      if (!n || id8.slice(0, n) !== k.slice(0, n)) continue;
      const t = docThuJson(dir);
      if (t && String(t.id || '').startsWith(k)) {
        return { ...t, hop: hop === 'Den' ? 'den' : 'di', thu_muc: dir, tep: (t.tep || []).map((x) => (x.tep ? { ...x, duong: path.join(dir, x.tep) } : x)) };
      }
    }
  }
  return null;
}
