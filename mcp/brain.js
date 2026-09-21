// Bộ não Axle (~/Axle/Brain, docs/DESKTOP.md D13) — công cụ cho Claude trên máy TRA và GHI kho tri thức của chủ,
// theo khuôn brain của Bi: raw/ bất biến, wiki/ tự bảo trì, index.md đọc đầu tiên, git giữ lịch sử.
//
// Khoanh vùng: mọi đường dẫn là tương đối trong Brain, không leo ra ngoài; GHI chỉ vào wiki/*.md (raw/ không bao giờ
// ghi); mỗi lần ghi = một commit git (quay lại được) → vì thế brain_ghi được `axle claude` cho dùng thẳng, không hỏi.
// Chỉ trong ngữ cảnh chủ (agent phụ trong hộp cát không đọc được nhà chủ).
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const BRAIN = process.env.AXLE_BRAIN_DIR || path.join(homedir(), 'Axle/Brain');
const INIT = process.env.AXLE_BRAIN_INIT || '/opt/axle/core/desktop/brain-init.sh';
const MAX_DOC = 2 * 1024 * 1024;

export function coBrain() {
  try { return !userInfo().username.startsWith('ag-'); } catch { return true; }
}

export function khoiTao() {
  if (existsSync(path.join(BRAIN, 'QUY-UOC.md'))) return;
  if (existsSync(INIT)) execFileSync('bash', [INIT, BRAIN], { stdio: 'ignore' });
  else mkdirSync(path.join(BRAIN, 'wiki'), { recursive: true });
}

// Đường dẫn tương đối trong Brain → tuyệt đối, chặn leo thư mục; ghi=true → chỉ wiki/*.md
export function duongAnToan(p, { ghi = false } = {}) {
  const rel = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error('Đường dẫn phải tương đối trong Brain, ví dụ wiki/sources/hop-dong-abc.md');
  const abs = path.resolve(BRAIN, rel);
  if (!abs.startsWith(BRAIN + path.sep)) throw new Error('Ngoài Brain');
  if (ghi && !(abs.startsWith(path.join(BRAIN, 'wiki') + path.sep) && abs.endsWith('.md'))) throw new Error('Chỉ ghi được trang .md trong wiki/ (raw/ là bất biến)');
  return abs;
}

export function doc(p, { toiDa = 60_000 } = {}) {
  const abs = duongAnToan(p);
  const st = statSync(abs);
  if (st.isDirectory()) return readdirSync(abs).map((f) => `${f}${statSync(path.join(abs, f)).isDirectory() ? '/' : ''}`).sort().join('\n');
  if (st.size > MAX_DOC) throw new Error(`Tệp ${(st.size / 1048576).toFixed(1)}MB — quá 2MB, đọc bản đã đổi (.doi/) hoặc dùng brain_tim`);
  const s = readFileSync(abs, 'utf8');
  return s.length > toiDa ? `${s.slice(0, toiDa)}\n… (cắt, tệp dài ${s.length} ký tự — đọc tiếp bằng file_read với offset)` : s;
}

// Duyệt tệp chữ trong Brain (wiki/*.md, raw/**.txt|csv|md|json) — bỏ .git, bỏ tệp > 2MB
function* tepChu(dir, depth = 0) {
  if (depth > 6) return;
  for (const f of readdirSync(dir)) {
    if (f === '.git') continue;
    const p = path.join(dir, f);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* tepChu(p, depth + 1);
    else if (/\.(md|txt|csv|json)$/i.test(f) && st.size <= MAX_DOC) yield p;
  }
}

// Tìm theo từ khoá (không phân biệt hoa thường, mỗi từ đếm riêng) → xếp theo số lần trúng, kèm 2 dòng trích mỗi tệp
export function tim(tuKhoa, { toiDa = 12 } = {}) {
  const tu = String(tuKhoa).toLowerCase().split(/\s+/).filter((x) => x.length >= 2).slice(0, 8);
  if (!tu.length) throw new Error('Cho ít nhất một từ khoá');
  const ra = [];
  for (const p of tepChu(BRAIN)) {
    const s = readFileSync(p, 'utf8');
    const thap = s.toLowerCase();
    let diem = 0;
    for (const t of tu) { let i = -1; while ((i = thap.indexOf(t, i + 1)) !== -1 && diem < 500) diem++; }
    const rel = path.relative(BRAIN, p);
    if (tu.some((t) => rel.toLowerCase().includes(t))) diem += 5;
    if (!diem) continue;
    const dong = s.split('\n');
    const trich = dong.filter((d) => tu.some((t) => d.toLowerCase().includes(t))).slice(0, 2).map((d) => d.trim().slice(0, 200));
    ra.push({ diem, duong: rel, trich });
  }
  ra.sort((a, b) => b.diem - a.diem);
  return ra.slice(0, toiDa);
}

export function ghi(p, noiDung, cheDo = 'ghi') {
  const abs = duongAnToan(p, { ghi: true });
  if (typeof noiDung !== 'string' || noiDung.length > 200_000) throw new Error('Nội dung phải là chuỗi ≤ 200.000 ký tự');
  mkdirSync(path.dirname(abs), { recursive: true });
  if (cheDo === 'noi') appendFileSync(abs, (existsSync(abs) && !readFileSync(abs, 'utf8').endsWith('\n') ? '\n' : '') + noiDung + (noiDung.endsWith('\n') ? '' : '\n'));
  else writeFileSync(abs, noiDung);
  const rel = path.relative(BRAIN, abs);
  // git giữ lịch sử — chạy nền, hỏng thì bỏ (không có git cũng vẫn ghi được)
  execFile('git', ['-C', BRAIN, 'add', '-A'], () => execFile('git', ['-C', BRAIN, 'commit', '-qm', `Claude: ${cheDo} ${rel}`], () => {}));
  return rel;
}

export function taiLieu(toiDa = 50) {
  const f = path.join(BRAIN, 'raw/.index.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).slice(-toiDa).reverse();
}

export function register(tool) {
  const DUONG = z.string().max(300).describe('Đường dẫn tương đối trong Brain, vd wiki/index.md hay raw/2026-09/…');
  tool('brain_index', {
    title: 'Open the Axle Brain: conventions + catalog',
    description: 'Read this FIRST for any question about the owner\'s documents, customers, projects or past decisions. '
      + 'Returns QUY-UOC.md (rules and page format) and wiki/index.md (catalog of pages). Then read pages with brain_doc.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => { khoiTao(); return `# QUY-UOC.md\n${doc('QUY-UOC.md')}\n\n# wiki/index.md\n${doc('wiki/index.md')}`; });

  tool('brain_tim', {
    title: 'Search the Axle Brain',
    description: 'Keyword search across wiki pages and converted documents (CSV/text). Returns ranked paths with snippets. '
      + 'Follow up with brain_doc on the best hits.',
    inputSchema: { tu_khoa: z.string().min(2).max(200) },
    annotations: { readOnlyHint: true },
  }, async ({ tu_khoa }) => {
    khoiTao();
    const r = tim(tu_khoa);
    return r.length ? r.map((x) => `${x.duong}  (${x.diem})\n  ${x.trich.join('\n  ')}`).join('\n') : 'Không thấy gì trong Brain cho từ khoá này';
  });

  tool('brain_doc', {
    title: 'Read a Brain page or file',
    description: 'Read a wiki page, a converted document, or list a folder inside the Brain (relative path).',
    inputSchema: { duong: DUONG },
    annotations: { readOnlyHint: true },
  }, async ({ duong }) => { khoiTao(); return doc(duong); });

  tool('brain_tai_lieu', {
    title: 'List documents the owner sent',
    description: 'Most recent documents in raw/ with when, from which device, and the question asked.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    khoiTao();
    const ds = taiLieu();
    return ds.length ? ds.map((d) => `${d.luc} · ${d.ten} → ${d.duong}${d.cau ? ` · hỏi: ${String(d.cau).slice(0, 80)}` : ''}`).join('\n') : 'Chưa có tài liệu nào';
  });

  tool('brain_ghi', {
    title: 'Write or append a wiki page in the Axle Brain',
    description: 'Create/overwrite (che_do=ghi) or append (che_do=noi) a Markdown page under wiki/ following QUY-UOC.md '
      + '(YAML header, [[links]], Vietnamese). raw/ is immutable. Every write is a git commit and can be reverted; '
      + 'no owner approval needed — so keep pages factual and cite sources. Update wiki/index.md and wiki/log.md too.',
    inputSchema: { duong: DUONG, noi_dung: z.string().max(200_000), che_do: z.enum(['ghi', 'noi']).default('ghi') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ duong, noi_dung, che_do }) => { khoiTao(); return `Đã ${che_do === 'noi' ? 'nối vào' : 'ghi'} ${ghi(duong, noi_dung, che_do)}`; });
}

export const BRAIN_TOOLS = ['brain_index', 'brain_tim', 'brain_doc', 'brain_tai_lieu', 'brain_ghi'];
