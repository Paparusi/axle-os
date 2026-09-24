// Duyệt 4 bậc: xếp bậc yêu cầu, nhớ "1 giờ" / "luôn việc này", nút bấm theo bậc.
// Tách thành hàm thuần (trừ đọc/ghi file) để thử không cần máy: node approve/test-rules.mjs
//
// Bậc 2 · hỏi một lần, nhớ được: lệnh thường, khởi động lại dịch vụ, xoá MỘT file (xoá: chỉ nhớ 1 giờ)
// Bậc 3 · luôn hỏi, không nhớ: lệnh root, xoá cả thư mục, undo hệ thống
// "Luôn việc này" nhớ ĐÚNG việc đó (đúng lệnh + đúng thư mục / đúng dịch vụ); "1 giờ" nhớ cùng loại việc trong
// cùng phạm vi (cùng thư mục chạy lệnh / cùng dịch vụ / cùng thư mục xoá). Luật gắn theo agent.
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

export const RULES_FILE = process.env.AXLE_APPROVE_RULES || '/var/lib/axle-approve/rules.json';
export const SESSION_MS = 3600_000;
const EMPTY = () => ({ next: 1, rules: [], sessions: [] });

// Ghi chịu mất điện: tạm → fsync → giữ .bak → thay → fsync thư mục
export function writeDurable(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}`;
  const fd = openSync(tmp, 'w', 0o600);
  writeSync(fd, data);
  fsyncSync(fd);
  closeSync(fd);
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  renameSync(tmp, file);
  const dfd = openSync(path.dirname(file), 'r');
  fsyncSync(dfd);
  closeSync(dfd);
}

export function loadRules(file = RULES_FILE) {
  for (const f of [file, `${file}.bak`]) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      return { next: j.next ?? 1, rules: j.rules ?? [], sessions: j.sessions ?? [] };
    } catch { /* thử bản sao lưu */ }
  }
  return EMPTY();
}
export const saveRules = (R, file = RULES_FILE) => writeDurable(file, `${JSON.stringify(R, null, 1)}\n`);

// Luật gắn theo agent: agent phụ theo socket; chủ/trợ lý chính theo nhãn (ssh:<tên> do khoá ép)
export const keyOf = (r) => (r.who?.agent ? `phu:${r.who.agent}` : `chu:${r.client}`);

export function tierOf(r) {
  if (r.action === 'login') return 3;          // người xin CHƯA chứng minh là ai: không bao giờ nhớ, hỏi từng lần
  if (r.action === 'claude_tool') return r.params.nguy || r.params.mo ? 3 : 2;   // Claude xin công cụ: phá máy, hay không rõ đích → bậc 3
  if (r.action === 'screen_grant') return 3;   // xem màn hình thật của chủ: luôn hỏi từng lần
  if (r.action === 'snapshot_undo') return 3;
  if (r.action === 'thu_gui') return 3;        // thư đi ra ngoài, gửi rồi không rút lại được: duyệt TỪNG lá, không "1 giờ", không "Luôn"
  if (r.action === 'run_command' && r.params.asRoot) return 3;
  if (r.action === 'file_delete' && r.params.isDir) return 3;
  return 2;
}
export const canSession = (r) => tierOf(r) === 2;
// Công cụ gốc của Claude Code mà đích đổi liên tục (mỗi lần một câu lệnh, một tệp): "Luôn việc này" nhớ ĐÚNG đích nên gần
// như không bao giờ khớp lại — 24/9 Bi bấm "Luôn" 9 lần mà vẫn bị hỏi tiếp. Với mấy công cụ này chỉ còn Lần này / 1 giờ.
const DICH_DOI = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const canRemember = (r) => tierOf(r) === 2 && r.action !== 'file_delete'
  && !(r.action === 'claude_tool' && DICH_DOI.has(r.params?.tool));

// ---- Lệnh Bash CHỈ ĐỌC của Claude: tự duyệt, khỏi hỏi (24/9: 13 lần duyệt trong một giờ, phần lớn ls/cat/wc) ----
// Bộ phân tích CHẶT: tách theo | || && ; xuống dòng (ngoài dấu nháy); mỗi đoạn phải là một chương trình chỉ-đọc trong danh
// sách; không lệnh con $( ) hay dấu huyền, không <( ) >( ), không ghi ra tệp (chỉ cho > /dev/null và 2>&1), không chạy nền,
// không gán biến trước lệnh, không đụng đường dẫn nhạy cảm (khoá SSH, vault, token). Không chắc → false → vẫn hỏi như cũ.
// (Công cụ Read/Grep/Glob của Claude vốn đã đọc được tệp không cần hỏi; đây chỉ là phần tương đương qua Bash.)
const CHI_DOC = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'which', 'file', 'stat', 'du', 'df', 'pwd', 'echo', 'printf', 'grep', 'egrep',
  'fgrep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'date', 'whoami', 'id', 'uname', 'hostname', 'free', 'uptime', 'ps', 'jq', 'tree', 'realpath',
  'readlink', 'basename', 'dirname', 'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'nl', 'column', 'cd', 'true', 'false', 'test', 'pdfinfo']);
const NHAY_CAM = /(^|\/)\.ssh(\/|$)|\/brain\/vault|axle-vault|\.config\/axle|\.gnupg|\.aws|\.netrc|id_(rsa|ed25519|ecdsa)|(^|\/)\.env(\.|$)|\/etc\/shadow/;
function doanChiDoc(d) {
  if (!d) return true;                             // "a; ; b" hay dấu ; cuối câu
  const tu = d.match(/(?:[^\s'"]+|'[^']*'|"(?:\\.|[^"\\])*")+/g) || [];
  const conLai = [];
  for (let i = 0; i < tu.length; i++) {
    const m = /^(\d?&?>{1,2}|<)(.*)$/.exec(tu[i]);
    if (m) {                                       // chuyển hướng: chỉ cho vứt đi hoặc gộp 2>&1; đọc từ tệp bằng "<" thì được
      const dich = m[2] || tu[++i] || '';
      if (m[1] === '<') { if (dich.startsWith('<') || NHAY_CAM.test(dich)) return false; continue; }
      if (dich === '/dev/null' || dich === '&1' || dich === '&2') continue;
      return false;
    }
    conLai.push(tu[i]);
  }
  if (!conLai.length) return false;
  const [lenh, ...doi] = conLai;
  if (!CHI_DOC.has(lenh)) return false;           // gán biến trước lệnh, /bin/rm, python3… đều rơi ở đây
  const tran = doi.map((x) => x.replace(/^['"]|['"]$/g, ''));
  if (tran.some((x) => NHAY_CAM.test(x))) return false;
  if (lenh === 'sort' && tran.some((x) => x === '-o' || x.startsWith('--output') || /^-[a-zA-Z]*o/.test(x))) return false;
  if (lenh === 'tree' && tran.some((x) => x === '-o')) return false;
  if (lenh === 'uniq' && tran.filter((x) => !x.startsWith('-')).length >= 2) return false;   // uniq vào ra: tệp thứ hai bị GHI
  if (lenh === 'date' && tran.some((x) => x === '-s' || x.startsWith('--set'))) return false;
  if (lenh === 'hostname' && tran.some((x) => !x.startsWith('-'))) return false;             // hostname <tên> = đổi tên máy
  return true;
}
export function chiDoc(cmd) {
  const s = String(cmd ?? '');
  if (!s.trim() || s.length > 2000 || /[\x00-\x08\x0e-\x1f]/.test(s)) return false;
  const doan = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; const n = s[i + 1];
    if (q) {
      if (c === q) { q = null; cur += c; continue; }
      if (q === '"' && (c === '`' || (c === '$' && n === '('))) return false;   // "…$(…)…" vẫn chạy lệnh
      if (q === '"' && c === '\\') { cur += c + (n ?? ''); i++; continue; }
      cur += c; continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i++; continue; }
    if (c === '`' || (c === '$' && n === '(') || ((c === '<' || c === '>') && n === '(')) return false;
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && n === '&')) {
      doan.push(cur); cur = '';
      if ((c === '|' && n === '|') || (c === '&' && n === '&')) i++;
      continue;
    }
    if (c === '&' && s[i - 1] !== '>' && n !== '>') return false;   // "&" lẻ = chạy nền; chỉ cho trong 2>&1 và &>/dev/null
    cur += c;
  }
  if (q) return false;
  doan.push(cur);
  return doan.every((d) => doanChiDoc(d.trim()));
}

const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ');
export function sessionScope(r) {
  switch (r.action) {
    case 'run_command': return { cwd: r.params.cwd };
    case 'service_restart': return { unit: r.params.unit };
    case 'file_delete': return { dir: path.dirname(r.params.path) };
    // "1 giờ" = cho Claude TỰ LÀM mọi việc thường (bậc 2: Bash, sửa tệp ở đâu cũng được, công cụ Axle) trong 1 giờ. Trước
    // 24/9 phiên chỉ phủ đúng một công cụ + một thư mục → đổi sang sửa tệp chỗ khác là lại hỏi. Việc nguy hiểm (bậc 3) vẫn hỏi.
    case 'claude_tool': return { claude: true };
    default: return null;
  }
}
export function ruleMatch(r) {
  switch (r.action) {
    case 'run_command': return { command: norm(r.params.command), cwd: r.params.cwd };
    case 'service_restart': return { unit: r.params.unit };
    // "Luôn việc này": đúng công cụ + đúng lệnh (Bash) hoặc đúng tệp (Edit/Write)
    case 'claude_tool': return { tool: r.params.tool, command: r.params.command ? norm(r.params.command) : null, file: r.params.file ?? null };
    default: return null;
  }
}
const same = (a, b) => JSON.stringify(a, Object.keys(a ?? {}).sort()) === JSON.stringify(b, Object.keys(b ?? {}).sort());

// Có luật / phiên nào cho phép tự duyệt yêu cầu này không
export function findAuto(r, R, now = Date.now()) {
  if (tierOf(r) !== 2) return null;
  if (r.action === 'claude_tool' && r.params?.chiDoc && !r.params.nguy && !r.params.mo) return { kind: 'chi_doc' };
  const k = keyOf(r);
  const m = ruleMatch(r);
  const rule = m && R.rules.find((x) => x.key === k && x.action === r.action && same(x.match, m));
  if (rule) return { kind: 'rule', id: rule.id };
  const sc = sessionScope(r);
  const ses = sc && R.sessions.find((x) => x.key === k && x.action === r.action && Date.parse(x.until) > now && same(x.scope, sc));
  if (ses) return { kind: 'session', id: ses.id, until: ses.until };
  return null;
}

export function addRule(R, r, now = Date.now()) {
  const id = R.next++;
  R.rules.push({ id, key: keyOf(r), action: r.action, match: ruleMatch(r), created: new Date(now).toISOString() });
  return id;
}
export function addSession(R, r, now = Date.now()) {
  const id = R.next++;
  R.sessions.push({ id, key: keyOf(r), action: r.action, scope: sessionScope(r), until: new Date(now + SESSION_MS).toISOString() });
  return id;
}

// Luật/phiên của ai còn "sống": agent phụ / trợ lý SSH phải còn trong sổ khoá (mcp-clients.json). Riêng Claude có sẵn
// trên máy (`axle claude` → `axle mcp --as claude`, nhãn ssh:claude) KHÔNG vào bằng khoá SSH nên không bao giờ có trong sổ
// — trước 24/9 bộ dọn 3 giây/lần coi nó là "đã gỡ" và xoá mọi phiên "1 giờ" / luật "Luôn" của nó ngay sau khi tạo
// (Bi: "bấm 2 lần 1 giờ rồi mà vẫn vậy").
export const TRO_LY_CO_SAN = new Set(['claude']);
export function khoaSong(k, names = []) {
  const m = /^(?:phu:|chu:ssh:)([a-z][a-z0-9-]{1,20})$/.exec(k);
  if (!m) return true;
  return names.includes(m[1]) || (k.startsWith('chu:ssh:') && TRO_LY_CO_SAN.has(m[1]));
}

// Bỏ phiên hết hạn và luật/phiên của agent đã bị gỡ. Trả true nếu có thay đổi.
export function prune(R, isLive, now = Date.now()) {
  const before = R.rules.length + R.sessions.length;
  R.sessions = R.sessions.filter((s) => Date.parse(s.until) > now && isLive(s.key));
  R.rules = R.rules.filter((x) => isLive(x.key));
  return R.rules.length + R.sessions.length !== before;
}

export function keyboard(r) {
  const b = (text, d) => ({ text, callback_data: `${r.id}:${r.nonce}:${d}` });
  if (tierOf(r) === 3) return [[b('✅ Lần này', 'a'), b('❌ Từ chối', 'r')]];
  return [[b('✅ Lần này', 'a'), b('✅ 1 giờ', 'h')], canRemember(r) ? [b('✅ Luôn việc này', 'l'), b('❌ Từ chối', 'r')] : [b('❌ Từ chối', 'r')]];
}
export const tierLine = (r) => (tierOf(r) === 3
  ? '⚠️ Bậc 3 · việc hệ trọng, luôn phải hỏi'
  : r.action === 'claude_tool'
    ? `Bậc 2 · bấm "1 giờ": Claude tự làm các việc thường trong 1 giờ tới, khỏi hỏi từng cái (việc nguy hiểm vẫn hỏi)${canRemember(r) ? ' · "Luôn": luôn cho công cụ này' : ''}`
    : `Bậc 2 · có thể cho 1 giờ${canRemember(r) ? ' hoặc luôn việc này' : ''}`);

const hhmm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
export function describeRule(x, isSession) {
  const who = x.key.replace(/^phu:/, 'agent phụ ').replace(/^chu:/, '');
  const what = x.action === 'run_command'
    ? (x.match ? `lệnh \`${x.match.command}\` ở ${x.match.cwd}` : `lệnh thường ở ${x.scope.cwd}`)
    : x.action === 'service_restart' ? `khởi động lại ${(x.match ?? x.scope).unit}`
      : x.action === 'file_delete' ? `xoá file trong ${x.scope.dir}`
        : x.action === 'claude_tool' ? (x.match
          ? `Claude dùng ${x.match.tool}${x.match.command ? ` \`${x.match.command}\`` : x.match.file ? ` vào ${x.match.file}` : ''}`
          : x.scope.claude ? 'Claude tự làm các việc thường' : `Claude dùng ${x.scope.tool}${x.scope.dir ? ` trong ${x.scope.dir}` : ''}`)
          : x.action;
  return `#${x.id} ${isSession ? `phiên tới ${hhmm(x.until)}` : 'luôn'} · ${who} · ${what}`;
}
export const autoLabel = (a) => (a.kind === 'rule' ? `luật #${a.id}` : a.kind === 'chi_doc' ? 'chỉ đọc' : `phiên 1 giờ #${a.id} (tới ${hhmm(a.until)})`);
