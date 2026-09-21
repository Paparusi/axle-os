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
} finally {
  rmSync(D, { recursive: true, force: true });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ Bộ não Axle đạt');
