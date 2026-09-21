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
} finally {
  rmSync(D, { recursive: true, force: true });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ Bộ não Axle đạt');
