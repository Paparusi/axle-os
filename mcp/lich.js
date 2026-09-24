// Lịch của Axle (nhịp D17, 24/9): NHẮC chủ đúng giờ + VIỆC Claude tự làm theo lịch. Trước đây "nhắc tao 3 giờ chiều gọi
// anh Tuấn" không làm được (mốc Bộ não chỉ có ngày, điện thoại nhắc lúc 8 giờ sáng) và Axle không tự làm gì khi chủ không hỏi.
//   ~/Axle/lich.json — của chủ, chỉ công cụ lich_* / `axle lich` ghi:
//     { phien_ban: 1, ds: [{ id, loai: nhac|viec, ten, noi_dung, lich: {kieu, luc|gio|thu|ngay}, tao_luc, bat }] }
//   Bộ duyệt (root, chạy suốt) giữ đồng hồ: 20 giây xem một lần (denHan). Nhắc → thông báo trên máy + điện thoại; việc →
//   `axle claude --lich` (chỉ đọc / tra web / Bộ não, không chạy lệnh, không sửa tệp → không bao giờ xin duyệt lúc chủ ngủ)
//   rồi gửi kết quả. Đã chạy tới đâu: /var/lib/axle/lich-da-chay.json (root ghi, 0644 để `axle lich ds` đọc lần trước).
// Giờ = giờ máy (Axle đặt Asia/Ho_Chi_Minh). Mọi hàm nhận `now` để thử được.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const LICH = process.env.AXLE_LICH_FILE || path.join(homedir(), 'Axle/lich.json');
export const DA_CHAY = process.env.AXLE_LICH_DA_CHAY || '/var/lib/axle/lich-da-chay.json';
export const LICH_TOOLS = ['lich_them', 'lich_ds', 'lich_xoa'];
const THU = ['', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy', 'Chủ nhật'];
const TOI_DA_MUC = 100;
// Máy tắt / bộ duyệt khởi động lại lúc tới giờ: trễ trong khoảng này thì vẫn báo (kèm "trễ N phút"), quá thì bỏ lỡ
// (đánh dấu đã chạy, không báo — khỏi dồn một tràng nhắc cũ khi máy bật lại).
export const TRE_TOI_DA = { mot_lan: 12 * 3600_000, lap: 2 * 3600_000 };

export function coLich() {
  try { return !userInfo().username.startsWith('ag-'); } catch { return true; }
}

const hai = (n) => String(n).padStart(2, '0');
/** Date → "YYYY-MM-DD HH:MM" theo giờ máy (không đưa ISO/UTC cho Claude — dễ nói sai giờ với chủ) */
export const gioMay = (d) => (d ? `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())} ${hai(d.getHours())}:${hai(d.getMinutes())}` : null);

function gioPhut(gio) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(gio ?? '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`giờ phải dạng HH:MM (24 giờ), nhận "${gio ?? ''}"`);
  return [+m[1], +m[2]];
}
function docLuc(luc) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(String(luc ?? '').trim());
  if (!m) throw new Error(`lúc phải dạng YYYY-MM-DD HH:MM, nhận "${luc ?? ''}"`);
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3] || +m[4] > 23 || +m[5] > 59) throw new Error(`ngày giờ không có thật: "${luc}"`);
  return d;
}
const thuCua = (d) => (d.getDay() === 0 ? 7 : d.getDay());
const ngayCuoiThang = (y, m) => new Date(y, m + 1, 0).getDate();

/**
 * Chuẩn hoá + kiểm lịch (lỗi bằng tiếng Việt). mot_lan nhận: luc "YYYY-MM-DD HH:MM", hoặc gio "HH:MM" (lần tới của giờ đó:
 * hôm nay nếu chưa qua, không thì mai), hoặc sau_phut (N phút nữa) — Claude khỏi phải tự biết hôm nay ngày mấy.
 */
export function chuanLich(l = {}, now = new Date()) {
  const kieu = l.kieu;
  if (kieu === 'mot_lan') {
    let d;
    if (l.luc) d = docLuc(l.luc);
    else if (l.sau_phut != null) {
      const n = Number(l.sau_phut);
      if (!(n >= 1 && n <= 60 * 24 * 60)) throw new Error('sau_phut phải từ 1 tới 86400');
      d = new Date(now.getTime() + n * 60_000);
      d.setSeconds(0, 0);
      if (d <= now) d = new Date(d.getTime() + 60_000);
    } else if (l.gio) {
      const [h, p] = gioPhut(l.gio);
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, p);
      if (d <= now) d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, p);
    } else throw new Error('nhắc một lần cần luc ("YYYY-MM-DD HH:MM"), gio ("HH:MM") hoặc sau_phut');
    return { kieu, luc: gioMay(d) };
  }
  const [h, p] = gioPhut(l.gio);
  const gio = `${hai(h)}:${hai(p)}`;
  if (kieu === 'ngay') return { kieu, gio };
  if (kieu === 'tuan') {
    const thu = [...new Set((Array.isArray(l.thu) ? l.thu : [l.thu]).map(Number))].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
    if (!thu.length) throw new Error('lịch tuần cần thu: 1 (thứ Hai) … 7 (Chủ nhật)');
    return thu.length === 7 ? { kieu: 'ngay', gio } : { kieu, thu, gio };
  }
  if (kieu === 'thang') {
    const ngay = Number(l.ngay);
    if (!(Number.isInteger(ngay) && ngay >= 1 && ngay <= 31)) throw new Error('lịch tháng cần ngay: 1 … 31');
    return { kieu, ngay, gio };
  }
  throw new Error('kieu phải là mot_lan, ngay, tuan hay thang');
}

// Lần xảy ra của lịch lặp rơi vào NGÀY d (giờ máy), hoặc null
function trongNgay(l, d) {
  const [h, p] = gioPhut(l.gio);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, p);
  if (l.kieu === 'ngay') return t;
  if (l.kieu === 'tuan') return l.thu.includes(thuCua(t)) ? t : null;
  if (l.kieu === 'thang') return d.getDate() === Math.min(l.ngay, ngayCuoiThang(d.getFullYear(), d.getMonth())) ? t : null;
  return null;
}

/** Lần đầu tiên SAU `sau` — null nếu không còn lần nào (một lần đã qua). */
export function lanToi(l, sau = new Date()) {
  if (l.kieu === 'mot_lan') { const d = docLuc(l.luc); return d > sau ? d : null; }
  for (let i = 0; i <= 400; i++) {
    const t = trongNgay(l, new Date(sau.getFullYear(), sau.getMonth(), sau.getDate() + i));
    if (t && t > sau) return t;
  }
  return null;
}

/** Lần gần nhất KHÔNG SAU `truoc` — null nếu chưa có lần nào. */
export function lanGanNhat(l, truoc = new Date()) {
  if (l.kieu === 'mot_lan') { const d = docLuc(l.luc); return d <= truoc ? d : null; }
  for (let i = 0; i <= 400; i++) {
    const t = trongNgay(l, new Date(truoc.getFullYear(), truoc.getMonth(), truoc.getDate() - i));
    if (t && t <= truoc) return t;
  }
  return null;
}

/** "mỗi ngày lúc 07:30" · "thứ Hai, thứ Tư hằng tuần lúc 08:00" · "ngày 5 hằng tháng lúc 09:00" · "25/09/2026 lúc 15:00" */
export function moTaLich(l) {
  if (l.kieu === 'mot_lan') { const d = docLuc(l.luc); return `${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()} lúc ${hai(d.getHours())}:${hai(d.getMinutes())}`; }
  if (l.kieu === 'ngay') return `mỗi ngày lúc ${l.gio}`;
  if (l.kieu === 'tuan') {
    // ngày liền nhau ≥ 3 thì viết gọn: [1..5] → "thứ Hai tới thứ Sáu"
    const lien = l.thu.length >= 3 && l.thu.every((t, i) => i === 0 || t === l.thu[i - 1] + 1);
    return `${lien ? `${THU[l.thu[0]]} tới ${THU[l.thu[l.thu.length - 1]]}` : l.thu.map((t) => THU[t]).join(', ')} hằng tuần lúc ${l.gio}`;
  }
  if (l.kieu === 'thang') return `ngày ${l.ngay} hằng tháng lúc ${l.gio}${l.ngay > 28 ? ' (tháng thiếu ngày thì ngày cuối tháng)' : ''}`;
  return '?';
}

/**
 * Việc tới hạn lúc `now`: mục đang bật, lần gần nhất ≤ now, SAU lần đã chạy và SAU lúc tạo. Trễ quá TRE_TOI_DA (máy tắt lâu)
 * thì bỏ lỡ — đánh dấu đã chạy mà không báo. Trả { den: [{muc, luc, tre_phut}], bo_lo: [{muc, luc}], da_chay } (id → ISO).
 */
export function denHan(ds = [], daChay = {}, now = new Date()) {
  const moi = { ...daChay };
  const den = [];
  const boLo = [];
  for (const m of ds) {
    if (!m?.id || !m.lich || m.bat === false) continue;
    let ln;
    try { ln = lanGanNhat(m.lich, now); } catch { continue; }
    if (!ln) continue;
    const moc = Math.max(daChay[m.id] ? Date.parse(daChay[m.id]) || 0 : 0, m.tao_luc ? Date.parse(m.tao_luc) || 0 : 0);
    if (!(ln.getTime() > moc)) continue;
    moi[m.id] = ln.toISOString();
    const tre = now.getTime() - ln.getTime();
    if (tre > (m.lich.kieu === 'mot_lan' ? TRE_TOI_DA.mot_lan : TRE_TOI_DA.lap)) boLo.push({ muc: m, luc: ln });
    else den.push({ muc: m, luc: ln, tre_phut: Math.floor(tre / 60_000) });
  }
  for (const id of Object.keys(moi)) if (!ds.some((m) => m?.id === id)) delete moi[id];   // mục đã xoá
  return { den, bo_lo: boLo, da_chay: moi };
}

// ---- Tệp lịch ----
export function docLich(file = LICH) {
  let j = {};
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { /* chưa có */ }
  return { phien_ban: 1, ds: Array.isArray(j.ds) ? j.ds.filter((m) => m?.id && m.lich && m.loai) : [] };
}
function ghiLich(j, file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(j, null, 1)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
// Nhắc một lần đã qua quá 2 ngày thì dọn khỏi danh sách (đã báo, hoặc đã lỡ)
const conHan = (now) => (m) => { try { return m.lich.kieu !== 'mot_lan' || docLuc(m.lich.luc) > new Date(now.getTime() - 2 * 86400_000); } catch { return false; } };
export function docDaChay(file = DA_CHAY) {
  try { return JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

export function themLich({ loai, ten, noi_dung: noiDung, ...l } = {}, file = LICH, now = new Date()) {
  if (!['nhac', 'viec'].includes(loai)) throw new Error('loai phải là nhac (nhắc chủ) hay viec (Claude tự làm theo lịch)');
  const t = String(ten ?? '').trim().slice(0, 80);
  const nd = String(noiDung ?? '').trim().slice(0, 2000);
  if (!t || !nd) throw new Error('cần ten và noi_dung');
  const lich = chuanLich(l, now);
  const toi = lanToi(lich, now);
  if (!toi) throw new Error(`${moTaLich(lich)} đã qua — chọn giờ khác`);
  const j = docLich(file);
  j.ds = j.ds.filter(conHan(now));
  const trung = j.ds.find((m) => m.loai === loai && m.noi_dung === nd && JSON.stringify(m.lich) === JSON.stringify(lich));
  if (trung) return { ...trung, mo_ta: moTaLich(trung.lich), lan_toi: gioMay(lanToi(trung.lich, now)), da_co: true };
  if (j.ds.length >= TOI_DA_MUC) throw new Error(`đã có ${TOI_DA_MUC} mục lịch — xoá bớt (lich_xoa)`);
  const m = { id: `l${randomBytes(4).toString('hex')}`, loai, ten: t, noi_dung: nd, lich, tao_luc: now.toISOString(), bat: true };
  j.ds.push(m);
  ghiLich(j, file);
  return { ...m, mo_ta: moTaLich(lich), lan_toi: gioMay(toi) };
}

export function xoaLich(id, file = LICH) {
  const j = docLich(file);
  const m = j.ds.find((x) => x.id === id);
  if (!m) throw new Error(`Không có mục lịch ${id} (xem lich_ds)`);
  j.ds = j.ds.filter((x) => x.id !== id);
  ghiLich(j, file);
  return `Đã bỏ: ${m.ten} (${moTaLich(m.lich)})`;
}

/** Danh sách cho Claude / Bàn: mô tả tiếng Việt, lần tới, lần trước (giờ máy), bỏ nhắc một lần đã qua lâu. */
export function dsLich(file = LICH, now = new Date(), daChay = docDaChay()) {
  const ds = docLich(file).ds.filter(conHan(now)).map((m) => {
    let toi = null;
    try { toi = m.bat === false ? null : lanToi(m.lich, now); } catch { /* lịch hỏng */ }
    return { ...m, mo_ta: moTaLich(m.lich), lan_toi: gioMay(toi), lan_truoc: daChay[m.id] ? gioMay(new Date(daChay[m.id])) : null };
  });
  ds.sort((a, b) => String(a.lan_toi ?? '9').localeCompare(String(b.lan_toi ?? '9')));
  return { bay_gio: gioMay(now), ds };
}

export function register(tool) {
  tool('lich_them', {
    title: 'Schedule a reminder for the owner, or a recurring task for yourself',
    description: 'loai=nhac: remind the OWNER at a time — the text pops up on the machine and the phone ("nhắc tôi 3 giờ chiều gọi anh Tuấn", '
      + '"mỗi sáng thứ Hai nhắc nộp báo cáo"). loai=viec: at that time YOU run noi_dung as a prompt, headless and READ-ONLY (Read/Grep/web/Brain; '
      + 'no commands, no file edits, nobody to ask), and your answer is sent to the owner ("mỗi sáng 7h30 tóm tắt tin thị trường vàng") — write '
      + 'noi_dung as complete instructions to your future self. Machine local time (GMT+7). kieu: mot_lan (gio "HH:MM" = the next such time, '
      + 'or sau_phut = N minutes from now, or luc "YYYY-MM-DD HH:MM"), ngay (gio, every day), tuan (thu 1=Mon…7=Sun + gio), thang (ngay 1–31 + gio). '
      + 'Dates on documents (rent due, contract expiry) still go to brain_moc_them. Tell the owner the returned mo_ta and lan_toi.',
    inputSchema: {
      loai: z.enum(['nhac', 'viec']),
      ten: z.string().max(80).describe('tên ngắn, vd "Gọi anh Tuấn", "Tin vàng buổi sáng"'),
      noi_dung: z.string().max(2000).describe('nhac: câu nhắc hiện cho chủ · viec: lời dặn đầy đủ cho chính Claude lúc chạy'),
      kieu: z.enum(['mot_lan', 'ngay', 'tuan', 'thang']),
      gio: z.string().optional().describe('HH:MM (24 giờ)'),
      sau_phut: z.number().int().min(1).max(86400).optional(),
      luc: z.string().optional().describe('YYYY-MM-DD HH:MM'),
      thu: z.array(z.number().int().min(1).max(7)).optional(),
      ngay: z.number().int().min(1).max(31).optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async (a) => JSON.stringify(themLich(a)));

  tool('lich_ds', {
    title: "List Axle's reminders and scheduled tasks",
    description: 'Every reminder / scheduled task with mo_ta (Vietnamese schedule), lan_toi (next run), lan_truoc (last run), plus bay_gio (machine time now).',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => JSON.stringify(dsLich()));

  tool('lich_xoa', {
    title: 'Remove a reminder or scheduled task',
    inputSchema: { id: z.string().max(20) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ id }) => xoaLich(id));
}
