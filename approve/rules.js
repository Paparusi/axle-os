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
  if (r.action === 'screen_grant') return 3;   // xem màn hình thật của chủ: luôn hỏi từng lần
  if (r.action === 'snapshot_undo') return 3;
  if (r.action === 'run_command' && r.params.asRoot) return 3;
  if (r.action === 'file_delete' && r.params.isDir) return 3;
  return 2;
}
export const canSession = (r) => tierOf(r) === 2;
export const canRemember = (r) => tierOf(r) === 2 && r.action !== 'file_delete';

const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ');
export function sessionScope(r) {
  switch (r.action) {
    case 'run_command': return { cwd: r.params.cwd };
    case 'service_restart': return { unit: r.params.unit };
    case 'file_delete': return { dir: path.dirname(r.params.path) };
    default: return null;
  }
}
export function ruleMatch(r) {
  switch (r.action) {
    case 'run_command': return { command: norm(r.params.command), cwd: r.params.cwd };
    case 'service_restart': return { unit: r.params.unit };
    default: return null;
  }
}
const same = (a, b) => JSON.stringify(a, Object.keys(a ?? {}).sort()) === JSON.stringify(b, Object.keys(b ?? {}).sort());

// Có luật / phiên nào cho phép tự duyệt yêu cầu này không
export function findAuto(r, R, now = Date.now()) {
  if (tierOf(r) !== 2) return null;
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
  : `Bậc 2 · có thể cho 1 giờ${canRemember(r) ? ' hoặc luôn việc này' : ''}`);

const hhmm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
export function describeRule(x, isSession) {
  const who = x.key.replace(/^phu:/, 'agent phụ ').replace(/^chu:/, '');
  const what = x.action === 'run_command'
    ? (x.match ? `lệnh \`${x.match.command}\` ở ${x.match.cwd}` : `lệnh thường ở ${x.scope.cwd}`)
    : x.action === 'service_restart' ? `khởi động lại ${(x.match ?? x.scope).unit}`
      : x.action === 'file_delete' ? `xoá file trong ${x.scope.dir}` : x.action;
  return `#${x.id} ${isSession ? `phiên tới ${hhmm(x.until)}` : 'luôn'} · ${who} · ${what}`;
}
export const autoLabel = (a) => (a.kind === 'rule' ? `luật #${a.id}` : `phiên 1 giờ #${a.id} (tới ${hhmm(a.until)})`);
