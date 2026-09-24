// Thử luật duyệt 4 bậc: node approve/test-rules.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addRule, addSession, canRemember, chiDoc, findAuto, keyboard, loadRules, prune, saveRules, tierOf, tierLine, SESSION_MS } from './rules.js';

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
// Từ 24/9 "1 giờ" phủ MỌI việc thường của Claude (Bi: "chat với Axle phải duyệt từng cái mệt quá")
ok(findAuto(ct('Write', { file: '/q/c.js' }), R, T0)?.kind === 'session', 'phiên 1 giờ: Claude viết tệp khác (Write, thư mục khác) cũng tự duyệt');
ok(!findAuto(ct('Edit', { file: '/etc/hosts', nguy: true }), R, T0), 'phiên không bao giờ áp cho việc nguy hiểm');
// Công cụ web_*/tay_*: "luôn" nhớ theo ĐÍCH (app + nút) nằm trong command, không theo tên công cụ
addRule(R, ct('mcp__axle__tay_click', { command: 'tay_click libreoffice "Calc": push button "Lưu"' }), T0);
// (xét lúc phiên 1 giờ ở trên đã hết hạn — phiên đó phủ mọi việc thường của Claude)
const T1 = T0 + SESSION_MS + 1;
ok(findAuto(ct('mcp__axle__tay_click', { command: 'tay_click libreoffice "Calc": push button "Lưu"' }), R, T1)?.kind === 'rule', 'luật "luôn" tay_click: đúng nút Lưu trong Calc → tự duyệt');
ok(!findAuto(ct('mcp__axle__tay_click', { command: 'tay_click libreoffice "Calc": push button "Xoá hết"' }), R, T1), 'luật "luôn" tay_click: nút khác → hỏi (không phải mọi cú bấm)');
ok(tierOf(ct('mcp__axle__tay_click', { command: 'tay_click #99 (không rõ phần tử)', mo: true })) === 3, 'tay_click không rõ đích → bậc 3, luôn hỏi');
ok(!canRemember(ct('mcp__axle__tay_click', { command: 'tay_click #99 (không rõ phần tử)', mo: true })), 'không rõ đích thì không có nút "luôn"');

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

// ---- 24/9: "chat với Axle phải duyệt từng cái mệt quá" ----
// Lệnh chỉ đọc: tự duyệt. Có đúng mấy lệnh Claude chạy sáng 24/9 (lấy từ Sổ máy thật)
for (const c of ['ls -la ~ | head -30; echo "---"; ls -la ~/work 2>/dev/null || echo "no ~/work"', 'cat /tmp/Chi-phi-hang-thang.csv',
  'wc -l /tmp/a.csv /tmp/b.csv', 'cd /tmp && ls -la && head -5 x.csv', 'grep -n "Tổng" /tmp/a.csv | sort | uniq -c', 'du -sh ~/Documents 2>&1',
  'echo "a;b|c" && cat "tệp có dấu cách.txt"', 'jq .version /opt/axle/latest.json', 'wc -l < /tmp/a.csv', 'ls >/dev/null 2>&1']) {
  ok(chiDoc(c), `chỉ đọc → tự duyệt: ${c.slice(0, 60)}`);
}
for (const c of ['cat > /tmp/x.csv << \'EOF\'\na\nEOF', 'cat a > b', 'echo x >> ~/.bashrc', 'ls $(rm -rf ~)', 'ls `id`', 'echo "$(whoami)"',
  'sort -o out.txt in.txt', 'uniq a.txt b.txt', 'find . -delete', 'sudo ls', 'cat ~/.ssh/id_ed25519', 'cat /home/admin_1/brain/vault/tokens.env',
  'python3 -c "print(1)"', 'cd /tmp && soffice --headless --convert-to csv x.xlsx', 'tail -f log &', 'LANG=C sort a', 'ls | sh',
  'hostname may-moi', 'diff <(ls a) <(ls b)', 'cat .env', 'for f in a b; do wc -l $f; done', 'mv a b', 'echo "chưa đóng nháy', 'rm -rf /tmp/x']) {
  ok(!chiDoc(c), `không chắc chỉ đọc → vẫn hỏi: ${c.replace(/\n/g, '⏎').slice(0, 60)}`);
}
const claude = (input, extra = {}) => ({ id: 'cccc0001', nonce: 'n', action: 'claude_tool', client: 'ssh:claude', who: { agent: null },
  params: { tool: input.command ? 'Bash' : 'Edit', input, command: input.command ?? null, file: input.file_path ?? null, nguy: false, mo: false,
    chiDoc: !!input.command && chiDoc(input.command), ...extra } });
const RC = { next: 1, rules: [], sessions: [] };
ok(findAuto(claude({ command: 'cat /tmp/a.csv' }), RC)?.kind === 'chi_doc', 'Bash chỉ đọc → tự duyệt (chi_doc), không cần phiên');
ok(findAuto(claude({ command: 'mv /tmp/a /home/u/Documents/a' }), RC) === null, 'Bash có ghi → vẫn hỏi');
// "1 giờ" trên một lệnh Bash → mọi việc thường của Claude (cả sửa tệp ở thư mục khác) tự duyệt trong 1 giờ
addSession(RC, claude({ command: 'mv /tmp/a /home/u/Documents/a' }), T0);
ok(findAuto(claude({ command: 'soffice --headless --convert-to xlsx /tmp/a.csv' }), RC, T0 + 60_000)?.kind === 'session', '1 giờ: lệnh Bash khác cũng tự duyệt');
ok(findAuto(claude({ file_path: '/home/u/Documents/x.md', new_string: 'y' }), RC, T0 + 60_000)?.kind === 'session', '1 giờ: sửa tệp ở thư mục khác cũng tự duyệt');
ok(findAuto(claude({ command: 'rm -rf ~/x' }, { nguy: true }), RC, T0 + 60_000) === null, '1 giờ: việc nguy hiểm (bậc 3) vẫn hỏi');
ok(findAuto(claude({ command: 'mv a b' }), RC, T0 + SESSION_MS + 1) === null, 'hết 1 giờ → hỏi lại');
// "Luôn việc này" với Bash/Edit là cái bẫy (nhớ đúng câu lệnh) → không hiện; công cụ Axle (MCP) vẫn có "Luôn"
const nutBash = keyboard(claude({ command: 'mv a b' })).flat().map((b) => b.callback_data.slice(-1)).join('');
ok(nutBash === 'ahr' && !canRemember(claude({ command: 'mv a b' })), `Bash: chỉ còn Lần này / 1 giờ / Từ chối (${nutBash})`);
const mcpTool = { ...claude({}), params: { tool: 'mcp__axle__pm2_list', input: {}, command: null, file: null, nguy: false, mo: false, chiDoc: false } };
ok(canRemember(mcpTool) && keyboard(mcpTool).flat().length === 4, 'công cụ Axle (MCP) vẫn có "Luôn"');
ok(/1 giờ tới/.test(tierLine(claude({ command: 'mv a b' }))), 'tin xin duyệt của Claude nói rõ 1 giờ = tự làm việc thường');

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ luật duyệt 4 bậc đạt');
