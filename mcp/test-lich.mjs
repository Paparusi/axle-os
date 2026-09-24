// Thử Lịch của Axle (mcp/lich.js) theo giờ máy Việt Nam: chuẩn hoá lịch, lần tới / lần gần nhất, mô tả, việc tới hạn
// (không báo lặp, tạo sau giờ thì chờ lần sau, máy tắt lâu thì bỏ lỡ), tệp lịch.   node mcp/test-lich.mjs
process.env.TZ = 'Asia/Ho_Chi_Minh';
const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = (await import('node:path')).default;
const L = await import('./lich.js');

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const loi = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
const g = (s) => new Date(s.replace(' ', 'T') + ':00+07:00');   // "2026-09-24 14:10" giờ VN
const may = L.gioMay;

// ---- chuanLich ----
const now = g('2026-09-24 14:10');   // thứ Năm
ok(L.chuanLich({ kieu: 'mot_lan', gio: '15:00' }, now).luc === '2026-09-24 15:00', 'nhắc một lần "15:00" lúc 14:10 → hôm nay 15:00');
ok(L.chuanLich({ kieu: 'mot_lan', gio: '9:05' }, now).luc === '2026-09-25 09:05', '"9:05" đã qua → sáng mai 09:05');
ok(L.chuanLich({ kieu: 'mot_lan', sau_phut: 30 }, g('2026-09-24 23:45')).luc === '2026-09-25 00:15', 'sau 30 phút qua nửa đêm → ngày mai');
ok(L.chuanLich({ kieu: 'mot_lan', luc: '2026-10-01 8:00' }, now).luc === '2026-10-01 08:00', 'luc đầy đủ → chuẩn HH:MM');
ok(/không có thật/.test(loi(() => L.chuanLich({ kieu: 'mot_lan', luc: '2026-02-30 08:00' }, now))) && /HH:MM/.test(loi(() => L.chuanLich({ kieu: 'ngay', gio: '25:00' }, now))),
  'ngày không có thật / giờ sai → báo lỗi tiếng Việt');
ok(JSON.stringify(L.chuanLich({ kieu: 'tuan', thu: [5, 1, 1, 9], gio: '8:00' }, now)) === '{"kieu":"tuan","thu":[1,5],"gio":"08:00"}'
  && L.chuanLich({ kieu: 'tuan', thu: [1, 2, 3, 4, 5, 6, 7], gio: '07:00' }, now).kieu === 'ngay', 'tuần: bỏ trùng, bỏ số lạ, xếp; đủ 7 ngày → mỗi ngày');
ok(/1 … 31/.test(loi(() => L.chuanLich({ kieu: 'thang', ngay: 0, gio: '09:00' }, now))) && /kieu/.test(loi(() => L.chuanLich({ kieu: 'nam', gio: '09:00' }, now))),
  'tháng ngày 0 / kiểu lạ → lỗi');

// ---- lanToi / lanGanNhat ----
const ngay = { kieu: 'ngay', gio: '07:30' };
ok(may(L.lanToi(ngay, now)) === '2026-09-25 07:30' && may(L.lanGanNhat(ngay, now)) === '2026-09-24 07:30', 'mỗi ngày 07:30: lần tới mai, lần gần nhất sáng nay');
ok(may(L.lanToi(ngay, g('2026-09-24 07:30'))) === '2026-09-25 07:30' && may(L.lanGanNhat(ngay, g('2026-09-24 07:30'))) === '2026-09-24 07:30',
  'đúng phút đó: lần gần nhất là chính nó, lần tới là mai');
const tuan = { kieu: 'tuan', thu: [1, 3], gio: '08:00' };   // thứ Hai, thứ Tư
ok(may(L.lanToi(tuan, now)) === '2026-09-28 08:00' && may(L.lanGanNhat(tuan, now)) === '2026-09-23 08:00', 'thứ Hai, thứ Tư: từ thứ Năm → thứ Hai tới / thứ Tư vừa rồi');
const cn = { kieu: 'tuan', thu: [7], gio: '20:00' };
ok(may(L.lanToi(cn, now)) === '2026-09-27 20:00', 'Chủ nhật = 7');
const t31 = { kieu: 'thang', ngay: 31, gio: '09:00' };
ok(may(L.lanToi(t31, g('2026-09-24 10:00'))) === '2026-09-30 09:00' && may(L.lanToi(t31, g('2027-02-01 00:00'))) === '2027-02-28 09:00'
  && may(L.lanToi(t31, g('2028-02-01 00:00'))) === '2028-02-29 09:00', 'ngày 31 hằng tháng: tháng 30 ngày → 30, tháng 2 → 28/29');
ok(L.lanToi({ kieu: 'mot_lan', luc: '2026-09-24 14:00' }, now) === null && may(L.lanGanNhat({ kieu: 'mot_lan', luc: '2026-09-24 14:00' }, now)) === '2026-09-24 14:00',
  'một lần đã qua: không còn lần tới');

// ---- moTaLich ----
ok(L.moTaLich(ngay) === 'mỗi ngày lúc 07:30' && L.moTaLich(tuan) === 'thứ Hai, thứ Tư hằng tuần lúc 08:00'
  && L.moTaLich(t31).startsWith('ngày 31 hằng tháng lúc 09:00 (tháng thiếu') && L.moTaLich({ kieu: 'mot_lan', luc: '2026-09-24 15:00' }) === '24/09/2026 lúc 15:00',
  'mô tả tiếng Việt cho từng kiểu');
ok(L.moTaLich({ kieu: 'tuan', thu: [1, 2, 3, 4, 5], gio: '07:30' }) === 'thứ Hai tới thứ Sáu hằng tuần lúc 07:30'
  && L.moTaLich({ kieu: 'tuan', thu: [1, 3, 5], gio: '07:30' }) === 'thứ Hai, thứ Tư, thứ Sáu hằng tuần lúc 07:30', 'ngày liền nhau viết gọn "thứ Hai tới thứ Sáu"; cách quãng thì liệt kê');

// ---- denHan ----
const m1 = { id: 'a', loai: 'nhac', ten: 'Gọi anh Tuấn', noi_dung: 'Gọi anh Tuấn', lich: { kieu: 'mot_lan', luc: '2026-09-24 15:00' }, tao_luc: g('2026-09-24 14:10').toISOString() };
const m2 = { id: 'b', loai: 'viec', ten: 'Tin vàng', noi_dung: 'tóm tắt', lich: ngay, tao_luc: g('2026-09-20 10:00').toISOString() };
let r = L.denHan([m1, m2], {}, g('2026-09-24 14:59'));
ok(r.den.length === 0 && r.bo_lo.length === 1 && r.bo_lo[0].muc.id === 'b', '14:59: việc 07:30 sáng nay đã trễ quá 2 giờ → bỏ lỡ, không báo; nhắc 15:00 chưa tới');
r = L.denHan([m1, m2], {}, g('2026-09-24 07:31'));
ok(r.den.length === 1 && r.den[0].muc.id === 'b' && r.den[0].tre_phut === 1, '07:31: việc 07:30 tới hạn (trễ 1 phút), nhắc 15:00 chưa');
const sau731 = r.da_chay;
r = L.denHan([m1, m2], sau731, g('2026-09-24 07:32'));
ok(r.den.length === 0, '… lần xem sau: không báo lặp');
r = L.denHan([m1, m2], sau731, g('2026-09-24 15:00'));
ok(r.den.length === 1 && r.den[0].muc.id === 'a' && r.den[0].tre_phut === 0, '15:00 đúng phút: nhắc một lần tới hạn');
r = L.denHan([m1, m2], sau731, g('2026-09-24 18:10'));
ok(r.den.length === 1 && r.den[0].muc.id === 'a' && r.den[0].tre_phut === 190, 'máy tắt tới 18:10: nhắc một lần vẫn báo, kèm trễ 190 phút');
r = L.denHan([m2], sau731, g('2026-09-25 10:00'));
ok(r.den.length === 0 && r.bo_lo.length === 1 && r.da_chay.b === g('2026-09-25 07:30').toISOString(), 'việc lặp trễ quá 2 giờ → bỏ lỡ, đánh dấu đã chạy (không dồn)');
const moi = { ...m2, id: 'c', tao_luc: g('2026-09-24 08:00').toISOString() };
ok(L.denHan([moi], {}, g('2026-09-24 08:01')).den.length === 0 && L.denHan([moi], {}, g('2026-09-25 07:30')).den.length === 1,
  'tạo lúc 08:00 cho lịch 07:30 → không chạy bù sáng nay, sáng mai mới chạy');
ok(L.denHan([{ ...m2, bat: false }], {}, g('2026-09-24 07:31')).den.length === 0, 'mục đang tắt → không chạy');
ok(!('zzz' in L.denHan([m2], { zzz: 'x' }, g('2026-09-24 07:31')).da_chay), 'mục đã xoá → dọn khỏi trạng thái đã chạy');

// ---- tệp lịch ----
const D = mkdtempSync(path.join(tmpdir(), 'axle-lich-'));
const F = path.join(D, 'Axle/lich.json');
try {
  const a = L.themLich({ loai: 'nhac', ten: 'Gọi anh Tuấn', noi_dung: 'Gọi anh Tuấn về hợp đồng kho', kieu: 'mot_lan', gio: '15:00' }, F, now);
  ok(a.id && a.lan_toi === '2026-09-24 15:00' && a.mo_ta === '24/09/2026 lúc 15:00' && existsSync(F), 'themLich: nhắc 15:00 hôm nay, trả mô tả + lần tới theo giờ máy');
  const b = L.themLich({ loai: 'nhac', ten: 'Gọi anh Tuấn', noi_dung: 'Gọi anh Tuấn về hợp đồng kho', kieu: 'mot_lan', gio: '15:00' }, F, now);
  ok(b.da_co && b.id === a.id && L.docLich(F).ds.length === 1, 'themLich: y hệt → trả cái cũ, không nhân đôi');
  L.themLich({ loai: 'viec', ten: 'Tin vàng', noi_dung: 'Tóm tắt tin thị trường vàng sáng nay', kieu: 'tuan', thu: [1, 2, 3, 4, 5], gio: '07:30' }, F, now);
  ok(/viec|nhac/.test(loi(() => L.themLich({ loai: 'hen', ten: 'x', noi_dung: 'y', kieu: 'ngay', gio: '08:00' }, F, now)))
    && /đã qua/.test(loi(() => L.themLich({ loai: 'nhac', ten: 'x', noi_dung: 'y', kieu: 'mot_lan', luc: '2026-09-24 13:00' }, F, now))),
    'themLich: loại lạ / giờ đã qua → lỗi');
  const ds = L.dsLich(F, now, { [a.id]: g('2026-09-23 15:00').toISOString() });
  ok(ds.bay_gio === '2026-09-24 14:10' && ds.ds.length === 2 && ds.ds[0].id === a.id && ds.ds[1].lan_toi === '2026-09-25 07:30' && ds.ds[0].lan_truoc === '2026-09-23 15:00',
    'dsLich: giờ máy bây giờ, xếp theo lần tới, có lần trước');
  ok(L.dsLich(F, g('2026-09-27 09:00'), {}).ds.length === 1, 'nhắc một lần đã qua quá 2 ngày → không còn trong danh sách');
  ok(/Đã bỏ: Gọi anh Tuấn/.test(L.xoaLich(a.id, F)) && L.docLich(F).ds.length === 1 && /Không có/.test(loi(() => L.xoaLich(a.id, F))), 'xoaLich: bỏ được, bỏ lại thì báo không có');
} finally {
  rmSync(D, { recursive: true, force: true });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ lịch của Axle đạt');
