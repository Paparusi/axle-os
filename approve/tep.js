// Xem tệp trên máy từ app (24/9, Bi: "làm cho App có thể xem và đọc tệp trên máy"). CHỈ ĐỌC, chỉ trong thư mục nhà của
// chủ; không tệp/thư mục ẩn (khoá SSH, token Claude, hồ sơ trình duyệt… đều nằm trong đó); không tệp khoá (.pem, id_rsa…);
// lối tắt trỏ ra ngoài nhà hay vào chỗ ẩn thì không hiện, không mở. Tệp gửi về điện thoại là hộp niêm phong cho đúng
// điện thoại đó (trạm không đọc được), tối đa 12 MB (trạm nhận 16 MB sau mã hoá + base64).
// Máy duyệt chạy bằng root → tự kiểm quyền như CHỦ: tệp chủ không đọc được (root tạo, chmod 600…) thì cũng không gửi.
// ~/snap là dữ liệu ứng dụng (hồ sơ trình duyệt snap nằm ở đó, KHÔNG ẩn) → chặn cả thư mục; tệp cookie/mật khẩu
// trình duyệt chặn ở mọi chỗ.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const TOI_DA_BYTE = 12_000_000;
const TEP_KHOA = /\.(pem|key|p12|pfx|kdbx|keystore|jks|gpg|asc)$|^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$|^(Cookies|Login Data|Web Data|logins\.json|key[34]\.db|cookies\.sqlite|signons\.sqlite)$/i;
const CHO_UNG_DUNG = new Set(['snap']);
const coAn = (rel) => rel.split(path.sep).some((p) => p.startsWith('.'));
const choUngDung = (rel) => CHO_UNG_DUNG.has(rel.split(path.sep)[0]);

/** Chủ máy (chủ thư mục nhà) có tự đọc được không — bit r (và x với thư mục) theo lớp chủ / nhóm / người khác. */
function chuDuoc(st, nha, thuMuc) {
  const can = thuMuc ? 5 : 4;
  const lop = st.uid === nha.uid ? (st.mode >> 6) & 7 : st.gid === nha.gid ? (st.mode >> 3) & 7 : st.mode & 7;
  return (lop & can) === can;
}

/** Đường dẫn app gửi (tương đối so với nhà, "" = nhà; nhận cả "~/…") → {abs, rel} đã đi theo lối tắt, hoặc ném lỗi. */
export function duongAn(home, duong = '') {
  const vao = String(duong ?? '').replace(/^~(\/|$)/, '');
  if (vao.includes('\0')) throw new Error('Đường dẫn lạ');
  const abs = path.resolve(home, vao);
  if (abs !== home && !abs.startsWith(`${home}/`)) throw new Error('Chỉ xem được tệp trong thư mục nhà');
  if (coAn(path.relative(home, abs))) throw new Error('Tệp/thư mục ẩn không xem từ điện thoại');
  if (choUngDung(path.relative(home, abs))) throw new Error('Thư mục dữ liệu ứng dụng không xem từ điện thoại');
  if (TEP_KHOA.test(path.basename(abs))) throw new Error('Tệp khoá / mật khẩu không gửi ra khỏi máy');
  let that;
  try { that = realpathSync(abs); } catch { throw new Error('Không có tệp hay thư mục này'); }
  const nha = realpathSync(home);
  if (that !== nha && !that.startsWith(`${nha}/`)) throw new Error('Lối tắt này trỏ ra ngoài thư mục nhà');
  const rel = path.relative(nha, that);
  if (coAn(rel) || choUngDung(rel) || TEP_KHOA.test(path.basename(that))) throw new Error('Lối tắt này trỏ vào chỗ ẩn hay tệp khoá');
  const st = statSync(that);
  if (!chuDuoc(st, statSync(nha), st.isDirectory())) throw new Error('Chủ máy không có quyền đọc chỗ này');
  return { abs: that, rel };
}

/** Liệt kê một thư mục. xep "ten": thư mục trước rồi tệp, theo tên kiểu Việt (có số thì theo số); "moi": sửa gần
 *  nhất trước (tệp vừa tải / Claude vừa làm nằm trên cùng). Danh sách đi qua hộp thư thường của trạm (thân ≤ 80 KB sau
 *  niêm phong + base64) → cắt ở 400 mục VÀ ~40 KB, phần còn lại báo bằng `bot` — thư mục đông thì xếp "moi" để thấy cái mới. */
export function lietKe(home, duong = '', { toiDa = 400, toiDaByte = 40_000, xep = 'ten' } = {}) {
  const { abs, rel } = duongAn(home, duong);
  if (!statSync(abs).isDirectory()) throw new Error('Đây không phải thư mục');
  // Nhà: app hỏi "" → rel ""; thư mục con: đường tương đối thật (đã theo lối tắt) để app ghép tiếp
  const ds = [];
  for (const ten of readdirSync(abs)) {
    if (ten.startsWith('.') || TEP_KHOA.test(ten)) continue;
    const con = rel ? `${rel}/${ten}` : ten;
    try { duongAn(home, con); } catch { continue; }              // lối tắt ra ngoài / chỗ ẩn / chủ không đọc được: không hiện
    let st;
    try { st = statSync(path.join(abs, ten)); } catch { continue; }
    const thuMuc = st.isDirectory();
    if (!thuMuc && !st.isFile()) continue;                      // ổ cắm, thiết bị…
    ds.push({ ten, thu_muc: thuMuc, co: thuMuc ? null : st.size, sua: st.mtime.toISOString() });
  }
  const theoTen = (a, b) => a.ten.localeCompare(b.ten, 'vi', { numeric: true, sensitivity: 'base' });
  if (xep === 'moi') ds.sort((a, b) => b.sua.localeCompare(a.sua) || theoTen(a, b));
  else ds.sort((a, b) => (Number(b.thu_muc) - Number(a.thu_muc)) || theoTen(a, b));
  const cha = rel ? (path.dirname(rel) === '.' ? '' : path.dirname(rel)) : null;
  const gui = [];
  let byte = 0;
  for (const x of ds) {
    const b = Buffer.byteLength(JSON.stringify(x)) + 1;
    if (gui.length >= toiDa || byte + b > toiDaByte) break;
    gui.push(x);
    byte += b;
  }
  return { duong: rel, ten: rel ? path.basename(rel) : 'Nhà', cha, ds: gui, bot: ds.length - gui.length, xep: xep === 'moi' ? 'moi' : 'ten' };
}

/** Đọc một tệp để gửi về điện thoại. */
export function docTep(home, duong, { toiDa = TOI_DA_BYTE } = {}) {
  const { abs, rel } = duongAn(home, duong);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error('Đây là thư mục, không phải tệp');
  if (!st.isFile()) throw new Error('Không phải tệp thường');
  if (st.size > toiDa) throw new Error(`Tệp ${(st.size / 1e6).toFixed(1)} MB — quá lớn để gửi về điện thoại (tối đa ${toiDa / 1e6} MB)`);
  return { ten: path.basename(abs), duong: rel, co: st.size, bytes: readFileSync(abs) };
}
