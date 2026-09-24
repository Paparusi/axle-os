// Thử "máy tự báo" (approve/may-bao.js): danhGia với số đo giả cho từng tình huống, rồi đo máy này thật một lần.
//   node approve/test-may-bao.mjs
process.env.TZ = 'Asia/Ho_Chi_Minh';
const { danhGia, doDac, soSanhBan, thoiLuong } = await import('./may-bao.js');
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const PHUT = 60_000;
const t0 = Date.parse('2026-09-24T07:40:00+07:00');
const MANG_OK = { muc: 'ok', tieu_de: 'Mạng ổn' };
const MANG_HONG = { muc: 'loi', tieu_de: 'Dây có tín hiệu nhưng không router nào cấp IP', buoc_hong: 'ip' };

// Mạng: hỏng thì im (không gửi được), có lại mới báo một lần, kèm giờ và lý do lúc hỏng
let s = {};
let r = danhGia(s, { mang: MANG_OK }, t0); s = r.moi;
ok(r.su_kien.length === 0, 'mạng ổn → không báo');
r = danhGia(s, { mang: MANG_HONG }, t0 + 5 * PHUT); s = r.moi;
ok(r.su_kien.length === 0 && s.mang.hong, 'vừa mất mạng → chưa báo (không gửi ra được), nhớ lúc bắt đầu');
r = danhGia(s, { mang: { ...MANG_HONG, tieu_de: 'Không thấy router 192.168.1.1' } }, t0 + 60 * PHUT); s = r.moi;
ok(r.su_kien.length === 0 && s.mang.tu === t0 + 5 * PHUT && s.mang.tieu_de.startsWith('Dây có tín hiệu'), 'vẫn mất → không báo, giữ giờ bắt đầu và lý do lúc đầu');
r = danhGia(s, { mang: MANG_OK }, t0 + 155 * PHUT); s = r.moi;
ok(r.su_kien.length === 1 && r.su_kien[0].tieu_de === 'Máy vừa có mạng lại sau 2 giờ 30 phút'
  && r.su_kien[0].noi_dung === 'Mất từ 07:45 tới 10:15. Lúc đó: Dây có tín hiệu nhưng không router nào cấp IP.',
  `có mạng lại → báo một lần, đủ giờ + lý do (${r.su_kien[0]?.tieu_de} · ${r.su_kien[0]?.noi_dung})`);
r = danhGia(s, { mang: MANG_OK }, t0 + 160 * PHUT);
ok(r.su_kien.length === 0, 'ổn tiếp → không báo lại');
// Không tới được trạm của app → cũng không gửi được, xử lý như mất mạng
r = danhGia({}, { mang: { muc: 'canh_bao', tieu_de: 'Có mạng, nhưng không tới được trạm của app', buoc_hong: 'tram' } }, t0);
ok(r.su_kien.length === 0 && r.moi.mang.hong, 'không tới trạm → đợi có lại mới báo');
// Tailscale: để 10 phút tự lành, quá thì báo một lần
const TS = { muc: 'canh_bao', tieu_de: 'Có mạng, nhưng máy chưa vào Tailscale', giai_thich: 'Chưa vào được máy này từ xa.', buoc_hong: 'tailscale' };
s = danhGia({}, { mang: TS }, t0).moi;
r = danhGia(s, { mang: TS }, t0 + 5 * PHUT); s = r.moi;
ok(r.su_kien.length === 0, 'Tailscale hỏng 5 phút → chưa báo');
r = danhGia(s, { mang: TS }, t0 + 11 * PHUT); s = r.moi;
ok(r.su_kien.length === 1 && r.su_kien[0].tieu_de === TS.tieu_de, 'Tailscale hỏng quá 10 phút → báo');
ok(danhGia(s, { mang: TS }, t0 + 30 * PHUT).su_kien.length === 0, '… và không báo lặp');

// Ổ đĩa: ≥ 90% báo một lần, xuống dưới 85% mới báo lại được
s = {};
r = danhGia(s, { dia: { dung: 91, con_gb: 21 } }, t0); s = r.moi;
ok(r.su_kien.length === 1 && r.su_kien[0].tieu_de === 'Ổ đĩa gần đầy: 91%' && r.su_kien[0].noi_dung.startsWith('Còn 21 GB'), 'ổ 91% → báo');
r = danhGia(s, { dia: { dung: 93, con_gb: 16 } }, t0); s = r.moi;
ok(r.su_kien.length === 0, 'ổ 93% → không báo lặp');
s = danhGia(s, { dia: { dung: 80, con_gb: 47 } }, t0).moi;
ok(danhGia(s, { dia: { dung: 95, con_gb: 11 } }, t0).su_kien.length === 1, 'dọn xuống 80% rồi đầy lại 95% → báo lại');

// Dịch vụ hỏng: dịch vụ mới hỏng thì báo; wait-online bỏ qua; lành rồi hỏng lại thì báo lại
s = {};
r = danhGia(s, { dv_hong: ['NetworkManager-wait-online.service'] }, t0); s = r.moi;
ok(r.su_kien.length === 0, 'chỉ NetworkManager-wait-online hỏng (khởi động lúc mất mạng) → không báo');
r = danhGia(s, { dv_hong: ['NetworkManager-wait-online.service', 'axle-portal.service'] }, t0); s = r.moi;
ok(r.su_kien.length === 1 && r.su_kien[0].tieu_de === 'Dịch vụ hỏng: axle-portal.service' && r.su_kien[0].noi_dung.includes('systemctl status axle-portal.service'), 'dịch vụ mới hỏng → báo, kèm lệnh xem lỗi');
ok(danhGia(s, { dv_hong: ['axle-portal.service'] }, t0).su_kien.length === 0, 'vẫn hỏng → không báo lặp');
s = danhGia(s, { dv_hong: [] }, t0).moi;
ok(danhGia(s, { dv_hong: ['axle-portal.service', 'docker.service'] }, t0).su_kien[0]?.tieu_de === '2 dịch vụ hỏng', 'lành rồi hỏng lại, hỏng hai cái → báo gộp');
ok(danhGia({ dv: ['x.service'] }, { dv_hong: null }, t0).moi.dv[0] === 'x.service', 'không đo được dịch vụ → giữ nguyên trạng thái cũ');

// Bản mới: báo một lần mỗi bản
s = {};
r = danhGia(s, { ban: { dang_chay: '0.1.154', moi_nhat: '0.1.160' } }, t0); s = r.moi;
ok(r.su_kien.length === 1 && r.su_kien[0].tieu_de === 'Có Axle bản mới 0.1.160', 'có bản mới → báo');
ok(danhGia(s, { ban: { dang_chay: '0.1.154', moi_nhat: '0.1.160' } }, t0).su_kien.length === 0, '… cùng bản đó → không báo lặp');
ok(danhGia(s, { ban: { dang_chay: '0.1.160', moi_nhat: '0.1.160' } }, t0).su_kien.length === 0, 'đã lên bản mới nhất → im');
ok(soSanhBan('0.1.160', '0.1.154') > 0 && soSanhBan('0.1.99', '0.1.100') < 0 && soSanhBan('0.1.9', '0.1.9') === 0, 'so bản theo số, không theo chữ');
ok(thoiLuong(45) === '45 phút' && thoiLuong(60) === '1 giờ' && thoiLuong(150) === '2 giờ 30 phút' && thoiLuong(1500) === '1 ngày 1 giờ', 'thời lượng tiếng Việt');

// Đo thật trên máy này (kiem-mang lấy từ repo)
const dd = await doDac({ kiemMang: new URL('../core/lib/kiem-mang.py', import.meta.url).pathname });
ok(dd.mang && ['ok', 'loi', 'canh_bao'].includes(dd.mang.muc) && dd.dia && dd.dia.dung > 0 && dd.dia.dung <= 100 && (Array.isArray(dd.dv_hong) || dd.dv_hong === null),
  `đo thật: mạng ${dd.mang?.muc} · ổ ${dd.dia?.dung}% · ${dd.dv_hong?.length ?? '?'} dịch vụ hỏng`);

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ máy tự báo đạt');
