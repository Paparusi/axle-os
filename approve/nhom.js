// Nhóm báo cáo (nhịp D19, 26/9): chủ thêm bot Telegram của Axle vào nhóm nhân viên nộp báo cáo → bộ duyệt GHI tin của
// nhóm về máy, chiều nhắn riêng chủ ai đã gửi / ai chưa thấy, Claude của chủ đọc lại được (mcp/baocao.js).
//   ~chủ/Axle/BaoCao/<thư mục nhóm>/nhom.json           { ten, loai, ghi_tu, dang_ghi }
//   ~chủ/Axle/BaoCao/<thư mục nhóm>/<YYYY-MM-DD>.jsonl  mỗi dòng một tin; ngày = ngày GỬI theo giờ máy. Tin bị sửa → thêm
//                                                        một dòng sua: true cùng id (đọc thì gopSua lấy bản mới nhất).
//   /var/lib/axle/nhom-bao-cao.json (root) — sổ nhóm: { nhom: { "<chat id>": { ten, loai, trang_thai, thu_muc, … } }, tong_ket }
// Tin trong nhóm là chữ NGƯỜI KHÁC viết: chỉ là DỮ LIỆU. Không lệnh nào chạy từ nhóm (kể cả tin của chủ), Axle không nói gì
// trong nhóm. Bộ duyệt chạy root mà ghi vào nhà chủ → không đi theo liên kết mềm (O_NOFOLLOW từng tầng), tạo mới thì
// fchown về chủ ngay trên fd (chown theo đường dẫn thì link chen vào giữa là root trao file lạ cho chủ).
import { closeSync, constants as K, fchownSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { writeDurable } from './rules.js';

export const NGAY_XET = 14;                    // "chưa thấy" = có gửi trong 14 ngày trước mà hôm nay chưa
const TOI_DA_TEP_NGAY = 20 * 1024 * 1024;      // một nhóm một ngày; quá thì bỏ tin (nhóm bị spam không làm đầy đĩa)
const TOI_DA_CHU = 8000;
const THU = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
const hai = (n) => String(n).padStart(2, '0');

export const laNhom = (chat) => chat?.type === 'group' || chat?.type === 'supergroup';
/** Date → 'YYYY-MM-DD' theo giờ máy */
export const ngayCua = (d) => `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
export function luiNgay(ngay, n) {
  const [y, m, d] = ngay.split('-').map(Number);
  return ngayCua(new Date(y, m - 1, d - n));
}
const gioCua = (iso) => { const d = new Date(iso); return `${hai(d.getHours())}:${hai(d.getMinutes())}`; };
const dm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };
export function ngayDoc(ngay) {
  const [y, m, d] = ngay.split('-').map(Number);
  return `${THU[new Date(y, m - 1, d).getDay()]} ${d}/${m}`;
}
export function tenNguoi(u) {
  if (!u) return '?';
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.username ? `@${u.username}` : `#${u.id}`);
}

const LOAI_TEP = [['document', 'tep'], ['video', 'video'], ['audio', 'am_thanh'], ['voice', 'giong_noi'], ['video_note', 'video_tron'],
  ['animation', 'gif'], ['sticker', 'nhan_dan']];
export const TEN_LOAI = { tep: 'tệp', video: 'video', am_thanh: 'âm thanh', giong_noi: 'tin thoại', video_tron: 'video tròn', gif: 'ảnh động',
  nhan_dan: 'nhãn dán', vi_tri: 'vị trí', lien_he: 'danh bạ', binh_chon: 'bình chọn' };

/**
 * Tin Telegram của nhóm → bản ghi lưu máy (null: không phải nhóm / loại tin không đáng ghi). chuId = id Telegram của chủ
 * (đánh dấu la_chu để tổng kết không đếm chủ). Tệp / ảnh chỉ giữ file_id (tải về là nhịp sau).
 */
export function banGhi(msg, { chuId = null, sua = false } = {}) {
  if (!msg || !laNhom(msg.chat)) return null;
  const f = msg.from || {};
  const nguoi = msg.sender_chat
    ? { id: msg.sender_chat.id, ten: msg.sender_chat.title || 'Quản trị ẩn danh', an_danh: true }
    : { id: f.id, ten: tenNguoi(f), ...(f.username ? { u: f.username } : {}), ...(f.is_bot ? { bot: true } : {}),
      ...(chuId != null && Number(f.id) === Number(chuId) ? { la_chu: true } : {}) };
  const r = { id: msg.message_id, luc: new Date((msg.date || 0) * 1000).toISOString(), nguoi };
  if (sua) { r.sua = true; if (msg.edit_date) r.luc_sua = new Date(msg.edit_date * 1000).toISOString(); }
  // Sự kiện nhóm: vào / rời (để "chưa thấy" không kể người đã rời) / đổi tên
  const ai = (ds) => ds.map((u) => ({ id: u.id, ten: tenNguoi(u), ...(u.is_bot ? { bot: true } : {}) }));
  if (msg.new_chat_members?.length) return { ...r, su_kien: 'vao', ai: ai(msg.new_chat_members) };
  if (msg.left_chat_member) return { ...r, su_kien: 'roi', ai: ai([msg.left_chat_member]) };
  if (msg.new_chat_title) return { ...r, su_kien: 'doi_ten', ten_moi: String(msg.new_chat_title).slice(0, 200) };
  const chu = String(msg.text ?? msg.caption ?? '');
  if (chu) r.noi_dung = chu.length > TOI_DA_CHU ? `${chu.slice(0, TOI_DA_CHU)}…` : chu;
  if (msg.photo?.length) {
    const a = msg.photo[msg.photo.length - 1];   // cỡ lớn nhất
    r.anh = { id: a.file_id, uid: a.file_unique_id, w: a.width, h: a.height };
  }
  for (const [k, loai] of LOAI_TEP) {
    const t = msg[k];
    if (!t || (k === 'document' && msg.animation)) continue;
    r.tep = { loai, id: t.file_id, uid: t.file_unique_id, ...(t.file_name ? { ten: String(t.file_name).slice(0, 200) } : {}),
      ...(t.mime_type ? { mime: t.mime_type } : {}), ...(t.file_size ? { co: t.file_size } : {}), ...(t.emoji ? { emoji: t.emoji } : {}),
      ...(t.duration ? { giay: t.duration } : {}) };
    break;
  }
  if (msg.location) r.khac = { loai: 'vi_tri', lat: msg.location.latitude, lng: msg.location.longitude };
  else if (msg.contact) r.khac = { loai: 'lien_he', ten: tenNguoi(msg.contact), sdt: msg.contact.phone_number };
  else if (msg.poll) r.khac = { loai: 'binh_chon', cau_hoi: msg.poll.question, lua_chon: (msg.poll.options || []).map((o) => o.text) };
  if (!r.noi_dung && !r.anh && !r.tep && !r.khac) return null;   // ghim tin, trò chơi, … — không phải báo cáo
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) r.chuyen_tiep = true;
  if (msg.reply_to_message?.message_id) r.tra_loi = msg.reply_to_message.message_id;
  if (msg.media_group_id) r.album = String(msg.media_group_id);
  return r;
}

/** Tên nhóm → tên thư mục (chữ thường không dấu, gạch nối), không trùng với daCo */
export function thuMucMoi(ten, daCo = new Set()) {
  const goc = String(ten || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'nhom';
  let t = goc;
  for (let k = 2; daCo.has(t); k++) t = `${goc}-${k}`;
  return t;
}

// ---- Sổ nhóm (root) ----
export function docSo(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j && typeof j.nhom === 'object' && j.nhom) return j;
  } catch { /* chưa có */ }
  return { phien_ban: 1, nhom: {}, tong_ket: null };
}
export const luuSo = (file, so) => writeDurable(file, `${JSON.stringify(so, null, 1)}\n`);

// ---- Ghi vào nhà chủ (bộ duyệt, root) ----
const traVe = (fd, ids) => { if (ids?.uid != null) fchownSync(fd, ids.uid, ids.gid); };
/** nha/phan[0]/phan[1]/… — tầng nào chưa có thì tạo 0700 + về tay chủ; tầng nào là liên kết mềm / không phải thư mục → lỗi */
function thuMucAnToan(nha, phan, ids) {
  let d = nha;
  for (const p of phan) {
    if (!p || p === '.' || p === '..' || p.includes('/')) throw new Error(`tên thư mục lạ: ${p}`);
    d = path.join(d, p);
    let moi = false;
    try { mkdirSync(d, { mode: 0o700 }); moi = true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const fd = openSync(d, K.O_RDONLY | K.O_DIRECTORY | K.O_NOFOLLOW);   // link mềm → ELOOP, tệp → ENOTDIR
    try { if (moi) traVe(fd, ids); } finally { closeSync(fd); }
  }
  return d;
}
function moTep(f, co, ids) {
  const fd = openSync(f, K.O_WRONLY | K.O_CREAT | K.O_NOFOLLOW | co, 0o600);
  const st = fstatSync(fd);
  if (!st.isFile()) { closeSync(fd); throw new Error(`${f} không phải tệp thường`); }
  if (st.size === 0) traVe(fd, ids);
  return { fd, st };
}
export const BAO_CAO = ['Axle', 'BaoCao'];
/** Thêm một bản ghi vào ~/Axle/BaoCao/<thuMuc>/<ngày gửi>.jsonl. Trả đường tệp. */
export function ghiTin(nha, thuMuc, rec, { ids = null } = {}) {
  const d = thuMucAnToan(nha, [...BAO_CAO, thuMuc], ids);
  const f = path.join(d, `${ngayCua(new Date(rec.luc))}.jsonl`);
  const { fd, st } = moTep(f, K.O_APPEND, ids);
  try {
    if (st.size > TOI_DA_TEP_NGAY) throw new Error(`${path.basename(f)} của nhóm ${thuMuc} quá ${TOI_DA_TEP_NGAY >> 20} MB — bỏ tin`);
    writeSync(fd, `${JSON.stringify(rec)}\n`);
  } finally { closeSync(fd); }
  return f;
}
/** ~/Axle/BaoCao/<thuMuc>/nhom.json — tên hiện tại của nhóm cho Claude / người đọc (không có id chat) */
export function ghiThongTin(nha, thuMuc, info, { ids = null } = {}) {
  const d = thuMucAnToan(nha, [...BAO_CAO, thuMuc], ids);
  const { fd } = moTep(path.join(d, 'nhom.json'), K.O_TRUNC, ids);
  try { writeSync(fd, `${JSON.stringify(info, null, 1)}\n`); } finally { closeSync(fd); }
}

// ---- Đọc (bộ duyệt và Claude của chủ) — goc = ~/Axle/BaoCao ----
export function docNgay(goc, thuMuc, ngay) {
  let t = '';
  try { t = readFileSync(path.join(goc, thuMuc, `${ngay}.jsonl`), 'utf8'); } catch { return []; }
  const ra = [];
  for (const l of t.split('\n')) {
    if (!l.trim()) continue;
    try { ra.push(JSON.parse(l)); } catch { /* dòng hỏng (máy tắt giữa lúc ghi) */ }
  }
  return ra;
}
/** Gộp bản sửa: mỗi tin giữ chỗ + giờ gửi gốc, nội dung lấy bản sửa mới nhất, đánh dấu da_sua */
export function gopSua(ds) {
  const ra = [];
  const viTri = new Map();
  for (const r of ds) {
    if (r.su_kien) { ra.push(r); continue; }
    const { sua, ...x } = r;
    const k = String(r.id);
    if (!viTri.has(k)) { viTri.set(k, ra.length); ra.push(sua ? { ...x, da_sua: true } : x); continue; }
    if (!sua) continue;   // trùng dòng (ghi lại sau lỗi) — giữ bản đầu
    const i = viTri.get(k);
    ra[i] = { ...x, luc: ra[i].luc, da_sua: true };
  }
  return ra;
}

const tinhNguoi = (r) => !r.su_kien && r.nguoi && !r.nguoi.la_chu && !r.nguoi.bot && !r.nguoi.an_danh && r.nguoi.id != null;
/**
 * homNay: bản ghi ngày xét; truoc: bản ghi các ngày trước (cũ → mới).
 * → { da: [{id, ten, so, anh, tep, dau}], chua: [{id, ten, luc}], so_tin } — không tính chủ, bot, quản trị ẩn danh, người đã rời.
 */
export function tongKet(homNay, truoc = []) {
  const nay = gopSua(homNay);
  const da = new Map();
  for (const r of nay) {
    if (!tinhNguoi(r)) continue;
    const k = String(r.nguoi.id);
    const x = da.get(k) || { id: r.nguoi.id, ten: r.nguoi.ten, so: 0, anh: 0, tep: 0, dau: r.luc };
    x.so++; if (r.anh) x.anh++; if (r.tep) x.tep++;
    x.ten = r.nguoi.ten;
    if (r.luc < x.dau) x.dau = r.luc;
    da.set(k, x);
  }
  const lanCuoi = new Map();
  const daRoi = new Set();
  for (const r of [...gopSua(truoc), ...nay]) {
    for (const a of r.su_kien === 'roi' ? r.ai || [] : []) daRoi.add(String(a.id));
    for (const a of r.su_kien === 'vao' ? r.ai || [] : []) daRoi.delete(String(a.id));
    if (!tinhNguoi(r)) continue;
    daRoi.delete(String(r.nguoi.id));   // còn nhắn được thì còn trong nhóm
    lanCuoi.set(String(r.nguoi.id), { id: r.nguoi.id, ten: r.nguoi.ten, luc: r.luc });
  }
  const chua = [...lanCuoi.entries()].filter(([k]) => !da.has(k) && !daRoi.has(k)).map(([, v]) => v)
    .sort((a, b) => (a.luc < b.luc ? -1 : 1));
  return { da: [...da.values()].sort((a, b) => (a.dau < b.dau ? -1 : 1)), chua, so_tin: nay.filter((r) => !r.su_kien).length };
}
export function docTongKet(goc, thuMuc, ngay, soNgay = NGAY_XET) {
  const truoc = [];
  for (let i = soNgay; i >= 1; i--) truoc.push(...docNgay(goc, thuMuc, luiNgay(ngay, i)));
  return tongKet(docNgay(goc, thuMuc, ngay), truoc);
}
export function vanBanTongKet(ten, ngay, tk) {
  const dau = `📋 «${ten}» · ${ngayDoc(ngay)}`;
  if (!tk.da.length && !tk.chua.length) return `${dau}\nChưa ai gửi gì trong ${NGAY_XET} ngày qua.`;
  const them = (x) => [gioCua(x.dau), x.so > 1 ? `${x.so} tin` : '', x.anh ? `${x.anh} ảnh` : '', x.tep ? `${x.tep} tệp` : '']
    .filter(Boolean).join(', ');
  return [dau,
    tk.da.length ? `✅ Đã gửi ${tk.da.length}: ${tk.da.map((x) => `${x.ten} (${them(x)})`).join(', ')}` : '✅ Hôm nay chưa ai gửi.',
    ...(tk.chua.length ? [`⏳ Chưa thấy ${tk.chua.length}: ${tk.chua.map((x) => `${x.ten} (lần cuối ${dm(x.luc)})`).join(', ')}`] : []),
  ].join('\n');
}

/** Các nhóm đang / đã ghi: [{thu_muc, ten, dang_ghi, ghi_tu, ngay_dau, ngay_cuoi, so_ngay}] */
export function dsNhom(goc) {
  let ds = [];
  try { ds = readdirSync(goc, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
  return ds.map((t) => {
    let j = {};
    try { j = JSON.parse(readFileSync(path.join(goc, t, 'nhom.json'), 'utf8')); } catch { /* thiếu thì lấy tên thư mục */ }
    let ngay = [];
    try { ngay = readdirSync(path.join(goc, t)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { /* rỗng */ }
    return { thu_muc: t, ten: j.ten || t, dang_ghi: j.dang_ghi !== false, ghi_tu: j.ghi_tu || null,
      ngay_dau: ngay[0] || null, ngay_cuoi: ngay.at(-1) || null, so_ngay: ngay.length };
  });
}
const khongDau = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
/** Tìm nhóm theo thư mục hoặc một phần tên (không dấu); trống mà chỉ có một nhóm thì lấy nhóm đó */
export function timNhom(ds, q) {
  if (!q) return ds.length === 1 ? ds[0] : null;
  const k = khongDau(q).trim();
  return ds.find((n) => n.thu_muc === q) || ds.find((n) => khongDau(n.ten) === k) || ds.find((n) => khongDau(n.ten).includes(k)) || null;
}
export const hopNguoi = (r, q) => !q || khongDau(r.nguoi?.ten).includes(khongDau(q).trim()) || khongDau(r.nguoi?.u) === khongDau(q).replace(/^@/, '').trim();

/** Một bản ghi → một dòng đọc được (giờ máy) cho Claude / chủ */
export function dongDoc(r) {
  const gio = gioCua(r.luc);
  if (r.su_kien === 'vao') return `${gio} — ${r.ai.map((a) => a.ten).join(', ')} vào nhóm`;
  if (r.su_kien === 'roi') return `${gio} — ${r.ai.map((a) => a.ten).join(', ')} rời nhóm`;
  if (r.su_kien === 'doi_ten') return `${gio} — nhóm đổi tên thành «${r.ten_moi}»`;
  const kem = [
    r.anh ? '[ảnh]' : '',
    r.tep ? `[${TEN_LOAI[r.tep.loai] || 'tệp'}${r.tep.ten ? `: ${r.tep.ten}` : r.tep.emoji ? ` ${r.tep.emoji}` : ''}]` : '',
    r.khac?.loai === 'vi_tri' ? `[vị trí ${r.khac.lat},${r.khac.lng}]` : '',
    r.khac?.loai === 'lien_he' ? `[danh bạ: ${r.khac.ten} ${r.khac.sdt || ''}]` : '',
    r.khac?.loai === 'binh_chon' ? `[bình chọn: ${r.khac.cau_hoi} — ${(r.khac.lua_chon || []).join(' / ')}]` : '',
    r.chuyen_tiep ? '[chuyển tiếp]' : '', r.tra_loi ? `[trả lời #${r.tra_loi}]` : '', r.da_sua ? '[đã sửa]' : '',
  ].filter(Boolean).join(' ');
  const chu = String(r.noi_dung || '').replace(/\n/g, '\n    ');
  return `${gio} #${r.id} ${r.nguoi?.ten ?? '?'}${r.nguoi?.la_chu ? ' (chủ)' : ''}: ${[kem, chu].filter(Boolean).join(' ')}`;
}

/** Tham số lệnh /baocao → 'YYYY-MM-DD' (trống = hôm nay; hqua; d/m của năm nay — ngày chưa tới thì là năm ngoái); sai → null */
export function ngayTuLenh(arg, now = new Date()) {
  const a = String(arg || '').trim().toLowerCase();
  if (!a || a === 'nay' || a === 'homnay') return ngayCua(now);
  if (a === 'hqua' || a === 'homqua' || a === 'hq') return luiNgay(ngayCua(now), 1);
  const m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(a);
  if (!m) return null;
  let d = new Date(now.getFullYear(), +m[2] - 1, +m[1]);
  if (d.getDate() !== +m[1] || d.getMonth() !== +m[2] - 1) return null;   // 31/2, 0/9, 5/13
  if (d > now) d = new Date(now.getFullYear() - 1, +m[2] - 1, +m[1]);
  return ngayCua(d);
}
