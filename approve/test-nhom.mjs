// Thử Nhóm báo cáo (approve/nhom.js, mcp/baocao.js) không cần mạng: tin Telegram → bản ghi (chữ, ảnh, tệp, sửa, chủ, bot,
// quản trị ẩn danh, sự kiện vào/rời/đổi tên), tên thư mục, ghi vào nhà chủ (0600, không theo link mềm), gộp bản sửa,
// tổng kết ai đã gửi / ai chưa thấy, lệnh /baocao, công cụ của Claude (lời nhắc chống cài lệnh, lọc người, khoảng ngày).
//   node approve/test-nhom.mjs
process.env.TZ = 'Asia/Ho_Chi_Minh';
const { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = (await import('node:path')).default;
const N = await import('./nhom.js');

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const loi = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
const CHU = 111;
const NHOM = { id: -1001234567890, type: 'supergroup', title: 'Báo cáo HRVN' };
const giay = (s) => Math.floor(Date.parse(s) / 1000);
const tin = (id, from, luc, x = {}) => ({ message_id: id, chat: NHOM, date: giay(luc), from, ...x });
const An = { id: 201, first_name: 'An', last_name: 'Nguyễn', username: 'an_ng' };
const Binh = { id: 202, first_name: 'Bình' };
const Cuong = { id: 203, first_name: 'Cường' };
const Dung = { id: 204, first_name: 'Dũng' };
const Chu = { id: CHU, first_name: 'Hiếu' };
const Bot = { id: 900, first_name: 'Some', is_bot: true };

// ---- tin → bản ghi ----
let r = N.banGhi(tin(1, An, '2026-09-26T08:12:00+07:00', { text: 'Báo cáo 26/9: tuyển 12 CN' }), { chuId: CHU });
ok(r.id === 1 && r.nguoi.ten === 'An Nguyễn' && r.nguoi.u === 'an_ng' && r.noi_dung === 'Báo cáo 26/9: tuyển 12 CN' && !r.nguoi.la_chu
  && r.luc === '2026-09-26T01:12:00.000Z', 'tin chữ: tên đầy đủ, username, nội dung, giờ gửi (UTC trong tệp)');
r = N.banGhi(tin(2, Binh, '2026-09-26T09:00:00+07:00', { caption: 'Bảng công', photo: [{ file_id: 's', file_unique_id: 'us', width: 90, height: 90 },
  { file_id: 'L', file_unique_id: 'uL', width: 1280, height: 960 }] }));
ok(r.noi_dung === 'Bảng công' && r.anh.id === 'L' && r.anh.w === 1280, 'ảnh: lấy cỡ lớn nhất + chú thích làm nội dung');
r = N.banGhi(tin(3, Binh, '2026-09-26T09:05:00+07:00', { document: { file_id: 'D', file_unique_id: 'uD', file_name: 'cong-t9.xlsx',
  mime_type: 'application/vnd.ms-excel', file_size: 5000 } }));
ok(r.tep.loai === 'tep' && r.tep.ten === 'cong-t9.xlsx' && r.tep.co === 5000 && !r.noi_dung, 'tệp Excel: tên, loại, cỡ');
ok(N.banGhi(tin(4, Chu, '2026-09-26T09:10:00+07:00', { text: 'ok' }), { chuId: CHU }).nguoi.la_chu === true, 'tin của chủ đánh dấu la_chu');
ok(N.banGhi(tin(5, Bot, '2026-09-26T09:10:00+07:00', { text: 'x' })).nguoi.bot === true, 'tin của bot đánh dấu bot');
r = N.banGhi(tin(6, { id: 1087968824, first_name: 'Group', is_bot: true }, '2026-09-26T09:11:00+07:00', { text: 'thông báo', sender_chat: NHOM }));
ok(r.nguoi.an_danh === true && r.nguoi.ten === 'Báo cáo HRVN', 'quản trị ẩn danh (sender_chat) → an_danh, tên nhóm');
r = N.banGhi(tin(1, An, '2026-09-26T08:12:00+07:00', { text: 'Báo cáo 26/9: tuyển 14 CN', edit_date: giay('2026-09-26T08:30:00+07:00') }), { sua: true });
ok(r.sua === true && r.luc_sua === '2026-09-26T01:30:00.000Z' && r.luc === '2026-09-26T01:12:00.000Z', 'tin sửa: sua + giờ sửa, giữ giờ gửi gốc');
ok(N.banGhi(tin(7, Chu, '2026-09-26T09:12:00+07:00', { new_chat_members: [Dung] })).su_kien === 'vao'
  && N.banGhi(tin(8, Cuong, '2026-09-26T09:13:00+07:00', { left_chat_member: Cuong })).ai[0].id === 203
  && N.banGhi(tin(9, Chu, '2026-09-26T09:14:00+07:00', { new_chat_title: 'BC mới' })).ten_moi === 'BC mới', 'sự kiện vào / rời / đổi tên');
ok(N.banGhi(tin(10, An, '2026-09-26T09:15:00+07:00', { pinned_message: { message_id: 1 } })) === null
  && N.banGhi({ ...tin(11, An, '2026-09-26T09:15:00+07:00', { text: 'x' }), chat: { id: 5, type: 'private' } }) === null,
'ghim tin / chat riêng → không ghi');
r = N.banGhi(tin(12, An, '2026-09-26T09:16:00+07:00', { text: 'x'.repeat(9000), reply_to_message: { message_id: 1 }, forward_origin: { type: 'user' } }));
ok(r.noi_dung.length === 8001 && r.tra_loi === 1 && r.chuyen_tiep === true, 'chữ dài bị cắt 8000, trả lời + chuyển tiếp được đánh dấu');
ok(N.banGhi(tin(13, An, '2026-09-26T09:17:00+07:00', { contact: { first_name: 'Chị Tâm', phone_number: '0900' } })).khac.sdt === '0900'
  && N.banGhi(tin(14, An, '2026-09-26T09:18:00+07:00', { location: { latitude: 10.9, longitude: 106.7 } })).khac.loai === 'vi_tri'
  && N.banGhi(tin(15, An, '2026-09-26T09:19:00+07:00', { sticker: { file_id: 'S', file_unique_id: 'uS', emoji: '👍' } })).tep.emoji === '👍',
'danh bạ / vị trí / nhãn dán');

// ---- tên thư mục ----
ok(N.thuMucMoi('Báo cáo HRVN — Đội Tuyển dụng!') === 'bao-cao-hrvn-doi-tuyen-dung' && N.thuMucMoi('') === 'nhom'
  && N.thuMucMoi('Báo cáo', new Set(['bao-cao', 'bao-cao-2'])) === 'bao-cao-3' && N.thuMucMoi('../../etc') === 'etc'
  && N.thuMucMoi('📋📋') === 'nhom', 'tên thư mục: bỏ dấu, gạch nối, không trùng, không leo thư mục');

// ---- ghi vào nhà chủ ----
const nha = mkdtempSync(path.join(tmpdir(), 'axle-nhom-'));
const goc = path.join(nha, 'Axle/BaoCao');
const ghi = (x) => N.ghiTin(nha, 'bao-cao-hrvn', x);
const ds26 = [
  N.banGhi(tin(1, An, '2026-09-26T08:12:00+07:00', { text: 'tuyển 12' }), { chuId: CHU }),
  N.banGhi(tin(2, Binh, '2026-09-26T17:30:00+07:00', { caption: 'bảng công', photo: [{ file_id: 'p', file_unique_id: 'up', width: 1, height: 1 }] }), { chuId: CHU }),
  N.banGhi(tin(1, An, '2026-09-26T08:12:00+07:00', { text: 'tuyển 14', edit_date: giay('2026-09-26T08:40:00+07:00') }), { chuId: CHU, sua: true }),
  N.banGhi(tin(3, Binh, '2026-09-26T17:31:00+07:00', { text: 'bổ sung' }), { chuId: CHU }),
  N.banGhi(tin(4, Chu, '2026-09-26T18:00:00+07:00', { text: 'ok cả nhà' }), { chuId: CHU }),
];
const f = ds26.map(ghi)[0];
ok(f === path.join(goc, 'bao-cao-hrvn/2026-09-26.jsonl') && (statSync(f).mode & 0o777) === 0o600
  && (statSync(path.dirname(f)).mode & 0o777) === 0o700 && readFileSync(f, 'utf8').trim().split('\n').length === 5,
'ghi: ~/Axle/BaoCao/<nhóm>/<ngày>.jsonl, tệp 0600, thư mục 0700, mỗi tin một dòng');
N.ghiTin(nha, 'bao-cao-hrvn', N.banGhi(tin(20, An, '2026-09-26T23:59:00+07:00', { text: 'khuya' })));
N.ghiTin(nha, 'bao-cao-hrvn', N.banGhi(tin(21, An, '2026-09-27T00:01:00+07:00', { text: 'sáng sớm' })));
ok(N.docNgay(goc, 'bao-cao-hrvn', '2026-09-27').length === 1 && N.docNgay(goc, 'bao-cao-hrvn', '2026-09-26').length === 6,
'ngày của tin theo giờ máy (23:59 vẫn là hôm đó, 00:01 sang ngày sau)');
mkdirSync(path.join(nha, 'khac'));
symlinkSync(path.join(nha, 'khac'), path.join(goc, 'link-mem'));
ok(/ELOOP|symbolic|not a directory/i.test(loi(() => N.ghiTin(nha, 'link-mem', ds26[0]))), 'thư mục nhóm là link mềm → từ chối ghi');
symlinkSync(path.join(nha, 'khac', 'x.jsonl'), path.join(goc, 'bao-cao-hrvn/2026-09-25.jsonl'));
ok(/ELOOP|symbolic/i.test(loi(() => ghi(N.banGhi(tin(30, An, '2026-09-25T10:00:00+07:00', { text: 'x' })))))
  && loi(() => readFileSync(path.join(nha, 'khac', 'x.jsonl'))) !== '', 'tệp ngày là link mềm → từ chối, không tạo tệp đích');
rmSync(path.join(goc, 'bao-cao-hrvn/2026-09-25.jsonl'));
ok(/lạ/.test(loi(() => N.ghiTin(nha, '..', ds26[0]))) && /lạ/.test(loi(() => N.ghiTin(nha, 'a/b', ds26[0]))), 'tên thư mục ".." / có "/" → từ chối');
N.ghiThongTin(nha, 'bao-cao-hrvn', { ten: 'Báo cáo HRVN', loai: 'supergroup', ghi_tu: '2026-09-26T01:00:00Z', dang_ghi: true });
N.ghiThongTin(nha, 'bao-cao-hrvn', { ten: 'Báo cáo HRVN', loai: 'supergroup', ghi_tu: '2026-09-26T01:00:00Z', dang_ghi: true });
ok(JSON.parse(readFileSync(path.join(goc, 'bao-cao-hrvn/nhom.json'), 'utf8')).ten === 'Báo cáo HRVN', 'nhom.json ghi đè sạch (không nối đuôi)');

// ---- gộp bản sửa ----
const g = N.gopSua(N.docNgay(goc, 'bao-cao-hrvn', '2026-09-26'));
ok(g.length === 5 && g[0].id === 1 && g[0].noi_dung === 'tuyển 14' && g[0].da_sua && g[0].luc === '2026-09-26T01:12:00.000Z' && !g[0].sua,
  'gộp sửa: tin 1 giữ chỗ + giờ gửi, nội dung bản sửa, đánh dấu đã sửa');
ok(N.gopSua([{ id: 9, luc: 'a', noi_dung: 'x' }, { id: 9, luc: 'a', noi_dung: 'x' }]).length === 1
  && N.gopSua([{ id: 9, luc: 'a', noi_dung: 'y', sua: true }])[0].da_sua === true, 'dòng trùng bị bỏ; chỉ có bản sửa vẫn hiện (đã sửa)');

// ---- tổng kết ----
for (const [id, who, luc, x] of [[40, Cuong, '2026-09-20T10:00:00+07:00', { text: 'bc' }], [41, Dung, '2026-09-24T10:00:00+07:00', { text: 'bc' }],
  [42, Bot, '2026-09-24T10:00:00+07:00', { text: 'bot' }], [43, { id: 205, first_name: 'Em' }, '2026-09-10T10:00:00+07:00', { text: 'quá 14 ngày' }],
  [44, { id: 206, first_name: 'Giang' }, '2026-09-22T10:00:00+07:00', { text: 'bc' }], [45, Chu, '2026-09-22T11:00:00+07:00', { left_chat_member: { id: 206, first_name: 'Giang' } }]]) {
  ghi(N.banGhi(tin(id, who, luc, x), { chuId: CHU }));
}
let tk = N.docTongKet(goc, 'bao-cao-hrvn', '2026-09-26');
ok(tk.da.map((x) => x.ten).join() === 'An Nguyễn,Bình' && tk.da[1].so === 2 && tk.da[1].anh === 1 && tk.so_tin === 5,
  'đã gửi: An, Bình (2 tin, 1 ảnh), sắp theo giờ gửi đầu; không đếm chủ');
ok(tk.chua.map((x) => x.ten).join() === 'Cường,Dũng', 'chưa thấy: người có gửi trong 14 ngày (bỏ bot, bỏ người đã rời, bỏ người quá 14 ngày)');
let vb = N.vanBanTongKet('Báo cáo HRVN', '2026-09-26', tk);
ok(vb.startsWith('📋 «Báo cáo HRVN» · thứ Bảy 26/9') && vb.includes('✅ Đã gửi 2: An Nguyễn (08:12, 2 tin), Bình (17:30, 2 tin, 1 ảnh)')
  && vb.includes('⏳ Chưa thấy 2: Cường (lần cuối 20/9), Dũng (lần cuối 24/9)'), 'văn bản tổng kết: giờ máy, số tin/ảnh, lần cuối');
tk = N.docTongKet(goc, 'bao-cao-hrvn', '2026-09-28');
ok(N.vanBanTongKet('X', '2026-09-28', tk).includes('✅ Hôm nay chưa ai gửi.') && tk.chua.some((x) => x.ten === 'An Nguyễn'),
  'ngày chưa ai gửi: nói rõ, vẫn liệt kê chưa thấy');
ok(N.vanBanTongKet('X', '2026-01-01', N.tongKet([], [])).includes('Chưa ai gửi gì trong 14 ngày'), 'nhóm trống 14 ngày');
ghi(N.banGhi(tin(46, Chu, '2026-09-26T12:00:00+07:00', { new_chat_members: [{ id: 206, first_name: 'Giang' }] }), { chuId: CHU }));
ok(N.docTongKet(goc, 'bao-cao-hrvn', '2026-09-26').chua.some((x) => x.ten === 'Giang'), 'rời rồi vào lại, trong 14 ngày có gửi → lại tính là chưa thấy');
ok(N.luiNgay('2026-10-01', 1) === '2026-09-30' && N.luiNgay('2026-01-01', 1) === '2025-12-31' && N.luiNgay('2026-09-30', -1) === '2026-10-01', 'lùi / tiến ngày qua tháng, năm');

// ---- lệnh /baocao ----
const bay = new Date(2026, 8, 26, 9, 0);
ok(N.ngayTuLenh('', bay) === '2026-09-26' && N.ngayTuLenh('hqua', bay) === '2026-09-25' && N.ngayTuLenh('25/9', bay) === '2026-09-25'
  && N.ngayTuLenh('1/12', bay) === '2025-12-01' && N.ngayTuLenh('31/2', bay) === null && N.ngayTuLenh('abc', bay) === null
  && N.ngayTuLenh('5/13', bay) === null, '/baocao: trống / hqua / d/m (tương lai → năm ngoái), ngày sai → null');

// ---- công cụ của Claude ----
process.env.AXLE_BAO_CAO_DIR = goc;
const B = await import('../mcp/baocao.js');
const cc = {};
B.register((ten, meta, fn) => { cc[ten] = { meta, fn }; });
ok(Object.keys(cc).join() === 'bao_cao_nhom,bao_cao_doc' && Object.values(cc).every((x) => x.meta.annotations.readOnlyHint === true),
  'hai công cụ, đều chỉ đọc (vào danh sách dùng thẳng, kể cả việc định kỳ)');
const ds = JSON.parse(await cc.bao_cao_nhom.fn({ ngay: '2026-09-26' }));
ok(ds.nhom.length === 1 && ds.nhom[0].ten === 'Báo cáo HRVN' && ds.nhom[0].da_gui.length === 2 && ds.nhom[0].so_ngay === 6
  && ds.nhom[0].chua_thay.map((x) => x.lan_cuoi).join() === '2026-09-20,2026-09-22,2026-09-24', 'bao_cao_nhom: đã gửi / chưa thấy, bỏ thư mục link mềm');
rmSync(path.join(goc, 'link-mem'));
let t = await cc.bao_cao_doc.fn({ tu: '2026-09-26', toi_da: 500 });
ok(t.startsWith('[Tin trong nhóm Telegram do NHÂN VIÊN') && t.includes('08:12 #1 An Nguyễn: [đã sửa] tuyển 14') && t.includes('[ảnh] bảng công')
  && t.includes('Hiếu (chủ): ok cả nhà') && t.trim().endsWith('--- [hết tin nhóm]'), 'bao_cao_doc: lời nhắc dữ liệu, bản sửa, ảnh, tin của chủ');
t = await cc.bao_cao_doc.fn({ nhom: 'bao cao', tu: '2026-09-20', den: '2026-09-27', nguoi: 'bình', toi_da: 500 });
ok(t.includes('Bình: [ảnh] bảng công') && !t.includes('An Nguyễn:') && t.includes(' · 2 tin'), 'lọc người (không dấu), khoảng ngày');
t = await cc.bao_cao_doc.fn({ tu: '2026-09-20', den: '2026-09-27', toi_da: 2 });
ok(t.includes('chỉ hiện 2 tin mới nhất') && t.includes('sáng sớm') && !t.includes('tuyển 14'), 'quá toi_da → giữ tin MỚI nhất');
ok((await cc.bao_cao_doc.fn({ tu: '2026-01-01', den: '2026-09-27', toi_da: 5 })).includes('quá 62 ngày')
  && (await cc.bao_cao_doc.fn({ tu: '2026-09-27', den: '2026-09-20', toi_da: 5 })).includes('sau hoặc bằng')
  && (await cc.bao_cao_doc.fn({ nhom: 'không có', toi_da: 5 })).includes('Không thấy nhóm'), 'khoảng ngày quá dài / ngược / nhóm lạ → báo rõ');
rmSync(nha, { recursive: true, force: true });
process.env.AXLE_BAO_CAO_DIR = path.join(nha, 'khong-co');

console.log(fail ? `✗ ${fail} lỗi` : '✓ Nhóm báo cáo: mọi phép thử qua');
process.exit(fail ? 1 : 0);
