// Thử luật duyệt 4 bậc: node approve/test-rules.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addRule, addSession, canRemember, findAuto, keyboard, loadRules, prune, saveRules, tierOf, SESSION_MS } from './rules.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const cog = (params, action = 'run_command') => ({ id: 'aaaa0001', nonce: 'n', action, params, client: 'ssh:cog', who: { agent: null } });
const bot = (params, action = 'run_command') => ({ id: 'aaaa0002', nonce: 'n', action, params, client: 'http:bot2 (user ag-bot2)', who: { agent: 'bot2' } });
const R = { next: 1, rules: [], sessions: [] };
const T0 = Date.parse('2026-09-19T10:00:00Z');

ok(tierOf(cog({ command: 'ls', cwd: '/w' })) === 2, 'lệnh thường = bậc 2');
ok(tierOf(cog({ command: 'ls', cwd: '/w', asRoot: true })) === 3, 'lệnh root = bậc 3');
ok(tierOf(cog({ number: 5 }, 'snapshot_undo')) === 3, 'undo = bậc 3');
ok(tierOf(cog({ path: '/w/d', isDir: true }, 'file_delete')) === 3, 'xoá thư mục = bậc 3');
ok(tierOf(cog({ path: '/w/f.txt' }, 'file_delete')) === 2 && !canRemember(cog({ path: '/w/f.txt' }, 'file_delete')), 'xoá 1 file = bậc 2 nhưng không cho "luôn"');
ok(keyboard(cog({ command: 'ls', cwd: '/w', asRoot: true })).flat().length === 2, 'bậc 3 chỉ có 2 nút (Lần này, Từ chối)');
ok(keyboard(cog({ command: 'ls', cwd: '/w' })).flat().map((b) => b.callback_data.slice(-1)).join('') === 'ahlr', 'bậc 2 có 4 nút a/h/l/r');
ok(!keyboard(cog({ path: '/w/f' }, 'file_delete')).flat().some((b) => b.callback_data.endsWith(':l')), 'xoá file: không có nút "luôn"');

const test = cog({ command: 'npm   test', cwd: '/p/x' });
addRule(R, test, T0);
ok(findAuto(cog({ command: 'npm test', cwd: '/p/x' }), R, T0)?.kind === 'rule', 'luật "luôn" khớp đúng lệnh (bỏ qua khoảng trắng thừa)');
ok(!findAuto(cog({ command: 'npm test && rm -rf ~', cwd: '/p/x' }), R, T0), 'lệnh khác (dù bắt đầu giống) → KHÔNG khớp');
ok(!findAuto(cog({ command: 'npm test', cwd: '/p/y' }), R, T0), 'đúng lệnh nhưng thư mục khác → KHÔNG khớp');
ok(!findAuto(cog({ command: 'npm test', cwd: '/p/x', asRoot: true }), R, T0), 'đúng lệnh nhưng root → KHÔNG tự duyệt (bậc 3)');
ok(!findAuto(bot({ command: 'npm test', cwd: '/p/x' }), R, T0), 'luật của cog KHÔNG áp cho agent khác (bot2)');

addSession(R, cog({ command: 'make', cwd: '/p/z' }), T0);
ok(findAuto(cog({ command: 'make build', cwd: '/p/z' }), R, T0 + 60_000)?.kind === 'session', 'phiên 1 giờ: lệnh khác cùng thư mục → tự duyệt');
ok(!findAuto(cog({ command: 'make', cwd: '/p/other' }), R, T0 + 60_000), 'phiên 1 giờ: thư mục khác → hỏi lại');
ok(!findAuto(cog({ command: 'make', cwd: '/p/z' }), R, T0 + SESSION_MS + 1), 'phiên quá 1 giờ → hết');
addSession(R, cog({ path: '/p/z/a.txt' }, 'file_delete'), T0);
ok(findAuto(cog({ path: '/p/z/b.txt' }, 'file_delete'), R, T0)?.kind === 'session', 'phiên xoá: file khác cùng thư mục → tự duyệt');
ok(!findAuto(cog({ path: '/p/z/sub', isDir: true }, 'file_delete'), R, T0), 'phiên xoá KHÔNG áp cho xoá cả thư mục (bậc 3)');

// Claude Code trên máy xin công cụ (cầu xin phép): phá máy thì bậc 3, còn lại bậc 2 và nhớ được
const ct = (tool, extra = {}) => cog({ tool, input: {}, command: null, file: null, nguy: false, ...extra }, 'claude_tool');
ok(tierOf(ct('Edit', { file: '/home/admin_1/work/a.js' })) === 2, 'Claude sửa tệp trong work → bậc 2');
ok(tierOf(ct('Bash', { command: 'sudo rm -rf /', nguy: true })) === 3, 'Claude chạy lệnh nguy hiểm → bậc 3, không nhớ');
ok(!canRemember(ct('Bash', { command: 'sudo ls', nguy: true })), 'bậc 3 thì không có nút "luôn việc này"');
addRule(R, ct('Bash', { command: 'npm test', cwd: '/p' }), T0);
ok(findAuto(ct('Bash', { command: 'npm  test' }), R, T0)?.kind === 'rule', 'luật "luôn": cùng lệnh (bỏ qua khoảng trắng thừa) → tự duyệt');
ok(!findAuto(ct('Bash', { command: 'npm publish' }), R, T0), 'luật "luôn": lệnh khác → hỏi');
addSession(R, ct('Edit', { file: '/p/z/a.js' }), T0);
ok(findAuto(ct('Edit', { file: '/p/z/b.js' }), R, T0)?.kind === 'session', 'phiên 1 giờ: Edit tệp khác cùng thư mục → tự duyệt');
ok(!findAuto(ct('Write', { file: '/p/z/c.js' }), R, T0), 'phiên 1 giờ: công cụ khác (Write) → hỏi lại');
ok(!findAuto(ct('Edit', { file: '/etc/hosts', nguy: true }), R, T0), 'phiên không bao giờ áp cho việc nguy hiểm');

const changed = prune(R, (k) => k !== 'chu:ssh:cog', T0);
ok(changed && R.rules.length === 0 && R.sessions.length === 0, 'gỡ agent → luật + phiên của nó bị xoá');

const D = mkdtempSync(path.join(tmpdir(), 'axle-rules-'));
const f = path.join(D, 'rules.json');
const R2 = { next: 1, rules: [], sessions: [] };
addRule(R2, test, T0);
saveRules(R2, f);
saveRules(R2, f);           // lần 2 → có .bak
writeFileSync(f, '');       // giả mất điện: file rỗng
ok(loadRules(f).rules.length === 1, 'file luật rỗng (mất điện) → đọc bản sao lưu');
rmSync(D, { recursive: true, force: true });

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ luật duyệt 4 bậc đạt');
