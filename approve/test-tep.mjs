// Thử xem tệp trên máy từ app (approve/tep.js) trên một "nhà" tạm: chỉ đọc trong nhà, không chỗ ẩn, không tệp khoá,
// lối tắt ra ngoài / vào chỗ ẩn bị chặn, tệp quá lớn bị chặn.   node approve/test-tep.mjs
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, truncateSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { docTep, duongAn, lietKe, TOI_DA_BYTE } from './tep.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const loi = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
const D = realpathSync(mkdtempSync(path.join(tmpdir(), 'axle-tep-')));
const H = path.join(D, 'nha');
try {
  mkdirSync(path.join(H, 'Documents/Hợp đồng'), { recursive: true });
  mkdirSync(path.join(H, 'Downloads'), { recursive: true });
  mkdirSync(path.join(H, '.ssh'), { recursive: true });
  mkdirSync(path.join(H, 'Axle/Brain/.git'), { recursive: true });
  writeFileSync(path.join(H, '.ssh/id_ed25519'), 'KHOA-BI-MAT');
  writeFileSync(path.join(H, '.ssh/config'), 'Host x');
  writeFileSync(path.join(H, 'Documents/Chi-phi-hang-thang.xlsx'), 'PK\u0003\u0004xlsx');
  writeFileSync(path.join(H, 'Documents/ban 10.txt'), 'a');
  writeFileSync(path.join(H, 'Documents/ban 9.txt'), 'b');
  writeFileSync(path.join(H, 'Documents/server.pem'), 'KHOA');
  writeFileSync(path.join(H, 'Documents/.env'), 'TOKEN=x');
  writeFileSync(path.join(H, 'Axle/Brain/QUY-UOC.md'), '# quy ước');
  writeFileSync(path.join(D, 'ngoai.txt'), 'ngoài nhà');
  symlinkSync('/etc', path.join(H, 'ra-etc'));
  symlinkSync(path.join(H, '.ssh'), path.join(H, 'khoa'));
  symlinkSync(path.join(D, 'ngoai.txt'), path.join(H, 'Documents/lien-ket-ra-ngoai.txt'));
  symlinkSync(path.join(H, 'Documents/Chi-phi-hang-thang.xlsx'), path.join(H, 'Downloads/chi-phi.xlsx'));
  mkdirSync(path.join(H, 'snap/chromium/common/chromium/Default'), { recursive: true });
  writeFileSync(path.join(H, 'snap/chromium/common/chromium/Default/Login Data'), 'MAT-KHAU');
  mkdirSync(path.join(H, 'Documents/Trình duyệt cũ'), { recursive: true });
  writeFileSync(path.join(H, 'Documents/Trình duyệt cũ/Cookies'), 'COOKIE');
  writeFileSync(path.join(H, 'Documents/Trình duyệt cũ/ghi-chu.txt'), 'ghi chú');
  writeFileSync(path.join(H, 'Documents/khoa-kin.txt'), 'bí mật');
  chmodSync(path.join(H, 'Documents/khoa-kin.txt'), 0o000);               // chủ tự khoá (hay root tạo, 600) → không gửi
  mkdirSync(path.join(H, 'Đông'), { recursive: true });
  for (let i = 0; i < 1500; i++) writeFileSync(path.join(H, 'Đông', `Hợp đồng cung ứng lao động tháng ${i} — bản ký chính thức có đóng dấu.pdf`), 'x');
  writeFileSync(path.join(H, 'Đông', 'zz-vua-tai.pdf'), 'moi');
  utimesSync(path.join(H, 'Đông', 'zz-vua-tai.pdf'), new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  writeFileSync(path.join(H, 'Downloads/to.bin'), '');
  truncateSync(path.join(H, 'Downloads/to.bin'), TOI_DA_BYTE + 1);

  const goc = lietKe(H, '');
  const ten = goc.ds.map((x) => x.ten);
  ok(goc.duong === '' && goc.cha === null && goc.ten === 'Nhà', 'nhà: đường "", không có cha');
  ok(JSON.stringify(ten) === JSON.stringify(['Axle', 'Documents', 'Downloads', 'Đông']), `nhà: không hiện .ssh, snap, lối tắt ra /etc, lối tắt vào .ssh (${ten})`);
  const dong = lietKe(H, 'Đông');
  const coGoi = Buffer.byteLength(JSON.stringify({ type: 'state', what: 'tep', data: { ...dong, hoi: 'Đông' } }));
  ok(dong.ds.length > 100 && dong.ds.length + dong.bot === 1501 && coGoi < 45_000 && dong.xep === 'ten', `thư mục 1501 tệp tên dài: gửi ${dong.ds.length}, báo còn ${dong.bot}, gói ${coGoi} byte (lọt hộp thư 80 KB)`);
  ok(!dong.ds.some((x) => x.ten === 'zz-vua-tai.pdf') && lietKe(H, 'Đông', { xep: 'moi' }).ds[0].ten === 'zz-vua-tai.pdf',
    'thư mục đông: xếp theo tên thì tệp mới bị khuất, xếp "mới nhất" thì nó nằm đầu');
  const tl = lietKe(H, 'Documents');
  ok(JSON.stringify(tl.ds.map((x) => x.ten)) === JSON.stringify(['Hợp đồng', 'Trình duyệt cũ', 'ban 9.txt', 'ban 10.txt', 'Chi-phi-hang-thang.xlsx']),
    `Documents: thư mục trước, số theo số, không .env / .pem / lối tắt ra ngoài / tệp chủ không đọc được (${tl.ds.map((x) => x.ten)})`);
  ok(lietKe(H, 'Documents/Trình duyệt cũ').ds.map((x) => x.ten).join() === 'ghi-chu.txt', 'tệp cookie trình duyệt không hiện ở bất cứ đâu');
  ok(tl.cha === '' && tl.ds.find((x) => x.ten === 'Chi-phi-hang-thang.xlsx').co === 8 && tl.ds[0].thu_muc === true && tl.ds[0].co === null, 'Documents: cha = nhà, có cỡ tệp, thư mục không có cỡ');
  ok(lietKe(H, '~/Axle/Brain').ds.map((x) => x.ten).join() === 'QUY-UOC.md', 'nhận "~/…"; Bộ não không hiện .git');

  for (const [d, m] of [['../ngoai.txt', 'trong thư mục nhà'], ['/etc', 'trong thư mục nhà'], ['.ssh', 'ẩn'], ['.ssh/id_ed25519', 'ẩn'], ['khoa/id_ed25519', 'khoá'], ['khoa/config', 'ẩn'],
    ['ra-etc/passwd', 'ngoài'], ['Documents/server.pem', 'khoá'], ['Documents/lien-ket-ra-ngoai.txt', 'ngoài'], ['Documents/khong-co.txt', 'Không có'],
    ['snap', 'dữ liệu ứng dụng'], ['snap/chromium/common/chromium/Default/Login Data', 'dữ liệu ứng dụng'], ['Documents/Trình duyệt cũ/Cookies', 'mật khẩu'],
    ['Documents/khoa-kin.txt', 'không có quyền']]) {
    ok(loi(() => docTep(H, d)).includes(m), `chặn đọc ${d} (${loi(() => docTep(H, d))})`);
  }
  const t = docTep(H, 'Documents/Chi-phi-hang-thang.xlsx');
  ok(t.ten === 'Chi-phi-hang-thang.xlsx' && t.bytes.toString('latin1') === 'PK\u0003\u0004xlsx' && t.co === 8, 'đọc tệp trong nhà: đúng tên, đúng byte');
  ok(docTep(H, 'Downloads/chi-phi.xlsx').duong === 'Documents/Chi-phi-hang-thang.xlsx', 'lối tắt trong nhà → mở tệp thật nó trỏ tới');
  ok(/quá lớn/.test(loi(() => docTep(H, 'Downloads/to.bin'))), 'tệp quá 12 MB → báo quá lớn');
  ok(/thư mục/.test(loi(() => docTep(H, 'Documents'))) && /không phải thư mục/.test(loi(() => lietKe(H, 'Documents/ban 9.txt'))), 'mở thư mục như tệp / xem tệp như thư mục → báo rõ');
  ok(duongAn(H, '').rel === '' && duongAn(H, 'Documents/../Downloads').rel === 'Downloads', 'đường có .. nhưng vẫn trong nhà thì được');
} finally {
  rmSync(D, { recursive: true, force: true });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ xem tệp trên máy đạt');
