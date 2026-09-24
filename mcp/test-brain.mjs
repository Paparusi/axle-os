// Thử Bộ não Axle trên thư mục tạm: dựng bằng brain-init.sh, khoanh vùng đường dẫn, tìm, ghi + git.
//   node mcp/test-brain.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const D = mkdtempSync(path.join(tmpdir(), 'axle-brain-'));
process.env.AXLE_BRAIN_DIR = path.join(D, 'Brain');
process.env.AXLE_BRAIN_INIT = path.resolve('core/desktop/brain-init.sh');
const b = await import('./brain.js');
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
try {
  b.khoiTao();
  ok(existsSync(path.join(b.BRAIN, 'QUY-UOC.md')) && existsSync(path.join(b.BRAIN, 'wiki/index.md')) && existsSync(path.join(b.BRAIN, '.git')), 'brain-init: QUY-UOC, index, log, git');
  ok(b.doc('wiki/index.md').includes('Danh mục'), 'brain_doc đọc index');
  for (const x of ['../etc/passwd', '/etc/passwd', 'wiki/../../x', '']) { let l = ''; try { b.doc(x); } catch (e) { l = e.message; } ok(!!l, `chặn đường dẫn lạ: ${JSON.stringify(x)}`); }
  let l = ''; try { b.ghi('raw/2026-09/x.md', 'x'); } catch (e) { l = e.message; } ok(/bất biến|wiki/.test(l), 'không ghi được vào raw/');
  l = ''; try { b.ghi('wiki/sources/x.txt', 'x'); } catch (e) { l = e.message; } ok(!!l, 'wiki chỉ nhận .md');
  const rel = b.ghi('wiki/sources/hop-dong-abc-2026-09.md', '---\ntitle: Hợp đồng ABC\ntype: source\n---\nPhạt chậm giao 0,5%/ngày, tối đa 8%. [[cong-ty-abc]]');
  ok(rel === 'wiki/sources/hop-dong-abc-2026-09.md', 'brain_ghi tạo trang');
  b.ghi('wiki/log.md', '- 2026-09-21 21:00 · ingest hợp đồng ABC · [[hop-dong-abc-2026-09]]', 'noi');
  ok(readFileSync(path.join(b.BRAIN, 'wiki/log.md'), 'utf8').includes('ingest hợp đồng ABC'), 'brain_ghi nối vào log');
  mkdirSync(path.join(b.BRAIN, 'raw/2026-09/1-bang.xlsx.doi'), { recursive: true });
  writeFileSync(path.join(b.BRAIN, 'raw/2026-09/1-bang.xlsx.doi/1-bang-Sheet1.csv'), 'Tên,Lương\nNguyễn Văn A,12000000\nTrần B,9500000\n');
  const r = b.tim('phạt chậm');
  ok(r.length >= 1 && r[0].duong.includes('hop-dong-abc') && r[0].trich[0].includes('Phạt'), 'brain_tim tìm ra trang hợp đồng kèm trích');
  const r2 = b.tim('lương');
  ok(r2.some((x) => x.duong.endsWith('.csv')), 'brain_tim tìm cả CSV đã đổi trong raw/');
  ok(b.tim('khongcotuxyz').length === 0, 'không có → rỗng');
  await new Promise((r) => setTimeout(r, 1200));   // git commit chạy nền
  const logGit = execFileSync('git', ['-C', b.BRAIN, 'log', '--oneline'], { encoding: 'utf8' });
  ok(logGit.split('\n').filter(Boolean).length >= 2, `mỗi lần ghi một commit git (${logGit.split('\n').filter(Boolean).length} commit)`);
  writeFileSync(path.join(b.BRAIN, 'raw/.index.jsonl'), JSON.stringify({ sha: 'x', duong: 'raw/2026-09/1-bang.xlsx', ten: 'bang.xlsx', luc: '2026-09-21T21:00:00+07:00', thiet_bi: 'iPhone', cau: 'tổng lương' }) + '\n');
  ok(b.taiLieu()[0]?.ten === 'bang.xlsx', 'brain_tai_lieu đọc .index.jsonl');
  // index_them: idempotent, đúng mục, không nhân đôi tiêu đề
  b.indexThem('Tài liệu (sources)', '[[hop-dong-abc-2026-09]] — Hợp đồng ABC ký 15/9');
  b.indexThem('Tài liệu (sources)', '- [[hop-dong-abc-2026-09]] — Hợp đồng ABC ký 15/9, phạt 0,5%/ngày');
  b.indexThem('Khách hàng, đối tác, thực thể', '[[cong-ty-abc]] — khách sỉ Bình Dương');
  b.indexThem('Mục mới lạ', '[[x-y]] — thử mục chưa có');
  const idx = readFileSync(path.join(b.BRAIN, 'wiki/index.md'), 'utf8');
  ok((idx.match(/\[\[hop-dong-abc-2026-09\]\]/g) || []).length === 1 && idx.includes('phạt 0,5%/ngày'), 'index_them: cùng slug → thay dòng, không nhân đôi');
  ok((idx.match(/^## Tài liệu \(sources\)$/mg) || []).length === 1 && (idx.match(/^## /mg) || []).length === 7, `index_them: không nhân đôi tiêu đề, mục lạ thêm ở cuối (${(idx.match(/^## /mg) || []).length} mục)`);
  const viTri = idx.indexOf('[[cong-ty-abc]]'); const viTriMuc = idx.indexOf('## Khách hàng'); const viTriMucSau = idx.indexOf('## Tài liệu');
  ok(viTri > viTriMuc && viTri < viTriMucSau, 'index_them: dòng nằm đúng trong mục của nó');
  ok(b.logThem('ingest thử · [[hop-dong-abc-2026-09]]').endsWith('log.md') && /- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · ingest thử/.test(readFileSync(path.join(b.BRAIN, 'wiki/log.md'), 'utf8')), 'brain_log: dòng có dấu thời gian');
  // kiem: link hỏng, mồ côi, mỏng, thiếu YAML, tài liệu chưa trang
  writeFileSync(path.join(b.BRAIN, 'wiki/entities/mo-coi.md'), 'Trang này không có ai trỏ tới cả. Nó có đúng ba câu đủ dài để tính. Đây là câu thứ ba dài đủ mười lăm ký tự.');
  const k = b.kiem();
  ok(k.link_hong.some((x) => x.link === 'cong-ty-abc') && k.link_hong.some((x) => x.link === 'x-y'), `kiem: bắt link hỏng (${k.link_hong.map((x) => x.link).join(',')})`);
  ok(k.mo_coi.includes('wiki/entities/mo-coi.md'), 'kiem: trang mồ côi');
  ok(k.mong.includes('wiki/sources/hop-dong-abc-2026-09.md') && !k.mong.includes('wiki/entities/mo-coi.md'), 'kiem: trang mỏng (<3 câu), trang 3 câu thì không');
  ok(k.thieu_dau.includes('wiki/entities/mo-coi.md') && !k.thieu_dau.includes('wiki/sources/hop-dong-abc-2026-09.md'), 'kiem: thiếu YAML đầu trang');
  ok(k.tai_lieu_chua_trang.includes('bang.xlsx'), 'kiem: tài liệu trong raw chưa có trang nào nhắc');
  ok(!k.link_hong.some((x) => x.link === 'tên-trang'), 'kiem: chữ mẫu trong dấu ` không tính là link hỏng');
  b.ghi('wiki/sources/bang-luong.md', '---\ntitle: Bảng lương\ntype: source\n---\nNguồn: raw/2026-09/1-bang.xlsx. Tổng lương 21,5 triệu. Hai nhân sự.');
  ok(!b.kiem().tai_lieu_chua_trang.includes('bang.xlsx'), 'kiem: trang nhắc tên tệp raw (không phải tên gốc) → vẫn tính là có trang');
  // đồ thị liên kết
  b.ghi('wiki/entities/cong-ty-abc.md', '---\ntitle: Công ty ABC\ntype: entity\n---\nKhách sỉ. Ký [[hop-dong-abc-2026-09]] — related. Xem thêm [[bang-luong]]. Đầu mối [[nguoi-lien-he-lan]].');
  const g = b.doThi();
  const ids = g.nodes.map((n) => n.id);
  ok(!ids.includes('index') && !ids.includes('log') && ids.includes('cong-ty-abc') && ids.includes('hop-dong-abc-2026-09'), 'doThi: nút là trang, bỏ index/log');
  ok(g.nodes.find((n) => n.id === 'cong-ty-abc')?.loai === 'entity' && g.nodes.find((n) => n.id === 'cong-ty-abc')?.ten === 'Công ty ABC', 'doThi: tiêu đề + loại từ YAML');
  ok(g.edges.some((e) => [e.a, e.b].sort().join('|') === 'cong-ty-abc|hop-dong-abc-2026-09') && g.edges.filter((e) => [e.a, e.b].sort().join('|') === 'cong-ty-abc|hop-dong-abc-2026-09').length === 1, 'doThi: cạnh hai chiều gộp một (A→B và B→A)');
  ok(g.nodes.find((n) => n.id === 'nguoi-lien-he-lan')?.loai === 'thieu' && !ids.includes('x-y'), 'doThi: link tới trang chưa có → nút loại thieu (link chỉ trong index thì không vẽ)');
  ok(g.nodes.find((n) => n.id === 'cong-ty-abc')?.so_link === 3, 'doThi: đếm số link mỗi nút');
  ok(g.bo_bot === undefined && g.nodes[0].id === 'cong-ty-abc', 'doThi: nhỏ thì không cắt; nút nhiều link đứng đầu');
  for (let i = 0; i < 350; i++) writeFileSync(path.join(b.BRAIN, `wiki/concepts/kn-${i}.md`), `---\ntitle: Khái niệm số ${i} với cái tên khá là dài để nặng gói\ntype: concept\n---\n${'Mô tả dài dòng đủ một trăm hai mươi ký tự cho mỗi trang. '.repeat(4)} [[cong-ty-abc]]`);
  const g2 = b.doThi();
  const kb = JSON.stringify(g2).length;
  ok(kb <= 40_000 && g2.bo_bot > 0 && g2.nodes.length + g2.bo_bot === 350 + 5, `doThi: 355 trang → gói ${kb} byte ≤ 40KB, bỏ bớt ${g2.bo_bot} trang ít link`);
  ok(g2.nodes[0].id === 'cong-ty-abc' && g2.nodes[0].so_link === 353 && g2.edges.every((e) => g2.nodes.some((n) => n.id === e.a) && g2.nodes.some((n) => n.id === e.b)), 'doThi: giữ trang nhiều link nhất, cạnh không chạm nút đã cắt');
  ok(b.doThi(b.BRAIN, { toiDaNut: 30 }).nodes.length === 30, 'doThi: toiDaNut vẫn có hiệu lực');
  // tài liệu link thẳng tài liệu (chỉ chung một bên) → kiem báo; tài liệu → thực thể thì không
  ok(b.kiem().nguon_noi_nguon.length === 0, 'kiem: chưa có tài liệu nào link thẳng tài liệu khác');
  b.ghi('wiki/sources/hop-dong-thue-kho.md', '---\ntitle: Hợp đồng thuê kho\ntype: source\n---\nThuê kho của [[cong-ty-abc]], giá 20 triệu/tháng. Địa chỉ ABC ở đây khác trong [[hop-dong-abc-2026-09]]. Hạn một năm tính từ tháng chín.');
  const nn = b.kiem().nguon_noi_nguon;
  ok(nn.length === 1 && nn[0].trang === 'wiki/sources/hop-dong-thue-kho.md' && nn[0].link === 'hop-dong-abc-2026-09', `kiem: bắt tài liệu link thẳng tài liệu (${JSON.stringify(nn)})`);
  b.ghi('wiki/sources/hop-dong-thue-kho.md', '---\ntitle: Hợp đồng thuê kho\ntype: source\n---\nThuê kho của [[cong-ty-abc]], giá 20 triệu/tháng. Địa chỉ ABC ở đây khác ghi ở trang [[cong-ty-abc]]. Hạn một năm tính từ tháng chín.');
  ok(b.kiem().nguon_noi_nguon.length === 0, 'kiem: nối qua trang thực thể chung thì hết báo');
  // tên ngắn để vẽ đồ thị (Bi 24/9 "rối quá": tiêu đề 50–80 ký tự đè nhau)
  ok(b.tenNgan('TMDV HRVN Company Limited') === 'TMDV HRVN' && b.tenNgan('Wanek Furniture Co., Ltd (Công ty TNHH Kỹ nghệ Gỗ Hoa Nét)') === 'Wanek Furniture',
    'tenNgan: bỏ đuôi công ty và phần trong ngoặc');
  ok(b.tenNgan('Hợp đồng thuê nhà (tầng 3) — Phạm Thị Hồng Trân cho TMDV HRVN thuê') === 'HĐ thuê nhà', 'tenNgan: lấy phần trước " — ", Hợp đồng → HĐ');
  const dai = b.tenNgan('Omron Healthcare Manufacturing Vietnam Co., Ltd');
  ok(dai.length === 20 && dai.endsWith('…'), `tenNgan: quá 20 ký tự thì cắt có dấu … (${dai})`);
  b.ghi('wiki/sources/hop-dong-omron.md', '---\ntitle: Hợp đồng dịch vụ giới thiệu lao động Omron - HRVN (bản edit 21/09/2026)\nngan: HĐ Omron\ntype: source\n---\nBên B là [[cong-ty-abc]]. Phí một tháng lương. Bảo hành ba tháng.');
  const gOmron = b.doThi().nodes.find((n) => n.id === 'hop-dong-omron');
  ok(gOmron?.ten === 'HĐ Omron' && gOmron?.ten_day.startsWith('Hợp đồng dịch vụ giới thiệu lao động Omron'), 'doThi: có dòng ngan: thì nhãn = tên ngắn, ten_day = tiêu đề đủ');
  const tn = b.kiem().thieu_ten_ngan;
  ok(!tn.includes('wiki/sources/hop-dong-omron.md') && tn.includes('wiki/concepts/kn-1.md') && !tn.includes('wiki/entities/cong-ty-abc.md'),
    'kiem: tiêu đề dài chưa có ngan: thì báo; có ngan: hoặc tiêu đề ngắn thì không');
  // index.md: cấm nối tay; mục trùng (Claude nối tay 24/9) → kiem báo, gonIndex/brain_index_them gộp về mục gốc
  let loiNoi = ''; try { b.ghi('wiki/index.md', '## Tài liệu (sources) (cập nhật 2026-09-24)\n- [[x]] — y', 'noi'); } catch (e) { loiNoi = e.message; }
  ok(/brain_index_them/.test(loiNoi), 'brain_ghi không cho nối vào index.md, chỉ đường brain_index_them');
  const fIdx = path.join(b.BRAIN, 'wiki/index.md');
  writeFileSync(fIdx, readFileSync(fIdx, 'utf8') + '\n## Tài liệu (sources) (cập nhật 2026-09-24)\n- [[hop-dong-thue-kho]] — thuê kho 20 triệu\n\n## Tài liệu (sources) (cập nhật 2026-09-24, tiếp)\n- [[hop-dong-abc-2026-09]] — Hợp đồng ABC bản mới\n\n## Khách hàng, đối tác, thực thể (cập nhật 2026-09-24)\n- [[cong-ty-abc]] — khách sỉ, thêm 24/9\n');
  ok(b.kiem().index_trung_muc.length === 3, `kiem: bắt 3 mục trùng (${b.kiem().index_trung_muc.join(' | ')})`);
  ok(b.gonIndex() === 3, 'gonIndex: gộp 3 mục trùng');
  const sau = readFileSync(fIdx, 'utf8');
  ok((sau.match(/^## Tài liệu \(sources\)$/mg) || []).length === 1 && !/cập nhật/.test(sau) && (sau.match(/\[\[hop-dong-abc-2026-09\]\]/g) || []).length === 1
    && sau.includes('Hợp đồng ABC bản mới') && sau.includes('[[hop-dong-thue-kho]]') && (sau.match(/\[\[cong-ty-abc\]\]/g) || []).length === 1,
    'gonIndex: một mục gốc, mỗi trang một dòng, dòng mới hơn thắng, không mất trang nào');
  ok(b.gonIndex() === 0 && readFileSync(fIdx, 'utf8') === sau && b.kiem().index_trung_muc.length === 0, 'gonIndex: chạy lại không đổi gì, kiem hết báo');
  // mốc có ngày
  const loi = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
  ok(/ngay/.test(loi(() => b.themMoc({ viec: 'x', ngay: '2026-02-30' }))) && /lap/.test(loi(() => b.themMoc({ viec: 'x', ngay: '2026-10-10', lap: 'tuan' })))
    && /trang/.test(loi(() => b.themMoc({ viec: 'x', ngay: '2026-10-10', trang: 'khong-co-trang-nay' })))
    && /den/.test(loi(() => b.themMoc({ viec: 'x', ngay: '2026-10-10', lap: 'thang', den: '2026-01-01' }))), 'themMoc: chặn ngày không có thật, lap lạ, trang không có, den trước ngay');
  const thue = b.themMoc({ viec: 'Đóng tiền thuê kho 20 triệu cho ABC', ngay: '2026-10-10', lap: 'thang', den: '2027-08-31', nhac_truoc: 3, trang: 'hop-dong-thue-kho' });
  b.themMoc({ viec: 'Đóng tiền thuê kho 20 triệu cho ABC', ngay: '2026-10-10', lap: 'thang', den: '2027-08-31', nhac_truoc: 3, trang: '[[hop-dong-thue-kho]]' });
  b.themMoc({ viec: 'Hết hạn hợp đồng Omron', ngay: '2027-01-31', trang: 'hop-dong-omron' });
  b.themMoc({ viec: 'Trả lương cuối tháng', ngay: '2026-01-31', lap: 'thang' });
  ok(b.docMoc().length === 3 && thue.id.startsWith('m'), `themMoc: thêm trùng (cả dạng [[slug]]) thì không nhân đôi (${b.docMoc().length} mốc)`);
  const cuoiThang = b.cacLan(b.docMoc().find((m) => m.viec === 'Trả lương cuối tháng'), '2026-02-01', '2026-04-30');
  ok(JSON.stringify(cuoiThang) === '["2026-02-28","2026-03-31","2026-04-30"]', `cacLan: ngày 31 lặp tháng → tháng thiếu ngày lấy ngày cuối (${cuoiThang})`);
  ok(b.cacLan({ ngay: '2026-10-10', lap: 'thang', den: '2026-12-15' }, '2026-01-01', '2027-12-31').length === 3, 'cacLan: dừng ở ngày den');
  const st = b.sapToi(b.BRAIN, { tu: '2026-10-07', soNgay: 40 });
  const tk = st.filter((x) => x.viec.startsWith('Đóng tiền thuê kho'));
  ok(tk.length === 2 && tk[0].ngay === '2026-10-10' && tk[0].con === 3 && tk[0].nhac === true && tk[1].nhac === false && tk[0].ten_trang === 'HĐ thuê kho',
    `sapToi: lần 10/10 còn 3 ngày → đã vào khoảng nhắc; tên trang ngắn (${JSON.stringify(tk[0])})`);
  ok(st.every((x, i) => i === 0 || st[i - 1].ngay <= x.ngay) && !st.some((x) => x.viec.startsWith('Hết hạn hợp đồng Omron')), 'sapToi: xếp theo ngày, ngoài 40 ngày thì không có');
  ok(/Đã xoá/.test(b.xoaMoc(thue.id)) && b.docMoc().length === 2 && /Không có/.test(loi(() => b.xoaMoc(thue.id))), 'xoaMoc: xoá được, xoá lại thì báo không có');

  // ---- Đưa tệp vào Bộ não (themTep) — một đường cho điện thoại, Bàn, Files ----
  const NG = path.join(D, 'ngoai'); mkdirSync(NG, { recursive: true });
  writeFileSync(path.join(NG, 'Hợp đồng thuê kho (bản ký).pdf'), '%PDF-1.4 hop dong thue kho');
  writeFileSync(path.join(NG, 'ban-sao.pdf'), '%PDF-1.4 hop dong thue kho');            // cùng nội dung, khác tên
  writeFileSync(path.join(NG, 'bang-luong.xlsx'), 'PK xlsx');
  const goiDoi = [];
  const doiGia = async (f, ra) => { goiDoi.push(f); mkdirSync(ra, { recursive: true }); writeFileSync(path.join(ra, 'noi-dung.txt'), 'chữ'); };
  const t1 = await b.themTep(path.join(NG, 'Hợp đồng thuê kho (bản ký).pdf'), { thietBi: 'máy này', cau: 'đưa vào từ Files', doi: doiGia });
  ok(t1.moi && /^raw\/\d{4}-\d{2}\/\d+-Hop-dong-thue-kho-ban-ky\.pdf$/.test(t1.duong) && existsSync(t1.abs) && t1.ten === 'Hợp đồng thuê kho (bản ký).pdf',
    `themTep: vào raw/YYYY-MM/<ms>-<tên không dấu> (${t1.duong})`);
  ok(goiDoi.length === 1 && t1.doi.length === 1 && t1.doi[0].endsWith('.doi/noi-dung.txt'), 'themTep: gọi đổi bản đọc được, trả bản đổi');
  const dongIdx = readFileSync(path.join(b.BRAIN, 'raw/.index.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  const cuoi = dongIdx[dongIdx.length - 1];
  ok(cuoi.duong === t1.duong && cuoi.ten === t1.ten && cuoi.thiet_bi === 'máy này' && cuoi.cau === 'đưa vào từ Files' && /^[0-9a-f]{64}$/.test(cuoi.sha) && cuoi.luc,
    'themTep: một dòng raw/.index.jsonl đủ trường như tệp điện thoại gửi');
  const t2 = await b.themTep(path.join(NG, 'ban-sao.pdf'), { doi: doiGia });
  ok(!t2.moi && t2.duong === t1.duong && t2.da_co_tu && goiDoi.length === 1, 'themTep: trùng nội dung → dùng lại tệp cũ, không chép, không đổi lại');
  const soDong = readFileSync(path.join(b.BRAIN, 'raw/.index.jsonl'), 'utf8').trim().split('\n').length;
  ok(soDong === dongIdx.length, 'themTep: tệp trùng không thêm dòng index');
  const chowned = [];
  const t3 = await b.themTep(null, { bytes: Buffer.from('PK xlsx khac'), ten: '../../Bảng lương T9.xlsx', thietBi: 'iPhone', doi: doiGia, chown: (p) => chowned.push(p), khoiTao: false, i: 2 });
  ok(t3.moi && t3.duong.endsWith('-Bang-luong-T9.xlsx') && chowned.length === 3 && chowned.some((x) => x.endsWith('.index.jsonl')),
    `themTep (điện thoại): nhận byte, tên không leo thư mục, móc chown cho thư mục + tệp + index (${chowned.length})`);
  const loiThem = async (f, o) => { try { await b.themTep(f, o); return ''; } catch (e) { return e.message; } };
  ok(/không phải tệp/.test(await loiThem(NG)) && /không có tệp/.test(await loiThem(path.join(NG, 'khong-co.pdf'))), 'themTep: thư mục / tệp không có → báo rõ');
  writeFileSync(path.join(NG, 'to.pdf'), Buffer.alloc(2 * 1024 * 1024));
  const loiTo = await loiThem(path.join(NG, 'to.pdf'), { toiDa: 1024 * 1024 });
  ok(/to\.pdf: 2 MB — quá 1 MB/.test(loiTo) && /quá 12MB/.test(await loiThem(null, { bytes: Buffer.alloc(13 * 1024 * 1024), ten: 'to.pdf', toiDa: 12 * 1024 * 1024 })),
    `themTep: quá giới hạn → báo (máy: ${loiTo}; điện thoại 12 MB)`);
  const l2 = b.loiDanIngest([t1, t3]);
  ok(l2.startsWith('(Đính kèm 2 tệp') && l2.includes(t1.abs) && l2.includes('bản đọc được') && l2.includes('brain_index_them') && l2.includes('brain_moc_them') && !l2.includes('dòng trong wiki/index.md'),
    'loiDanIngest: kể từng tệp + bản đọc được, dặn brain_index_them (không nối tay index.md), rút mốc');
} finally {
  // brain_ghi commit git ở nền → chờ nó xong, dọn có thử lại (không thì rmdir .git/objects đua với git: ENOTEMPTY)
  await new Promise((r) => setTimeout(r, 800));
  rmSync(D, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ Bộ não Axle đạt');
