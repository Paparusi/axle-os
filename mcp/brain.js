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

// Mọi hàm nhận `dir` (mặc định BRAIN của tài khoản đang chạy) — bộ duyệt chạy root thì chỉ vào nhà chủ.
export function khoiTao(dir = BRAIN) {
  if (existsSync(path.join(dir, 'QUY-UOC.md'))) return;
  if (existsSync(INIT)) execFileSync('bash', [INIT, dir], { stdio: 'ignore' });
  else mkdirSync(path.join(dir, 'wiki'), { recursive: true });
}

// Đường dẫn tương đối trong Brain → tuyệt đối, chặn leo thư mục; ghi=true → chỉ wiki/*.md
export function duongAnToan(p, { ghi = false, dir = BRAIN } = {}) {
  const rel = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error('Đường dẫn phải tương đối trong Brain, ví dụ wiki/sources/hop-dong-abc.md');
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(dir + path.sep)) throw new Error('Ngoài Brain');
  if (ghi && !(abs.startsWith(path.join(dir, 'wiki') + path.sep) && abs.endsWith('.md'))) throw new Error('Chỉ ghi được trang .md trong wiki/ (raw/ là bất biến)');
  return abs;
}

export function doc(p, { toiDa = 60_000, dir = BRAIN } = {}) {
  const abs = duongAnToan(p, { dir });
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
export function tim(tuKhoa, { toiDa = 12, dir = BRAIN } = {}) {
  const tu = String(tuKhoa).toLowerCase().split(/\s+/).filter((x) => x.length >= 2).slice(0, 8);
  if (!tu.length) throw new Error('Cho ít nhất một từ khoá');
  const ra = [];
  if (!existsSync(dir)) return ra;
  for (const p of tepChu(dir)) {
    const s = readFileSync(p, 'utf8');
    const thap = s.toLowerCase();
    let diem = 0;
    for (const t of tu) { let i = -1; while ((i = thap.indexOf(t, i + 1)) !== -1 && diem < 500) diem++; }
    const rel = path.relative(dir, p);
    if (tu.some((t) => rel.toLowerCase().includes(t))) diem += 5;
    if (!diem) continue;
    const dong = s.split('\n');
    const trich = dong.filter((d) => tu.some((t) => d.toLowerCase().includes(t))).slice(0, 2).map((d) => d.trim().slice(0, 200));
    ra.push({ diem, duong: rel, trich });
  }
  ra.sort((a, b) => b.diem - a.diem);
  return ra.slice(0, toiDa);
}

export function ghi(p, noiDung, cheDo = 'ghi', dir = BRAIN) {
  const abs = duongAnToan(p, { ghi: true, dir });
  if (typeof noiDung !== 'string' || noiDung.length > 200_000) throw new Error('Nội dung phải là chuỗi ≤ 200.000 ký tự');
  mkdirSync(path.dirname(abs), { recursive: true });
  if (cheDo === 'noi') appendFileSync(abs, (existsSync(abs) && !readFileSync(abs, 'utf8').endsWith('\n') ? '\n' : '') + noiDung + (noiDung.endsWith('\n') ? '' : '\n'));
  else writeFileSync(abs, noiDung);
  const rel = path.relative(dir, abs);
  // git giữ lịch sử — chạy nền, hỏng thì bỏ (không có git cũng vẫn ghi được)
  execFile('git', ['-C', dir, 'add', '-A'], () => execFile('git', ['-C', dir, 'commit', '-qm', `Claude: ${cheDo} ${rel}`], () => {}));
  return rel;
}

export function taiLieu(toiDa = 50, dir = BRAIN) {
  const f = path.join(dir, 'raw/.index.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).slice(-toiDa).reverse();
}

// Thêm/thay MỘT dòng trang vào đúng mục của wiki/index.md — idempotent theo [[slug]] (có rồi thì thay dòng), không nhân
// đôi tiêu đề mục (lỗi 21/9: Claude "nối" cả khối vào index.md → 6 mục trống + 3 mục trùng, LINT phải dọn). Mục không
// có thì tạo ở cuối.
export function indexThem(muc, dong, dir = BRAIN) {
  const f = duongAnToan('wiki/index.md', { ghi: true, dir });
  const slug = /\[\[([^\]]+)\]\]/.exec(dong)?.[1];
  if (!slug) throw new Error('Dòng phải chứa [[tên-trang]]');
  const mucSach = String(muc).replace(/^#+\s*/, '').trim();
  if (!mucSach) throw new Error('Cần tên mục (vd "Tài liệu (sources)")');
  const dongSach = `- ${String(dong).trim().replace(/^-\s*/, '')}`;
  let lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n') : ['# Danh mục Bộ não Axle', ''];
  lines = lines.filter((l) => !(l.startsWith('- ') && l.includes(`[[${slug}]]`)));   // bỏ dòng cũ của trang này ở mọi mục
  let i = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === mucSach.toLowerCase());
  if (i === -1) { if (lines[lines.length - 1] !== '') lines.push(''); lines.push(`## ${mucSach}`, ''); i = lines.length - 2; }
  let j = i + 1;
  while (j < lines.length && !/^##\s+/.test(lines[j])) j++;      // cuối mục
  while (j > i + 1 && lines[j - 1] === '') j--;                     // chèn trước dòng trống cuối mục
  lines.splice(j, 0, dongSach);
  writeFileSync(f, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
  execFile('git', ['-C', dir, 'add', '-A'], () => execFile('git', ['-C', dir, 'commit', '-qm', `Claude: index ${slug}`], () => {}));
  return `Đã đặt [[${slug}]] vào mục "${mucSach}"`;
}

// Một dòng nhật ký có dấu thời gian (giờ máy)
export function logThem(viec, dir = BRAIN) {
  const t = new Date();
  const hh = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return ghi('wiki/log.md', `- ${hh} · ${String(viec).trim().replace(/\s+/g, ' ')}`, 'noi', dir);
}

// KIỂM ĐỊNH máy móc (không để Claude tự nhìn rồi bảo "không có link hỏng" như 21/9): link hỏng, trang mồ côi (không ai
// trỏ tới và không có trong index), trang mỏng (<3 câu nội dung), trang thiếu YAML đầu, tài liệu raw chưa có trang sources.
export function kiem(dir = BRAIN) {
  const wiki = path.join(dir, 'wiki');
  const trang = new Map();   // slug → { duong, noiDung }
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.md')) trang.set(f.replace(/\.md$/, ''), { duong: path.relative(dir, p), noiDung: readFileSync(p, 'utf8') }); } };
  if (existsSync(wiki)) walk(wiki);
  const linkHong = [], moCoi = [], mong = [], thieuDau = [];
  const duocTro = new Set();
  const index = trang.get('index')?.noiDung ?? '';
  for (const [slug, t] of trang) {
    const khongMa = t.noiDung.replace(/`[^`\n]*`/g, '');   // link trong dấu ` (chữ mẫu, ví dụ) không tính
    for (const m of khongMa.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const den = m[1].trim();
      if (trang.has(den)) duocTro.add(den); else linkHong.push({ trang: t.duong, link: den });
    }
    if (['index', 'log'].includes(slug)) continue;
    const than = t.noiDung.replace(/^---[\s\S]*?---\s*/m, '').replace(/\[\[[^\]]+\]\]/g, '');
    if (!/^---\n(?:[\s\S]*?\n)?title:/m.test(t.noiDung)) thieuDau.push(t.duong);
    if ((than.match(/[^.!?…\n]{15,}[.!?…]/g) || []).length < 3) mong.push(t.duong);
  }
  for (const [slug, t] of trang) {
    if (['index', 'log'].includes(slug)) continue;
    if (!duocTro.has(slug) && !index.includes(`[[${slug}]]`)) moCoi.push(t.duong);
  }
  // Tài liệu "có trang" khi trang nào đó nhắc tên gốc HOẶC tên tệp trong raw (Claude hay ghi đường dẫn raw, không ghi tên gốc)
  const chuaTrang = taiLieu(200, dir).filter((d) => {
    const dau = [d.ten, path.basename(String(d.duong || ''))].filter(Boolean);
    return !dau.some((x) => [...trang.values()].some((t) => t.noiDung.includes(x)));
  }).map((d) => d.ten).slice(0, 20);
  const linkHongUniq = [...new Map(linkHong.map((x) => [`${x.trang}|${x.link}`, x])).values()];
  // Hai trang tài liệu (sources) link thẳng nhau: thường chỉ là trích một chi tiết của bên chung. Bi 24/9: hợp đồng thuê
  // nhà ↔ hợp đồng Omron chỉ chung HRVN (Claude trích chỗ lệch địa chỉ) mà đồ thị vẽ như hai hợp đồng liên quan.
  // Hợp lệ chỉ khi cái này sửa đổi / thay thế / là phụ lục của cái kia — LINT xem từng cặp.
  const dauTrang = (s) => /^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? '';
  const laNguon = (t) => t.duong.startsWith('wiki/sources/') || /^type:\s*source\b/m.test(dauTrang(t.noiDung));
  const nguonNoi = new Map();
  for (const [slug, t] of trang) {
    if (!laNguon(t)) continue;
    for (const m of t.noiDung.replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const den = m[1].trim();
      const t2 = trang.get(den);
      if (den === slug || !t2 || !laNguon(t2)) continue;
      const k = [slug, den].sort().join('|');
      if (!nguonNoi.has(k)) nguonNoi.set(k, { trang: t.duong, link: den });
    }
  }
  return { so_trang: trang.size, link_hong: linkHongUniq, mo_coi: moCoi, mong, thieu_dau: thieuDau, tai_lieu_chua_trang: chuaTrang,
    nguon_noi_nguon: [...nguonNoi.values()] };
}

// ĐỒ THỊ liên kết wiki (app vẽ): nút = trang (slug, tiêu đề, loại), cạnh = [[link]] (một cạnh cho mỗi cặp); link tới
// trang chưa có → nút loại "thieu" để nhìn thấy lỗ hổng. index/log không vẽ (là mục lục, nối tới tất cả).
// Trả về đồ thị cho app: nút = trang, cạnh = [[link]] gộp hai chiều. Gói phải lọt hộp trạm (64KB đã mã hoá) → giữ
// ≤ toiDaByte JSON: quá thì giữ những trang NHIỀU liên kết nhất (cắt dần 20%), rồi bỏ cạnh chạm nút đã cắt.
export function doThi(dir = BRAIN, { toiDaNut = 400, toiDaByte = 40_000 } = {}) {
  const wiki = path.join(dir, 'wiki');
  const nut = new Map();   // slug → { id, ten, loai, duong, mo_ta }
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.md')) {
    const slug = f.replace(/\.md$/, ''); if (['index', 'log'].includes(slug)) continue;
    const s = readFileSync(p, 'utf8');
    const dau = /^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? '';
    const ten = (/^title:\s*(.+)$/m.exec(dau)?.[1] ?? slug).trim().replace(/^["']|["']$/g, '');
    const loai = (/^type:\s*(\w+)/m.exec(dau)?.[1] ?? path.basename(d).replace(/s$/, '') ?? 'concept').toLowerCase();
    const than = s.replace(/^---[\s\S]*?---\s*/m, '').replace(/^#.*$/mg, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim();
    nut.set(slug, { id: slug, ten, loai, duong: path.relative(dir, p), mo_ta: than.slice(0, 120).replace(/\s+/g, ' '), noiDung: s });
  } } };
  if (existsSync(wiki)) walk(wiki);
  const canh = new Map();
  for (const [a, n] of nut) {
    for (const m of n.noiDung.replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const b = m[1].trim();
      if (b === a || ['index', 'log'].includes(b)) continue;
      if (!nut.has(b)) nut.set(b, { id: b, ten: b, loai: 'thieu', duong: '', mo_ta: 'trang chưa có (link hỏng)', noiDung: '' });
      const k = [a, b].sort().join('|');
      if (!canh.has(k)) canh.set(k, { a, b });
    }
  }
  const bac = new Map();
  for (const e of canh.values()) { bac.set(e.a, (bac.get(e.a) || 0) + 1); bac.set(e.b, (bac.get(e.b) || 0) + 1); }
  const tatCa = [...nut.values()].map(({ noiDung, ...x }) => ({ ...x, so_link: bac.get(x.id) || 0 }))
    .sort((x, y) => y.so_link - x.so_link || (x.loai === 'thieu') - (y.loai === 'thieu') || x.ten.localeCompare(y.ten, 'vi'));
  let n = Math.min(toiDaNut, tatCa.length);
  for (;;) {
    const nodes = tatCa.slice(0, n);
    const co = new Set(nodes.map((x) => x.id));
    const g = { nodes, edges: [...canh.values()].filter((e) => co.has(e.a) && co.has(e.b)) };
    if (n <= 20 || JSON.stringify(g).length <= toiDaByte) { if (n < tatCa.length) g.bo_bot = tatCa.length - n; return g; }
    n = Math.floor(n * 0.8);
  }
}

// Gói Bộ não cho app (`query brain`): danh mục, tài liệu gần nhất, nhật ký gần nhất, đếm — cắt cho vừa hộp trạm (≤48KB)
export function choApp(dir = BRAIN) {
  const co = existsSync(path.join(dir, 'QUY-UOC.md'));
  const cat = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
  const dem = (d, loc) => { let n = 0; try { for (const f of readdirSync(d)) { const p = path.join(d, f); const st = statSync(p); if (st.isDirectory()) n += f.endsWith('.doi') ? 0 : dem(p, loc); else if (loc(f)) n++; } } catch { /* rỗng */ } return n; };
  if (!co) return { co: false, index: '', log: [], tai_lieu: [], so_tep: 0, so_trang: 0 };
  const log = (() => { try { return readFileSync(path.join(dir, 'wiki/log.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).slice(-20).reverse(); } catch { return []; } })();
  return { co: true, index: cat((() => { try { return readFileSync(path.join(dir, 'wiki/index.md'), 'utf8'); } catch { return ''; } })(), 20_000),
    log, tai_lieu: taiLieu(30, dir).map((t) => ({ ten: t.ten, luc: t.luc, cau: String(t.cau || '').slice(0, 100), duong: t.duong })),
    so_tep: dem(path.join(dir, 'raw'), (f) => !f.startsWith('.')), so_trang: dem(path.join(dir, 'wiki'), (f) => f.endsWith('.md')) };
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

  tool('brain_index_them', {
    title: 'Put a page line into a section of wiki/index.md',
    description: 'Idempotent: one line "- [[slug]] — what it is" under the given section ("Tài liệu (sources)", "Khách hàng, đối tác, thực thể", '
      + '"Dự án / mảng việc", "Quyết định", "Bài học", "Khái niệm, quy trình"). Replaces an existing line for the same [[slug]]; never duplicates headers. '
      + 'Use this instead of appending to index.md.',
    inputSchema: { muc: z.string().max(80), dong: z.string().max(600) },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ muc, dong }) => { khoiTao(); return indexThem(muc, dong); });

  tool('brain_log', {
    title: 'Append a timestamped line to wiki/log.md',
    inputSchema: { viec: z.string().max(400).describe('Việc vừa làm, kèm [[trang]] liên quan') },
    annotations: { readOnlyHint: false },
  }, async ({ viec }) => { khoiTao(); return `Đã ghi log: ${logThem(viec)}`; });

  tool('brain_kiem', {
    title: 'Mechanical lint of the Brain',
    description: 'Deterministic check: broken [[links]], orphan pages, thin pages (<3 sentences), pages missing the YAML header, '
      + 'documents in raw/ with no page mentioning them, and source pages linking directly to another source page (nguon_noi_nguon: '
      + 'allowed only when one amends/replaces/annexes the other; otherwise move the shared detail to the common entity page, '
      + 'link that page, and remove the direct link). Run this FIRST when asked to LINT; fix what it lists; do not guess.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => { khoiTao(); return JSON.stringify(kiem(), null, 1); });

  tool('brain_ghi', {
    title: 'Write or append a wiki page in the Axle Brain',
    description: 'Create/overwrite (che_do=ghi) or append (che_do=noi) a Markdown page under wiki/ following QUY-UOC.md '
      + '(YAML header, [[links]], Vietnamese). raw/ is immutable. Every write is a git commit and can be reverted; '
      + 'no owner approval needed — so keep pages factual and cite sources. Update wiki/index.md and wiki/log.md too.',
    inputSchema: { duong: DUONG, noi_dung: z.string().max(200_000), che_do: z.enum(['ghi', 'noi']).default('ghi') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ duong, noi_dung, che_do }) => { khoiTao(); return `Đã ${che_do === 'noi' ? 'nối vào' : 'ghi'} ${ghi(duong, noi_dung, che_do)}`; });
}

export const BRAIN_TOOLS = ['brain_index', 'brain_tim', 'brain_doc', 'brain_tai_lieu', 'brain_ghi', 'brain_index_them', 'brain_log', 'brain_kiem'];
