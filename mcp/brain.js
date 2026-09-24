// Bộ não Axle (~/Axle/Brain, docs/DESKTOP.md D13) — công cụ cho Claude trên máy TRA và GHI kho tri thức của chủ,
// theo khuôn brain của Bi: raw/ bất biến, wiki/ tự bảo trì, index.md đọc đầu tiên, git giữ lịch sử.
//
// Khoanh vùng: mọi đường dẫn là tương đối trong Brain, không leo ra ngoài; GHI chỉ vào wiki/*.md (raw/ không bao giờ
// ghi); mỗi lần ghi = một commit git (quay lại được) → vì thế brain_ghi được `axle claude` cho dùng thẳng, không hỏi.
// Chỉ trong ngữ cảnh chủ (agent phụ trong hộp cát không đọc được nhà chủ).
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  // 24/9: nối thẳng vào cuối index.md là sinh mục trùng ("## Tài liệu (sources) (cập nhật …, tiếp)") → bắt dùng brain_index_them
  if (cheDo === 'noi' && path.relative(dir, abs) === path.join('wiki', 'index.md')) {
    throw new Error('Không nối vào wiki/index.md — dùng brain_index_them để đặt dòng vào đúng mục');
  }
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
// Tên gốc của một mục: bỏ đuôi "(cập nhật …)" mà Claude hay thêm khi nối tay — "(sources)" thì giữ
const mucGoc = (h) => h.replace(/^#+\s*/, '').replace(/\s*\((cập nhật|cap nhat|update)[^)]*\)\s*$/i, '').trim();

// Gộp mục trùng trong index.md về một mục gốc, mỗi trang một dòng (dòng xuất hiện SAU thắng — mới hơn), giữ thứ tự mục
// lần đầu xuất hiện. Sinh ra 24/9: Claude thiếu quyền dùng brain_index_them nên nối thẳng → mục nhân đôi. Trả số mục đã gộp.
export function gonIndex(dir = BRAIN) {
  const f = duongAnToan('wiki/index.md', { ghi: true, dir });
  if (!existsSync(f)) return 0;
  const cu = readFileSync(f, 'utf8');
  const dau = []; const muc = new Map(); let cur = null; let soMuc = 0;
  for (const l of cu.split('\n')) {
    if (/^##\s+/.test(l)) {
      soMuc++;
      const ten = mucGoc(l); const k = ten.toLowerCase();
      if (!muc.has(k)) muc.set(k, { ten, dong: [] });
      cur = muc.get(k);
    } else if (cur) { if (l.trim()) cur.dong.push(l); } else dau.push(l);
  }
  const cuoiCung = new Map();   // slug → [mục, dòng] lần cuối
  for (const [k, m] of muc) for (const l of m.dong) { const s = /\[\[([^\]|#]+)/.exec(l)?.[1]?.trim(); if (s) cuoiCung.set(s, [k, l]); }
  while (dau.length && dau[dau.length - 1].trim() === '') dau.pop();
  const ra = [...dau, ''];
  for (const [k, m] of muc) {
    ra.push(`## ${m.ten}`);
    for (const l of m.dong) { const s = /\[\[([^\]|#]+)/.exec(l)?.[1]?.trim(); if (!s || (cuoiCung.get(s)[0] === k && cuoiCung.get(s)[1] === l)) ra.push(l); }
    ra.push('');
  }
  const moi = ra.join('\n').replace(/\n{3,}/g, '\n\n');
  if (moi !== cu) {
    writeFileSync(f, moi);
    execFile('git', ['-C', dir, 'add', '-A'], () => execFile('git', ['-C', dir, 'commit', '-qm', 'Axle: gộp mục trùng trong index.md'], () => {}));
  }
  return soMuc - muc.size;
}

export function indexThem(muc, dong, dir = BRAIN) {
  gonIndex(dir);   // lỡ ai đó đã nối tay sinh mục trùng thì gộp trước, rồi mới đặt dòng
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
  // Tiêu đề dài mà chưa có tên ngắn (dòng `ngan:`): đồ thị phải tự cắt tên → dễ trùng nhau ("HĐ dịch vụ giới thiệu…")
  const thieuNgan = [];
  for (const [slug, t] of trang) {
    if (['index', 'log'].includes(slug)) continue;
    const dau = dauTrang(t.noiDung);
    if ((/^title:\s*(.+)$/m.exec(dau)?.[1] ?? '').trim().length > 20 && !/^ngan:\s*\S/m.test(dau)) thieuNgan.push(t.duong);
  }
  // Mục trùng trong index.md (cùng tên gốc, hoặc có đuôi "(cập nhật …)")
  const daThay = new Set(); const trungMuc = [];
  for (const l of index.split('\n')) {
    if (!/^##\s+/.test(l)) continue;
    const k = mucGoc(l).toLowerCase();
    if (daThay.has(k) || mucGoc(l) !== l.replace(/^#+\s*/, '').trim()) trungMuc.push(l.replace(/^#+\s*/, '').trim());
    daThay.add(k);
  }
  return { so_trang: trang.size, link_hong: linkHongUniq, mo_coi: moCoi, mong, thieu_dau: thieuDau, tai_lieu_chua_trang: chuaTrang,
    nguon_noi_nguon: [...nguonNoi.values()], thieu_ten_ngan: thieuNgan, index_trung_muc: trungMuc };
}

// ĐỒ THỊ liên kết wiki (app vẽ): nút = trang (slug, tiêu đề, loại), cạnh = [[link]] (một cạnh cho mỗi cặp); link tới
// trang chưa có → nút loại "thieu" để nhìn thấy lỗ hổng. index/log không vẽ (là mục lục, nối tới tất cả).
// Tên ngắn để VẼ (nhãn trên đồ thị): tiêu đề trang thường dài 50–80 ký tự ("Hợp đồng dịch vụ giới thiệu lao động Omron -
// HRVN (bản edit 21/09/2026)") — vẽ nguyên văn là nhãn đè nhau, cắt ở mép (Bi 24/9: "rối quá"). Ưu tiên dòng `ngan:` do
// Claude ghi trong YAML; không có thì cắt tạm: bỏ (…), lấy phần trước " — ", bỏ đuôi công ty, "Hợp đồng" → "HĐ".
export function tenNgan(t, toiDa = 20) {
  const s = String(t || '').replace(/\s*\([^)]*\)/g, '').split(/\s+[—–]\s+/)[0]
    .replace(/,?\s*\b(Company Limited|Co\.,?\s*Ltd\.?|Ltd\.?|JSC|Corporation|Corp\.?)\s*$/i, '')
    .replace(/^Công ty (TNHH|Cổ phần|CP)\s+/i, '').replace(/^Hợp đồng\b/i, 'HĐ')
    .replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
  return s.length > toiDa ? `${s.slice(0, toiDa - 1).trimEnd()}…` : s;
}

// Trả về đồ thị cho app: nút = trang, cạnh = [[link]] gộp hai chiều. Gói phải lọt hộp trạm (64KB đã mã hoá) → giữ
// ≤ toiDaByte JSON: quá thì giữ những trang NHIỀU liên kết nhất (cắt dần 20%), rồi bỏ cạnh chạm nút đã cắt.
export function doThi(dir = BRAIN, { toiDaNut = 400, toiDaByte = 40_000 } = {}) {
  const wiki = path.join(dir, 'wiki');
  const nut = new Map();   // slug → { id, ten, loai, duong, mo_ta }
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.md')) {
    const slug = f.replace(/\.md$/, ''); if (['index', 'log'].includes(slug)) continue;
    const s = readFileSync(p, 'utf8');
    const dau = /^---\n([\s\S]*?)\n---/.exec(s)?.[1] ?? '';
    const tenDay = (/^title:\s*(.+)$/m.exec(dau)?.[1] ?? slug).trim().replace(/^["']|["']$/g, '');
    const ngan = (/^ngan:\s*(.+)$/m.exec(dau)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
    const loai = (/^type:\s*(\w+)/m.exec(dau)?.[1] ?? path.basename(d).replace(/s$/, '') ?? 'concept').toLowerCase();
    const than = s.replace(/^---[\s\S]*?---\s*/m, '').replace(/^#.*$/mg, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim();
    // `ten` = nhãn vẽ (ngắn) — app cũ đọc đúng trường này nên đổi là thấy ngay, khỏi dựng app; `ten_day` = tiêu đề đầy đủ
    nut.set(slug, { id: slug, ten: ngan || tenNgan(tenDay), ten_day: tenDay, loai, duong: path.relative(dir, p),
      mo_ta: than.slice(0, 120).replace(/\s+/g, ' '), noiDung: s });
  } } };
  if (existsSync(wiki)) walk(wiki);
  const canh = new Map();
  for (const [a, n] of nut) {
    for (const m of n.noiDung.replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const b = m[1].trim();
      if (b === a || ['index', 'log'].includes(b)) continue;
      if (!nut.has(b)) nut.set(b, { id: b, ten: tenNgan(b), ten_day: b, loai: 'thieu', duong: '', mo_ta: 'trang chưa có (link hỏng)', noiDung: '' });
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
      + 'link that page, and remove the direct link), and pages with a long title but no short name (thieu_ten_ngan: add a '
      + '`ngan:` line, ≤20 chars, distinct from other pages, to the YAML header), and duplicated sections in index.md '
      + '(index_trung_muc: any brain_index_them call merges them). Run this FIRST when asked to LINT; fix what it lists; do not guess.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => { khoiTao(); return JSON.stringify(kiem(), null, 1); });

  tool('brain_ghi', {
    title: 'Write or append a wiki page in the Axle Brain',
    description: 'Create/overwrite (che_do=ghi) or append (che_do=noi) a Markdown page under wiki/ following QUY-UOC.md '
      + '(YAML header, [[links]], Vietnamese). raw/ is immutable. Every write is a git commit and can be reverted; '
      + 'no owner approval needed — so keep pages factual and cite sources. Update wiki/index.md (brain_index_them) and wiki/log.md (brain_log) too.',
    inputSchema: { duong: DUONG, noi_dung: z.string().max(200_000), che_do: z.enum(['ghi', 'noi']).default('ghi') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ duong, noi_dung, che_do }) => { khoiTao(); return `Đã ${che_do === 'noi' ? 'nối vào' : 'ghi'} ${ghi(duong, noi_dung, che_do)}`; });

  tool('brain_moc', {
    title: 'List dated obligations (mốc) and what is coming up',
    description: 'Every mốc in moc.json plus occurrences in the next 60 days. Call it before brain_moc_them so you do not add duplicates.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => { khoiTao(); return JSON.stringify({ moc: docMoc(), sap_toi: sapToi() }, null, 1); });

  tool('brain_moc_them', {
    title: 'Add a dated obligation (mốc) extracted from a document',
    description: 'One item per obligation that has a date: recurring payments (rent due the 10th of each month → lap=thang, den=contract end), '
      + 'expiry / renewal / notice-before-termination deadlines, price increases, warranty ends (lap=mot_lan or nam). '
      + 'viec: short Vietnamese with amount and counterparty, e.g. "Đóng tiền thuê văn phòng 17 triệu cho bà Hồng Trân". '
      + 'trang: slug of the source wiki page (write that page first). Idempotent for the same viec/ngay/lap/trang. '
      + 'The owner is reminded on the machine and on the phone nhac_truoc days before and on the day.',
    inputSchema: {
      viec: z.string().max(160),
      ngay: z.string().describe('YYYY-MM-DD — lần đầu tiên của mốc'),
      lap: z.enum(['mot_lan', 'thang', 'nam']).default('mot_lan'),
      den: z.string().optional().describe('YYYY-MM-DD — mốc lặp dừng sau ngày này (vd ngày hết hợp đồng)'),
      nhac_truoc: z.number().int().min(0).max(60).default(3),
      trang: z.string().max(200).optional().describe('slug trang wiki nguồn'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async (a) => { khoiTao(); return JSON.stringify(themMoc(a)); });

  tool('brain_moc_xoa', {
    title: 'Remove a mốc (obligation ended, or it was extracted wrongly)',
    inputSchema: { id: z.string().max(20) },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ id }) => { khoiTao(); return xoaMoc(id); });
}

// ---------- Mốc có ngày (24/9): hạn trả tiền, hết hạn, báo trước, tăng giá, bảo hành… rút từ giấy tờ ----------
// moc.json ở gốc Bộ não (git giữ lịch sử), chỉ ghi qua brain_moc_them / brain_moc_xoa. Bàn nhắc trên máy; app hẹn thông
// báo ngay trên iPhone (nội dung không đi qua trạm, máy tắt vẫn nhắc).
const LAP = ['mot_lan', 'thang', 'nam'];
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function ngayThat(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export const homNay = (t = new Date()) => iso(t.getFullYear(), t.getMonth() + 1, t.getDate());   // theo giờ máy
const cachNgay = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const congNgay = (a, n) => { const t = new Date(Date.parse(`${a}T00:00:00Z`) + n * 86_400_000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };

// Lần thứ n (từ 0) của một mốc; tháng thiếu ngày (31 → tháng 2) thì lấy ngày cuối tháng
function lanThu(ngay, lap, n) {
  if (lap === 'mot_lan') return n === 0 ? ngay : null;
  const [y, m, d] = ngay.split('-').map(Number);
  const yy = lap === 'nam' ? y + n : y + Math.floor((m - 1 + n) / 12);
  const mm = lap === 'nam' ? m : ((m - 1 + n) % 12) + 1;
  return iso(yy, mm, Math.min(d, new Date(Date.UTC(yy, mm, 0)).getUTCDate()));
}
// Các lần rơi vào [tu, den], dừng ở m.den nếu có
export function cacLan(m, tu, den) {
  const ra = [];
  for (let n = 0; n < 2400; n++) {
    const x = lanThu(m.ngay, m.lap, n);
    if (!x || x > den || (m.den && x > m.den)) break;
    if (x >= tu) ra.push(x);
  }
  return ra;
}

const fMoc = (dir) => path.join(dir, 'moc.json');
export function docMoc(dir = BRAIN) {
  try { const d = JSON.parse(readFileSync(fMoc(dir), 'utf8')); return Array.isArray(d.moc) ? d.moc : []; } catch { return []; }
}
function ghiMoc(ds, dir, viec) {
  writeFileSync(fMoc(dir), `${JSON.stringify({ phien_ban: 1, moc: ds }, null, 1)}\n`);
  execFile('git', ['-C', dir, 'add', '-A'], () => execFile('git', ['-C', dir, 'commit', '-qm', `Claude: mốc ${viec}`], () => {}));
}
function timTrang(slug, dir) {
  const tim = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) { const r = tim(p); if (r) return r; } else if (f === `${slug}.md`) return p;
    }
    return null;
  };
  try { return tim(path.join(dir, 'wiki')); } catch { return null; }
}

export function themMoc({ viec, ngay, lap = 'mot_lan', den = null, nhac_truoc: nhacTruoc = 3, trang = null } = {}, dir = BRAIN) {
  const v = String(viec ?? '').trim().replace(/\s+/g, ' ');
  if (!v || v.length > 160) throw new Error('viec: 1–160 ký tự — làm gì, bao nhiêu tiền, với ai');
  if (!ngayThat(ngay)) throw new Error('ngay: YYYY-MM-DD, ngày có thật (lần đầu tiên của mốc)');
  if (!LAP.includes(lap)) throw new Error('lap: mot_lan | thang | nam');
  if (den && (!ngayThat(den) || den < ngay)) throw new Error('den: YYYY-MM-DD, không trước ngay (vd ngày hết hợp đồng)');
  const nt = Number(nhacTruoc);
  if (!Number.isInteger(nt) || nt < 0 || nt > 60) throw new Error('nhac_truoc: số ngày 0–60');
  const sl = trang ? String(trang).replace(/^\[\[|\]\]$/g, '').trim() || null : null;
  if (sl && !timTrang(sl, dir)) throw new Error(`trang: không có wiki/**/${sl}.md — ghi trang tài liệu trước rồi mới thêm mốc`);
  const id = `m${createHash('sha1').update(`${v.toLowerCase()}|${ngay}|${lap}|${sl ?? ''}`).digest('hex').slice(0, 10)}`;
  const ds = docMoc(dir).filter((m) => m.id !== id);
  ds.push({ id, viec: v, ngay, lap, den: den || null, nhac_truoc: nt, trang: sl, tao: new Date().toISOString() });
  ds.sort((a, b) => a.ngay.localeCompare(b.ngay) || a.viec.localeCompare(b.viec));
  ghiMoc(ds, dir, v.slice(0, 60));
  return { id, lan_toi: cacLan(ds.find((m) => m.id === id), homNay(), congNgay(homNay(), 3660))[0] ?? null };
}

export function xoaMoc(id, dir = BRAIN) {
  const ds = docMoc(dir);
  const con = ds.filter((m) => m.id !== id);
  if (con.length === ds.length) throw new Error(`Không có mốc ${id}`);
  ghiMoc(con, dir, `xoá ${id}`);
  return `Đã xoá mốc ${id}`;
}

// Các lần sắp tới trong soNgay ngày: {id, viec, ngay, con, nhac (đã vào khoảng nhắc), nhac_truoc, lap, trang, ten_trang}
export function sapToi(dir = BRAIN, { tu = homNay(), soNgay = 60 } = {}) {
  const den = congNgay(tu, soNgay);
  const tenCache = new Map();
  const tenTrang = (sl) => {
    if (!sl) return null;
    if (!tenCache.has(sl)) {
      let t = sl;
      try {
        const dau = /^---\n([\s\S]*?)\n---/.exec(readFileSync(timTrang(sl, dir), 'utf8'))?.[1] ?? '';
        t = (/^ngan:\s*(.+)$/m.exec(dau)?.[1] ?? '').trim() || tenNgan((/^title:\s*(.+)$/m.exec(dau)?.[1] ?? sl).trim());
      } catch { /* trang đã xoá — giữ slug */ }
      tenCache.set(sl, t);
    }
    return tenCache.get(sl);
  };
  const ra = [];
  for (const m of docMoc(dir)) {
    for (const x of cacLan(m, tu, den)) {
      const con = cachNgay(tu, x);
      ra.push({ id: m.id, viec: m.viec, ngay: x, con, nhac: con <= m.nhac_truoc, nhac_truoc: m.nhac_truoc, lap: m.lap, trang: m.trang, ten_trang: tenTrang(m.trang) });
    }
  }
  return ra.sort((a, b) => a.ngay.localeCompare(b.ngay) || a.viec.localeCompare(b.viec));
}

export const BRAIN_TOOLS = ['brain_index', 'brain_tim', 'brain_doc', 'brain_tai_lieu', 'brain_ghi', 'brain_index_them', 'brain_log', 'brain_kiem',
  'brain_moc', 'brain_moc_them', 'brain_moc_xoa'];
