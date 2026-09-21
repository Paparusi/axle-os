#!/usr/bin/env node
// Duyệt qua Telegram: agent xin làm việc có thể phá → Bi bấm ✅/❌ trên Telegram → mới chạy.
// Chạy bằng root (systemd), nghe Unix socket nhóm axle-agent. Gọi Telegram QUA VAULT với {{secret.…}}
// nên chính dịch vụ này cũng không cầm token bot.
//
// An toàn:
// - chỉ nút bấm từ đúng tài khoản chủ (owner) mới có tác dụng
// - mỗi yêu cầu một mã ngẫu nhiên riêng (nonce) trong nút bấm, hết hạn sau expireSec
// - duyệt việc nào chạy ĐÚNG việc đó: nội dung chốt lúc xin, không nhận sửa sau
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chownSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { addRule, addSession, autoLabel, canRemember, canSession, describeRule, findAuto, keyboard, loadRules, prune,
  saveRules, tierLine, tierOf, writeDurable } from './rules.js';
import { buildDigest } from './digest.js';
import { banChoApp, gopNhatKy, lenhCongCu } from './mota.js';
import { createAppChannel } from './app-channel.js';
import { machineState } from './machine-state.js';
import { requestHash } from '../app/proto.js';

const CFG_FILE = process.env.AXLE_APPROVE_CONFIG || '/etc/axle/approve.json';
const SOCKET = process.env.AXLE_APPROVE_SOCKET || '/run/axle-approve/approve.sock';
const VAULT = process.env.AXLE_VAULT_SOCKET || '/run/axle-vault/vault.sock';
const LOG = process.env.AXLE_APPROVE_LOG || '/var/log/axle-approve/approvals.jsonl';
const UNIT = /^[A-Za-z0-9@._:-]{1,128}$/;
const AGENT_DIR = process.env.AXLE_APPROVE_AGENT_DIR || '/run/axle-approve-agents';
const CLIENTS = process.env.AXLE_MCP_CLIENTS || '/etc/axle/mcp-clients.json';
const STATE = process.env.AXLE_AGENTS_STATE || '/etc/axle/agents-state.json';
const suspendedList = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')).suspended ?? []; } catch { return []; } };
// Tên agent của một yêu cầu: agent phụ theo socket; trợ lý chính theo nhãn ssh:<tên> (khoá SSH ép, không tự khai được)
const agentOf = (r) => r.who?.agent || /^ssh:([a-z][a-z0-9-]{1,20})$/.exec(r.client || '')?.[1] || null;

const ownerUser = () => { try { return readFileSync('/etc/axle/owner', 'utf8').trim() || 'admin_1'; } catch { return 'admin_1'; } };
const cfg = () => ({ api: 'https://api.telegram.org', tokenSecret: 'AXLE_TG_TOKEN', expireSec: 600, user: ownerUser(),
  ...(existsSync(CFG_FILE) ? JSON.parse(readFileSync(CFG_FILE, 'utf8')) : {}) });
const log = (e) => { try { appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n'); } catch { /* bỏ qua */ } };
const cap = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (cắt ${s.length - n} ký tự)` : s);

// ---------- việc được phép xin ----------
function runProc(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d) => { if (out.length < 65536) out += d; };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { p.kill('SIGKILL'); out += '\n[quá 120 giây, đã dừng]'; }, 120_000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code, output: out }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ exitCode: -1, output: e.message }); });
  });
}

const SNAPPER = ['/usr/bin/snapper', '-c', 'root'];
// Trong home agent, những chỗ không bao giờ cho xoá (khoá, cấu hình, công cụ, nhật ký, thùng rác).
const PROTECTED = ['.ssh', '.gnupg', '.aws', '.docker', '.kube', '.config', '.pm2', '.claude', '.nvm',
  'brain/vault', '.local/state/axle', '.local/share/axle-trash'];
// Người xin: chủ máy (socket chính) hoặc agent riêng (socket riêng của agent, nhóm ag-<tên>).
const ownerWho = () => ({ agent: null, user: cfg().user, home: `/home/${cfg().user}` });
const agentWho = (name) => ({ agent: name, user: `ag-${name}`, home: `/home/ag-${name}` });
const whoLabel = (w) => (w.agent ? `user ${w.user}, hộp cát` : `user ${w.user}`);
// Thư mục được cấp cho agent phụ (còn hạn): /etc/axle/grants/<tên>.json
const GRANTS_DIR = process.env.AXLE_GRANTS_DIR || '/etc/axle/grants';
function dirsOf(who) {
  if (!who.agent) return [];
  try {
    const g = JSON.parse(readFileSync(path.join(GRANTS_DIR, `${who.agent}.json`), 'utf8'));
    return (g.dirs ?? []).filter((d) => !d.until || Date.parse(d.until) > Date.now());
  } catch { return []; }
}
const within = (p, root) => p === root || p.startsWith(`${root}/`);

// Công cụ Claude Code xin dùng có "nguy hiểm" không → bậc 3 (luôn hỏi, không nhớ). Đây là cái LƯỚI THÔ:
// bắt mấy thứ phá máy rõ ràng; còn lại bậc 2 để chủ nhớ được "luôn cho phép việc này".
function nguyHiem(tool, command, file) {
  if (command && /\b(sudo|su|rm\s+-[a-z]*r|mkfs|dd\s+if=|shutdown|reboot|poweroff|chmod\s+-R|chown\s+-R|>\s*\/etc\/|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh)\b/.test(command)) return true;
  if (file && /^\/(etc|boot|usr|var\/lib|root)\b/.test(file)) return true;
  if (file && /\/brain\/vault\//.test(file)) return true;
  return false;
}

// Quyền XEM MÀN HÌNH THẬT CỦA CHỦ (bậc 3, luôn có hạn giờ) — /etc/axle/grants/<tên>.json: {"screen":{"until":…}}
function screenGrant(who) {
  if (!who?.agent) return { ok: true };            // chủ tự chụp thì khỏi xin ai
  let g = {};
  try { g = JSON.parse(readFileSync(path.join(GRANTS_DIR, `${who.agent}.json`), 'utf8')); } catch { /* chưa cấp */ }
  const s = g.screen;
  if (!s || !s.until) return { ok: false, err: `Chưa được xem màn hình của chủ. Chủ cấp bằng: sudo axle agent grant ${who.agent} man-hinh --han 30m` };
  if (Date.parse(s.until) <= Date.now()) return { ok: false, err: 'Quyền xem màn hình của chủ đã hết hạn — xin chủ cấp lại' };
  return { ok: true, until: s.until };
}

// Hỏi dịch vụ chạy trong phiên đồ hoạ của chủ (core/desktop/portal/axle-portal-daemon.py) lấy một khung hình.
// Root mới nối được ổ cắm đó; agent không bao giờ chạm tới phiên của chủ.
function ownerPortal(cmd, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    let uid;
    try {
      const line = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith(`${cfg().user}:`));
      uid = line ? Number(line.split(':')[2]) : null;
    } catch { uid = null; }
    if (uid == null) return resolve({ ok: false, err: 'không tìm ra tài khoản chủ' });
    const sock = `/run/user/${uid}/axle-portal.sock`;
    if (!existsSync(sock)) {
      return resolve({ ok: false, err: 'Chủ chưa đăng nhập vào giao diện (không có phiên đồ hoạ để chụp)' });
    }
    const c = netConnect(sock);
    let buf = '';
    const xong = (o) => { try { c.destroy(); } catch { /* đã đóng */ } resolve(o); };
    const t = setTimeout(() => xong({ ok: false, err: 'chủ không trả lời trong thời gian chờ' }), timeoutMs);
    c.on('connect', () => c.write(`${JSON.stringify(cmd)}\n`));
    c.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      clearTimeout(t);
      try { xong(JSON.parse(buf.slice(0, i))); } catch { xong({ ok: false, err: 'phiên của chủ trả lời lạ' }); }
    });
    c.on('error', (e) => { clearTimeout(t); xong({ ok: false, err: `không nối được phiên của chủ (${e.code || e.message})` }); });
  });
}

const ACTIONS = {
  run_command: {
    validate(p, who) {
      if (typeof p.command !== 'string' || !p.command.trim() || p.command.length > 4000) throw new Error('Lệnh 1-4000 ký tự');
      if (p.cwd != null && (typeof p.cwd !== 'string' || !p.cwd.startsWith('/'))) throw new Error('cwd phải là đường dẫn tuyệt đối');
      const cwd = path.resolve(p.cwd || `${who.home}/work`);
      if (who.agent && !p.asRoot && !within(cwd, who.home) && !dirsOf(who).some((d) => within(cwd, d.path))) {
        throw new Error(`Agent chỉ chạy lệnh trong ${who.home} hoặc thư mục được cấp`);
      }
      return { command: p.command, cwd, asRoot: p.asRoot === true };
    },
    describe: (p, who) => `chạy lệnh${p.asRoot ? ' ⚠️ BẰNG QUYỀN ROOT' : ` bằng ${whoLabel(who)}`}\nThư mục: ${p.cwd}\nLệnh:\n${p.command}`,
    exec(p, who) {
      if (!existsSync(p.cwd) || !statSync(p.cwd).isDirectory()) return { exitCode: -1, output: `Không có thư mục ${p.cwd}` };
      if (p.asRoot) return runProc('bash', ['-lc', p.command], { cwd: p.cwd });
      if (!who.agent) return runProc('runuser', ['-u', who.user, '--', 'bash', '-lc', p.command], { cwd: p.cwd });
      // Agent riêng: chạy trong hộp cát giống máy chủ MCP của nó — chỉ thấy home mình, hệ thống chỉ-đọc, không leo quyền
      return runProc('systemd-run', ['--quiet', '--wait', '--pipe', '--collect', `--uid=${who.user}`, `--gid=${who.user}`,
        `--working-directory=${p.cwd}`, '-p', 'ProtectHome=tmpfs', '-p', `BindPaths=${who.home}`, '-p', 'ProtectSystem=strict',
        '-p', `ReadWritePaths=${who.home}`, '-p', 'PrivateTmp=yes', '-p', 'NoNewPrivileges=yes', '-p', 'ProtectProc=invisible',
        ...dirsOf(who).flatMap((d) => (d.mode === 'rw'
          ? ['-p', `BindPaths=${d.path}`, '-p', `ReadWritePaths=${d.path}`] : ['-p', `BindReadOnlyPaths=${d.path}`])),
        '-p', 'RuntimeMaxSec=120', '--', 'bash', '-lc', p.command], {});
    },
  },
  snapshot_undo: {
    validate(p, who) {
      if (who.agent) throw new Error('Undo snapshot là việc toàn hệ thống: chỉ chủ máy được xin');
      if (!Number.isInteger(p.number) || p.number < 1) throw new Error('Cần số snapshot');
      return { number: p.number };
    },
    // Chụp mốc NGAY LÚC XIN: duyệt thì chỉ đảo đúng các thay đổi N→mốc mà chủ đã thấy trong tin nhắn.
    async preview(p) {
      const mark = await runProc(SNAPPER[0], [...SNAPPER.slice(1), 'create', '-t', 'single', '-c', 'number',
        '-d', `mốc xin undo về #${p.number}`, '--print-number'], {});
      if (mark.exitCode) throw new Error(`Không chụp được mốc: ${mark.output.trim()}`);
      p.mark = Number(mark.output.trim());
      const st = await runProc(SNAPPER[0], [...SNAPPER.slice(1), 'status', `${p.number}..${p.mark}`], {});
      if (st.exitCode) throw new Error(`Không có snapshot #${p.number}: ${st.output.trim().slice(0, 200)}`);
      const rows = st.output.trim().split('\n').filter(Boolean);
      if (!rows.length) throw new Error(`Không có gì thay đổi kể từ snapshot #${p.number}`);
      return `\n${rows.length} thay đổi sẽ bị đảo lại:\n${rows.slice(0, 15).join('\n')}${rows.length > 15 ? `\n… và ${rows.length - 15} thay đổi nữa` : ''}`;
    },
    describe: (p) => `đưa file hệ thống về như snapshot #${p.number} (/home, nhật ký, Docker, vault không bị đụng)`,
    async exec(p) {
      const pre = await runProc(SNAPPER[0], [...SNAPPER.slice(1), 'create', '-t', 'single', '-c', 'number',
        '-d', `trước khi undo về #${p.number}`, '--print-number'], {});
      if (pre.exitCode) return pre;
      const r = await runProc(SNAPPER[0], [...SNAPPER.slice(1), 'undochange', `${p.number}..${p.mark}`], {});
      return { exitCode: r.exitCode, output: `${r.output.trim()}\nMuốn quay lại như trước khi undo: snapshot_undo ${pre.output.trim()}` };
    },
  },
  // Agent xin XEM MÀN HÌNH THẬT của chủ. Duyệt (bậc 3, Face ID trên điện thoại) thì ghi một quyền có hạn giờ;
  // hết hạn tự rút. Chủ vẫn còn hai lớp nữa: hộp thoại của GNOME và biểu tượng "đang chia sẻ màn hình".
  screen_grant: {
    validate(p, who) {
      if (!who.agent) throw new Error('Chủ máy tự chụp bằng: axle screen chup');
      const m = Number(p.minutes ?? 30);
      if (!Number.isInteger(m) || m < 1 || m > 240) throw new Error('Số phút 1-240');
      return { minutes: m };
    },
    describe: (p, who) => `XEM MÀN HÌNH THẬT của chủ trong ${p.minutes} phút (${whoLabel(who)})\n`
      + 'Agent sẽ thấy mọi thứ đang mở trên màn hình. GNOME vẫn hỏi lần đầu và hiện biểu tượng đang chia sẻ.',
    exec(p, who) {
      const f = path.join(GRANTS_DIR, `${who.agent}.json`);
      let g = { dirs: [], net: [] };
      try { g = JSON.parse(readFileSync(f, 'utf8')); } catch { /* chưa có */ }
      g.screen = { until: new Date(Date.now() + p.minutes * 60_000).toISOString().replace(/\.\d+Z$/, 'Z') };
      mkdirSync(GRANTS_DIR, { recursive: true, mode: 0o755 });
      writeFileSync(f, `${JSON.stringify(g, null, 1)}\n`, { mode: 0o644 });
      return { exitCode: 0, output: `Đã cho ${who.agent} xem màn hình tới ${g.screen.until}` };
    },
  },
  // Có người ngồi TRƯỚC MÁY xin đăng nhập (PAM của màn đăng nhập gọi vào). Không có tác dụng phụ nào:
  // chính việc "được duyệt" là kết quả — PAM chỉ hỏi duyệt hay không. Trong PAM đặt `sufficient` nên từ chối
  // hay hết giờ thì rơi về ô mật khẩu như cũ, không bao giờ khoá chết máy.
  // Người xin CHƯA đăng nhập được (chưa ai chứng minh là ai) → luôn bậc 3, không nhớ, không cho "luôn".
  login: {
    validate(p, who) {
      if (who.agent) throw new Error('Agent không xin đăng nhập được');
      const u = String(p.user ?? '');
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(u)) throw new Error('Tên tài khoản không hợp lệ');
      return { user: u, tty: String(p.tty ?? '').replace(/[^\w/:-]/g, '').slice(0, 32) };
    },
    describe: (p) => `ĐĂNG NHẬP vào máy bằng tài khoản ${p.user}${p.tty ? ` (${p.tty})` : ''}\n`
      + 'Có người đang ngồi trước máy. Duyệt là họ vào thẳng, KHÔNG cần mật khẩu.',
    exec: (p) => ({ exitCode: 0, output: `Đã cho đăng nhập ${p.user}` }),
  },
  // CẦU XIN PHÉP: Claude Code chạy TRÊN máy (claude -p … --permission-prompt-tool mcp__axle__duyet_quyen)
  // muốn dùng một công cụ (Bash, Edit, Write…) thì gọi sang đây → điện thoại chủ rung → chủ duyệt mới làm.
  // Không có tác dụng phụ: "được duyệt" chính là kết quả — cổng MCP trả lời Claude Code allow/deny.
  // Đây là thứ biến "agent có tay chân + chủ nắm cổng bằng khuôn mặt mình" thành chuyện kiểm chứng được.
  claude_tool: {
    validate(p) {
      const tool = String(p.tool ?? '').slice(0, 64);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tool)) throw new Error('Tên công cụ lạ');
      let input = p.input && typeof p.input === 'object' ? p.input : {};
      const raw = JSON.stringify(input);
      if (raw.length > 16_000) input = { _cat: `${raw.slice(0, 16_000)}…` };
      // Lọc ra mấy mẩu chủ cần thấy: Bash → lệnh; Edit/Write → tệp + nội dung ngắn
      let command = typeof input.command === 'string' ? input.command : null;
      const file = typeof input.file_path === 'string' ? input.file_path : null;
      // Công cụ web_*/tay_* của Axle: dòng lệnh = ĐÍCH THẬT (app, nút) để tin duyệt đọc được và "luôn" nhớ đúng
      // đích đó chứ không phải mọi cú bấm. tay_* đổi số thứ tự qua bảng vừa chụp trong nhà chủ (chỉ đọc).
      let mo = false;
      const mcp = lenhCongCu(tool, input, tayBangCuaChu());
      if (mcp) { command = mcp.command; mo = mcp.mo; }
      return { tool, input, command, file, nguy: nguyHiem(tool, command, file), mo };
    },
    describe(p) {
      const dong = [`Claude trên máy xin dùng công cụ ${p.tool}${p.nguy ? ' ⚠️ NGUY HIỂM' : ''}${p.mo ? ' (không rõ đích — luôn hỏi)' : ''}`];
      if (/^(web_|tay_)/.test(p.command ?? '')) {
        dong.push(`Việc: ${cap(p.command, 400)}`);
        const chu = p.input?.chu;
        if (typeof chu === 'string') dong.push(`Gõ: ${cap(chu, 300)}`);
      } else if (p.command) dong.push(`Lệnh:\n${cap(p.command, 1500)}`);
      else if (p.file) {
        dong.push(`Tệp: ${p.file}`);
        const t = p.input.content ?? p.input.new_string;
        if (typeof t === 'string') dong.push(`Nội dung:\n${cap(t, 600)}`);
      } else dong.push(cap(JSON.stringify(p.input, null, 1), 800));
      return dong.join('\n');
    },
    exec: (p) => ({ exitCode: 0, output: `Đã cho Claude dùng ${p.tool}` }),
  },
  file_delete: {
    validate(p, who) {
      if (typeof p.path !== 'string' || !p.path.startsWith('/')) throw new Error('Cần đường dẫn tuyệt đối');
      const abs = path.resolve(p.path);
      let parent;
      try { parent = realpathSync(path.dirname(abs)); } catch { throw new Error(`Không tồn tại: ${p.path}`); }
      const target = path.join(parent, path.basename(abs));   // thư mục cha đi theo symlink; bản thân mục thì không
      const h = who.home;
      const rwDirs = dirsOf(who).filter((d) => d.mode === 'rw').map((d) => d.path);
      if (!target.startsWith(`${h}/`) && !rwDirs.some((r) => target.startsWith(`${r}/`))) {
        throw new Error(`Chỉ xoá trong ${h}${rwDirs.length ? ' hoặc thư mục được ghi' : ''}`);
      }
      if (target === `${h}/work` || PROTECTED.some((d) => target === `${h}/${d}` || target.startsWith(`${h}/${d}/`)
        || `${h}/${d}`.startsWith(`${target}/`))) throw new Error('Vùng được bảo vệ, không xoá');
      try { lstatSync(target); } catch { throw new Error(`Không tồn tại: ${p.path}`); }
      return { path: target };
    },
    async preview(p) {
      const st = lstatSync(p.path);
      p.isDir = st.isDirectory() && !st.isSymbolicLink();
      if (st.isSymbolicLink()) return '\nLoại: symlink (chỉ xoá cái link)';
      if (!st.isDirectory()) return `\nLoại: file, ${st.size} byte`;
      const n = await runProc('find', [p.path, '-mindepth', '1'], {});
      return `\nLoại: thư mục, ${n.output.split('\n').filter(Boolean).length} mục bên trong`;
    },
    describe: (p) => `xoá (chuyển vào thùng rác) ${p.path}`,
    exec(p, who) {
      const dst = `${who.home}/.local/share/axle-trash/${new Date().toISOString().replace(/[:.]/g, '-')}${p.path}`;
      // Chạy bằng user của người xin: không bao giờ động được vào thứ họ vốn không có quyền.
      return runProc('runuser', ['-u', who.user, '--', 'bash', '-c',
        'mkdir -p -- "$(dirname -- "$2")" && mv -- "$1" "$2" && echo "Đã chuyển vào thùng rác: $2"', '_', p.path, dst], {});
    },
  },
  service_restart: {
    validate(p, _who) {
      if (typeof p.unit !== 'string' || !UNIT.test(p.unit)) throw new Error('Tên dịch vụ không hợp lệ');
      return { unit: p.unit };
    },
    describe: (p) => `khởi động lại dịch vụ ${p.unit}`,
    async exec(p) {
      const r = await runProc('systemctl', ['restart', p.unit], {});
      const s = await runProc('systemctl', ['is-active', p.unit], {});
      return { exitCode: r.exitCode, output: `${r.output}trạng thái sau khi khởi động lại: ${s.output.trim()}` };
    },
  },
};

// ---------- Telegram qua vault ----------
function vaultRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = httpRequest({ socketPath: VAULT, path: '/request', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          return res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || `vault ${res.statusCode}`));
        } catch { return reject(new Error('vault trả lời lạ')); }
      });
    });
    req.on('error', (e) => reject(new Error(`không nối được vault: ${e.code || e.message}`)));
    req.end(data);
  });
}

async function tg(method, body) {
  const c = cfg();
  const r = await vaultRequest({ method: 'POST', url: `${c.api}/bot{{secret.${c.tokenSecret}}}/${method}`,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = JSON.parse(r.body || '{}');
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

// ---------- yêu cầu đang chờ ----------
const requests = new Map();   // id → { id, nonce, action, params, client, created, state, result, messageId, text }
const waiters = new Map();    // id → [resolve…]
const FINAL = new Set(['done', 'failed', 'rejected', 'expired']);

function setState(r, state, result) {
  r.state = state;
  if (result !== undefined) r.result = result;
  log({ id: r.id, state, action: r.action, client: r.client, ...(result ? { exitCode: result.exitCode } : {}) });
  if (r.toApp && state !== 'pending') app.broadcast({ type: 'update', id: r.id, state }).catch(() => {});
  for (const w of waiters.get(r.id) ?? []) w();
  waiters.delete(r.id);
  publishBan();
}

async function finishMessage(r, line) {
  if (!r.messageId) return;          // yêu cầu không gửi qua Telegram (chỉ app / tại máy)
  try { await tg('editMessageText', { chat_id: cfg().owner, message_id: r.messageId, text: cap(`${r.text}\n\n${line}`, 4000) }); }
  catch (e) { log({ id: r.id, warn: `sửa tin nhắn: ${e.message}` }); }
}

async function decide(r, approve, note = '') {
  if (!approve) { setState(r, 'rejected'); return finishMessage(r, '❌ Đã từ chối'); }
  setState(r, 'running');
  await finishMessage(r, `✅ Đã duyệt${note} · đang chạy…`);
  let res;
  try { res = await ACTIONS[r.action].exec(r.params, r.who); } catch (e) { res = { exitCode: -1, output: e.message }; }
  setState(r, res.exitCode === 0 ? 'done' : 'failed', res);
  await finishMessage(r, `✅ Đã duyệt${note} → ${res.exitCode === 0 ? 'xong' : `lỗi (mã ${res.exitCode})`}\n${cap(res.output.trim(), 1500)}`);
}

// Tự duyệt theo luật/phiên: chạy luôn, không gửi tin (gom vào tin tóm tắt)
async function runAuto(r) {
  setState(r, 'running');
  let res;
  try { res = await ACTIONS[r.action].exec(r.params, r.who); } catch (e) { res = { exitCode: -1, output: e.message }; }
  setState(r, res.exitCode === 0 ? 'done' : 'failed', res);
}

async function createRequest({ action, params, client }, who) {
  const c = cfg();
  if (!c.owner && !app.enabled()) {
    throw new Error('Máy chưa có kênh duyệt nào: ghép app (sudo axle app pair) hoặc Telegram (sudo axle approve setup --owner <id>)');
  }
  const A = ACTIONS[action];
  if (!A) throw new Error(`Không có việc ${action}`);
  const clean = A.validate(params ?? {}, who);
  const extra = A.preview ? await A.preview(clean, who) : '';
  const id = randomBytes(4).toString('hex');
  // Agent riêng: tên lấy theo SOCKET nó dùng, không tin tên tự khai
  const label = who.agent ? `http:${who.agent} (user ${who.user})` : String(client || '?').slice(0, 64);
  const name = who.agent || /^ssh:([a-z][a-z0-9-]{1,20})$/.exec(label)?.[1];
  if (name && suspendedList().includes(name)) throw new Error(`Agent ${name} đang bị tạm dừng`);
  const r = { id, nonce: randomBytes(8).toString('hex'), action, params: clean, client: label, who,
    created: Date.now(), state: 'pending' };
  const auto = findAuto(r, loadRules());
  if (auto) {
    r.auto = auto;
    requests.set(id, r);
    log({ id, state: 'auto', action, client: r.client, params: clean, by: autoLabel(auto) });
    runAuto(r);
    return r;
  }
  r.text = `🔐 ${hostname()} · cần duyệt #${id}\nAgent: ${r.client}\nViệc: ${A.describe(clean, who)}${extra}\n${tierLine(r)}\nHết hạn sau ${c.expireSec < 120 ? `${c.expireSec} giây` : `${Math.round(c.expireSec / 60)} phút`}`;
  r.hash = requestHash(r);
  // Gửi SONG SONG tới mọi kênh. Trước đây chờ Telegram xong mới tới app, mà đo thật trên máy văn phòng
  // 20/9: Telegram 623ms, trạm chuyển tiếp 291ms — nghĩa là điện thoại (kênh chính, có Face ID) luôn rung
  // SAU kênh dự phòng khoảng sáu phần mười giây, mỗi lần duyệt.
  // Và chỉ hỏng khi KHÔNG kênh nào gửi được: Telegram chết mà app sống thì vẫn duyệt được như thường.
  const gui = [];
  if (app.enabled()) {
    r.toApp = true;
    gui.push(app.broadcast({ type: 'request', id: r.id, hash: r.hash, tier: tierOf(r), agent: r.client, action: r.action, params: r.params, text: r.text,
      buttons: keyboard(r).flat().map((b) => b.callback_data.slice(-1)).join(''), expires: r.created + c.expireSec * 1000 }));
  }
  if (c.owner) {
    gui.push(tg('sendMessage', { chat_id: c.owner, text: cap(r.text, 4000), reply_markup: { inline_keyboard: keyboard(r) } })
      .then((msg) => { r.messageId = msg.message_id; }));
  }
  const ketQua = await Promise.allSettled(gui);
  if (ketQua.length && !ketQua.some((x) => x.status === 'fulfilled')) {
    throw new Error(`không gửi được yêu cầu tới kênh nào: ${ketQua.map((x) => x.reason?.message).filter(Boolean).join(' · ')}`);
  }
  for (const x of ketQua) if (x.status === 'rejected') log({ id, warn: `một kênh duyệt hỏng: ${x.reason?.message}` });
  requests.set(id, r);
  log({ id, state: 'pending', action, client: r.client, params: clean });
  publishBan();
  return r;
}

// Áp một quyết định (Telegram / app / tại máy). d: a lần này · h 1 giờ · l luôn · r từ chối. Bậc 3 bỏ qua h/l.
function applyDecision(r, d, via) {
  // Ghi CHỮ quyết định (a/h/l/r) + qua đâu: Sổ trên Bàn đọc, và là nhãn cho lớp phản xạ (approve/nhan.mjs)
  log({ id: r.id, decision: d, via: String(via || '').replace(/^\s*·\s*/, '') || 'Telegram' });
  if (d === 'r') { decide(r, false); return 'Đã từ chối'; }
  let note = via;
  if (d === 'h' && canSession(r)) {
    const R = loadRules(); const sid = addSession(R, r); saveRules(R);
    note += ` · 1 giờ (phiên #${sid})`;
  } else if (d === 'l' && canRemember(r)) {
    const R = loadRules(); const rid = addRule(R, r); saveRules(R);
    note += ` · luôn việc này (luật #${rid})`;
  }
  decide(r, true, note);
  return `Đã duyệt${note}`;
}

// ---------- kênh app (docs/APP-DUYET.md) ----------
const app = createAppChannel({
  log, hostname: hostname(),
  onDecision(d, msg) {
    const r = requests.get(msg.id);
    if (!r || !r.toApp) return log({ warn: `app: ${d.name} quyết định yêu cầu không có #${msg.id}` });
    if (r.state !== 'pending') return app.sendTo(d.id, { type: 'update', id: r.id, state: r.state });
    const bad = app.verifyDecision(d, msg, r);
    if (bad) return log({ id: r.id, warn: `app: bỏ quyết định từ ${d.name}: ${bad}` });
    if (Date.now() - r.created > cfg().expireSec * 1000) { setState(r, 'expired'); return finishMessage(r, '⌛ Hết hạn, không chạy'); }
    log({ id: r.id, app: `quyết định ${msg.decision} từ ${d.name}` });
    applyDecision(r, msg.decision, ` · qua app ${d.name}`);
  },
  async onCommand(d, msg) {
    const out = await runAxle(['agent', msg.type === 'stop' ? 'stop' : 'start', msg.agent]);
    log({ app: `${msg.type} ${msg.agent} từ ${d.name}`, exitCode: out.exitCode });
    app.sendTo(d.id, { type: 'command-result', cmd: msg.type, agent: msg.agent, ok: out.exitCode === 0, text: out.output.trim() });
    app.broadcast({ type: 'agents', list: agentList() }).catch(() => {});
  },
  onHello(d) { app.sendTo(d.id, { type: 'agents', list: agentList() }); },
  async onTask(d, task) {
    const v = TASKS[task];
    if (!v) return log({ warn: `app: ${d.name} xin việc lạ ${task}` });
    log({ app: 'việc nhanh', task, ten: v.ten, device: d.name });
    const r = await v.chay();
    const ok = r.exitCode === 0;
    app.sendTo(d.id, { type: 'task-result', task, ok,
      text: ok ? (v.xong ?? `${v.ten}: xong`) : cap(r.output.trim() || 'máy báo lỗi', 200),
      ...(ok && r.anh ? { anh: r.anh, rong: r.rong } : {}) });
    log({ app: 'việc nhanh xong', task, ok, ...(r.byte ? { anhByte: r.byte } : {}), ...(ok ? {} : { output: cap(r.output.trim(), 300) }) });
    v.sau?.();
  },
  async onQuery(d, what) {
    if (what === 'status') return app.sendTo(d.id, { type: 'state', what: 'status', data: await machineState() });
    // Tab Sổ trên app: cùng nội dung công bố cho Bàn (số hôm nay + ~40 việc đã hỏi chủ), bỏ pending, cắt vừa hộp
    if (what === 'so') return app.sendTo(d.id, { type: 'state', what: 'so', data: banChoApp(layBan()) });
    log({ warn: `app: ${d.name} hỏi chuyện lạ ${what}` });
  },
  async onShell(d, cmd) {
    const t = terminalCfg();
    if (!t.enabled) {
      log({ warn: `app: ${d.name} gõ lệnh nhưng terminal đang tắt` });
      return app.sendTo(d.id, { type: 'shell-result', ok: false, text: 'Terminal đang tắt. Bật ở máy: sudo axle app terminal on' });
    }
    const user = t.asRoot ? 'root' : ownerUser();
    log({ app: 'gõ lệnh từ điện thoại', device: d.name, user, cmd: cap(cmd, 500) });
    const giay = String(Math.min(Math.max(Number(t.timeoutSec ?? 60), 5), 300));
    const r = t.asRoot
      ? await runProc('timeout', [giay, 'bash', '-lc', cmd], { cwd: `/home/${ownerUser()}` })
      : await runProc('timeout', [giay, 'runuser', '-u', ownerUser(), '--', 'bash', '-lc', cmd], { cwd: `/home/${ownerUser()}` });
    const ra = r.output.replace(/\s+$/, '');
    // 8000 ký tự vẫn lọt hộp 64KB của trạm, mà đủ chỗ cho câu trả lời của `claude -p` hay một khúc log
    app.sendTo(d.id, { type: 'shell-result', ok: r.exitCode === 0, code: r.exitCode, user,
      text: cap(ra || '(không in ra gì)', 8000) });
    log({ app: 'lệnh xong', code: r.exitCode, byte: ra.length });
  },
});
app.start();

// Việc nhanh bấm thẳng từ app (đã ký bằng khoá Face ID trong chip = mức tin cậy T3, khỏi hỏi lại).
// Danh sách ĐÓNG và không nhận tham số: điện thoại KHÔNG gửi được chuỗi lệnh nào sang máy. Mất điện thoại
// (mà mở khoá được) thì kẻ lấy được chừng này nút, không phải cả cái máy.
// Gõ lệnh từ app: MẶC ĐỊNH TẮT (không có tệp = tắt). Bật bằng `sudo axle app terminal on`.
// Đây là thứ duy nhất trong kênh app cho điện thoại gửi nội dung tuỳ ý sang máy, nên để chủ tự bật, và
// mặc định chạy bằng tài khoản chủ chứ không root.
const TERMINAL_CFG = process.env.AXLE_APP_TERMINAL || '/etc/axle/app-terminal.json';
const terminalCfg = () => {
  try { return { enabled: false, asRoot: false, timeoutSec: 60, ...JSON.parse(readFileSync(TERMINAL_CFG, 'utf8')) }; }
  catch { return { enabled: false, asRoot: false, timeoutSec: 60 }; }
};

const AXLE = '/usr/local/bin/axle';
const TASKS = {
  'khoa-man-hinh': {
    ten: 'Khoá màn hình máy',
    xong: 'Đã khoá màn hình máy',
    chay: () => runProc('loginctl', ['lock-sessions'], {}),
  },
  'chup-anh': {
    ten: 'Chụp ảnh hệ thống',
    chay: () => runProc(AXLE, ['snapshot', 'từ điện thoại'], {}),
  },
  'cap-nhat': {
    ten: 'Cập nhật Axle',
    xong: 'Đang cập nhật ở nền — xem lại tình trạng sau vài phút',
    // Chạy tách hẳn khỏi bộ duyệt: bản cập nhật sẽ khởi động lại chính dịch vụ này giữa chừng
    chay: () => runProc('systemd-run', ['--unit=axle-update-tu-app', '--collect', AXLE, 'update'], {}),
  },
  'chup-man-hinh': {
    ten: 'Xem màn hình máy',
    // Hộp qua trạm chuyển tiếp tối đa 64KB → ảnh phải ≤ ~30KB. Hạ dần cho tới khi vừa, thà mờ còn hơn không có.
    async chay() {
      // Chưa đồng ý lần nào thì GNOME sẽ bật hộp thoại TẠI MÁY — người cầm điện thoại ở xa không bấm được.
      // Thà báo ngay còn hơn để app ngồi chờ hết 60 giây rồi mới biết.
      const tt = await ownerPortal({ cmd: 'status' }, 10_000);
      if (tt.ok && tt.co_giay_phep === false) {
        return { exitCode: 1, output: 'Máy chưa được đồng ý chia sẻ màn hình lần nào. Ra ngồi trước máy, mở Terminal gõ: axle screen chup — rồi bấm Share một lần. Từ đó về sau xem được từ xa.' };
      }
      for (const [rong, chatLuong] of [[960, 55], [720, 45], [640, 32]]) {
        const r = await ownerPortal({ cmd: 'shot', rong, chat_luong: chatLuong, timeout: 60 });
        if (!r.ok) return { exitCode: 1, output: r.err };
        const byte = Buffer.byteLength(r.png, 'base64');
        if (byte <= 30_000) return { exitCode: 0, output: '', anh: r.png, rong, byte };
        if (rong === 640) return { exitCode: 1, output: `màn hình quá nhiều chi tiết (${Math.round(byte / 1024)}KB) — xem bằng axle screen chup` };
      }
      return { exitCode: 1, output: 'không chụp được' };
    },
  },
  'khoi-dong-lai': {
    ten: 'Khởi động lại máy',
    xong: 'Máy đang khởi động lại',
    chay: async () => ({ exitCode: 0, output: '' }),
    // Trả lời cho điện thoại TRƯỚC rồi mới tắt, kẻo app treo ở "đang gửi"
    sau: () => setTimeout(() => runProc('systemctl', ['reboot'], {}), 2000),
  },
  'tat-may': {
    ten: 'Tắt máy',
    // Đây là việc DUY NHẤT trong danh sách không tự quay lại được: máy tắt rồi thì điện thoại hết đường
    // bật lên, phải tới tận nơi bấm nút nguồn. App phải nói thẳng điều đó trước khi hỏi Face ID.
    xong: 'Máy đang tắt — bật lại phải tới tận máy',
    chay: async () => ({ exitCode: 0, output: '' }),
    sau: () => setTimeout(() => runProc('systemctl', ['poweroff'], {}), 2000),
  },
};

// Danh sách agent cho app (màn Agent / dừng khẩn cấp): tên, vai, đang tạm dừng không. Không gửi token/băm token.
function agentList() {
  let clients = {};
  try { clients = JSON.parse(readFileSync(CLIENTS, 'utf8')); } catch { /* chưa có agent */ }
  const sus = suspendedList();
  return Object.entries(clients).map(([name, c]) => ({ name, role: c.role === 'chinh' ? 'chinh' : 'phu', user: c.user || null,
    suspended: sus.includes(name) }));
}

// Lệnh của chủ qua Telegram: /agents, /dung <tên>, /mo <tên>. Chỉ tài khoản chủ, chỉ chat riêng.
const runAxle = (args) => runProc('/usr/local/bin/axle', args, {});
async function handleMessage(msg) {
  const c = cfg();
  if (Number(msg.from?.id) !== Number(c.owner) || msg.chat?.type !== 'private') {
    log({ warn: `tin nhắn từ người lạ ${msg.from?.id}, bỏ qua` });
    return;
  }
  const [cmd, arg] = String(msg.text || '').trim().split(/\s+/);
  const reply = (text) => tg('sendMessage', { chat_id: c.owner, text: cap(text || '(trống)', 4000) }).catch(() => {});
  if (cmd === '/agents') return reply((await runAxle(['agents'])).output.trim());
  if (cmd === '/dung' || cmd === '/mo') {
    if (!/^[a-z][a-z0-9-]{1,20}$/.test(arg || '')) return reply(`Cú pháp: ${cmd} <tên agent>`);
    const r = await runAxle(['agent', cmd === '/dung' ? 'stop' : 'start', arg]);
    log({ cmd, agent: arg, exitCode: r.exitCode });
    return reply(r.output.trim());
  }
  if (cmd === '/luat') {
    const R = loadRules();
    const rows = [...R.rules.map((x) => describeRule(x, false)), ...R.sessions.map((x) => describeRule(x, true))];
    return reply(rows.length ? `Đang nhớ:\n${rows.join('\n')}\n\nXoá: /quen <số> · /quen tat` : 'Chưa nhớ luật hay phiên nào');
  }
  if (cmd === '/quen') {
    const R = loadRules();
    if (arg === 'tat') { R.rules = []; R.sessions = []; saveRules(R); log({ cmd, all: true }); return reply('Đã quên mọi luật + phiên. Từ giờ việc nào cũng hỏi lại.'); }
    const id = Number(arg);
    const had = R.rules.length + R.sessions.length;
    R.rules = R.rules.filter((x) => x.id !== id); R.sessions = R.sessions.filter((x) => x.id !== id);
    if (R.rules.length + R.sessions.length === had) return reply(`Không có luật/phiên #${arg ?? ''}`);
    saveRules(R); log({ cmd, id });
    return reply(`Đã quên #${id}. Việc đó sẽ phải hỏi lại.`);
  }
  if (cmd === '/tomtat') return reply(digestText(Date.now() - 24 * 3600 * 1000));
  return reply('Lệnh: /agents · /dung <tên> · /mo <tên> · /luat · /quen <số|tat> · /tomtat');
}

// Nhận nút bấm. Chỉ chủ; đúng mã; còn hạn; chưa quyết.
async function pollTelegram() {
  let offset = 0;
  for (;;) {
    try {
      if (!cfg().owner) { await new Promise((s) => setTimeout(s, 5000)); continue; }
      const updates = await tg('getUpdates', { offset, timeout: 20, allowed_updates: ['callback_query', 'message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) { await handleMessage(u.message); continue; }
        const q = u.callback_query;
        if (!q) continue;
        const [id, nonce, d] = String(q.data || '').split(':');
        const r = requests.get(id);
        const fromOwner = Number(q.from?.id) === Number(cfg().owner);
        let answer = 'Không hợp lệ';
        if (!fromOwner) log({ id, warn: `nút bấm từ người lạ ${q.from?.id}, bỏ qua` });
        else if (!r || r.nonce !== nonce) answer = 'Yêu cầu không tồn tại';
        else if (r.state !== 'pending') answer = `Đã xử lý (${r.state})`;
        else if (Date.now() - r.created > cfg().expireSec * 1000) { answer = 'Đã hết hạn'; setState(r, 'expired'); finishMessage(r, '⌛ Hết hạn, không chạy'); }
        else answer = applyDecision(r, d, '');
        tg('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {});
      }
    } catch (e) {
      log({ warn: `getUpdates: ${e.message}` });
      await new Promise((s) => setTimeout(s, 3000));
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const r of requests.values()) {
    if (r.state === 'pending' && now - r.created > cfg().expireSec * 1000) { setState(r, 'expired'); finishMessage(r, '⌛ Hết hạn, không chạy'); }
    if (FINAL.has(r.state) && now - r.created > 24 * 3600 * 1000) requests.delete(r.id);
  }
}, 2000);

// ---------- socket cho agent ----------
const view = (r) => ({ id: r.id, state: r.state, action: r.action, ...(r.auto ? { auto: autoLabel(r.auto) } : {}),
  ...(r.result ? { exitCode: r.result.exitCode, output: r.result.output } : {}) });

function makeServer(who) {
  return createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/request') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 65536) return send(413, { error: 'quá lớn' }); }
        return send(200, view(await createRequest(JSON.parse(body || '{}'), who ?? ownerWho())));
      }
      if (req.method === 'POST' && url.pathname === '/screen/shot') {
        const w = who ?? ownerWho();
        const q = screenGrant(w);
        if (!q.ok) { log({ screen: 'từ chối', agent: w.agent, why: q.err }); return send(403, { error: q.err }); }
        const r = await ownerPortal({ cmd: 'shot', timeout: 60 });
        log({ screen: r.ok ? 'chụp màn hình chủ' : 'chụp hỏng', agent: w.agent, until: q.until, ...(r.ok ? {} : { err: r.err }) });
        return r.ok ? send(200, { png: r.png, until: q.until }) : send(502, { error: r.err });
      }
      if (req.method === 'POST' && url.pathname === '/screen/forget') {
        if (who?.agent) return send(403, { error: 'Chỉ chủ máy quên được giấy phép' });
        return send(200, await ownerPortal({ cmd: 'forget' }, 10_000));
      }
      if (req.method === 'GET' && url.pathname === '/screen/status') {
        const w = who ?? ownerWho();
        const q = screenGrant(w);
        const st = await ownerPortal({ cmd: 'status' }, 10_000);
        return send(200, { quyen: q.ok ? (q.until || 'chủ') : null, het_han: q.until || null, phien_chu: st.ok === true, loi: st.ok ? null : st.err });
      }
      const m = /^\/status\/([0-9a-f]{8})$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const r = requests.get(m[1]);
        // agent chỉ xem được yêu cầu của chính nó
        if (!r || (who?.agent && r.who.agent !== who.agent)) return send(404, { error: 'Không có yêu cầu này' });
        const wait = Math.min(Number(url.searchParams.get('wait') || 0), 110) * 1000;
        if (wait && !FINAL.has(r.state)) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, wait);
            const done = () => { clearTimeout(t); resolve(); };
            waiters.set(r.id, [...(waiters.get(r.id) ?? []), done]);
          });
          // 'running' là trạng thái giữa: chờ thêm tới khi xong (lệnh tối đa 120 giây)
          if (r.state === 'running') {
            await new Promise((resolve) => {
              const t = setTimeout(resolve, 125_000);
              waiters.set(r.id, [...(waiters.get(r.id) ?? []), () => { clearTimeout(t); resolve(); }]);
            });
          }
        }
        return send(200, view(r));
      }
      send(404, { error: 'Không có đường này' });
    } catch (e) {
      send(400, { error: e.message });
    }
  });
}

if (existsSync(SOCKET)) unlinkSync(SOCKET);
makeServer(null).listen(SOCKET, () => { chmodSync(SOCKET, 0o660); console.log(`axle-approve nghe ở ${SOCKET}`); });

// ---------- công bố cho Bàn Axle ----------
// Bàn (mặt tiền trên máy, core/desktop/axle-gui.py) cần thấy việc đang chờ, số hôm nay và agent nào có trên máy —
// mà không hỏi mật khẩu và không dội sudo mỗi 5 giây (một cửa hẹp sudo là ~17.000 dòng nhật ký một ngày).
// Bộ duyệt tự ghi ra MỘT tệp root:<chủ> 0640 mỗi khi trạng thái đổi (và mỗi phút cho tuổi việc / số hôm nay).
// CHỈ ĐỌC: đường duyệt vẫn là socket quản trị root 0600 (`sudo axle duyet`) hoặc điện thoại — không có gì mới để lạm dụng.
const BAN_FILE = process.env.AXLE_BAN_FILE || '/run/axle/ban.json';
function ownerGid() {
  try {
    const u = ownerUser();
    const line = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith(`${u}:`));
    return line ? Number(line.split(':')[3]) : null;
  } catch { return null; }
}
// Cùng cách đếm với tin tóm tắt tối (digest.js): "running" gồm cả tự duyệt → chủ duyệt = running − auto
function homNay() {
  const dau = new Date(); dau.setHours(0, 0, 0, 0);
  const n = { running: 0, auto: 0, rejected: 0, expired: 0 };
  // Đuôi 1MB (~5.000 sự kiện) thay vì cả tệp: nhật ký lớn dần theo tháng mà hàm này chạy mỗi lần đổi trạng thái
  for (const l of docDuoiLog(1_048_576)) {
    if (!l) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (!(e.state in n) || Date.parse(e.ts) < dau.getTime()) continue;
    n[e.state]++;
  }
  return { chu_duyet: Math.max(0, n.running - n.auto), tu_duyet: n.auto, tu_choi: n.rejected, het_han: n.expired };
}
// Sổ: ~40 việc gần nhất máy đã hỏi chủ (đọc đuôi nhật ký, không phải cả tệp — nhật ký lớn dần theo tháng)
// Bảng phần tử `axle tay chup` vừa chụp của chủ (~/.cache/axle-tay/bang.json) — để tin duyệt tay_click #37 nói
// được "nút Lưu trong Calc". Chỉ đọc, ≤256KB, hỏng thì coi như không có (→ yêu cầu thành "không rõ đích", bậc 3).
function tayBangCuaChu() {
  try {
    const f = path.join(ownerWho().home, '.cache/axle-tay/bang.json');
    if (statSync(f).size > 262144) return null;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j && typeof j === 'object' && j.muc ? j : null;
  } catch { return null; }
}

function docDuoiLog(toiDa = 262144) {
  try {
    const fd = openSync(LOG, 'r');
    const { size } = fstatSync(fd);
    const len = Math.min(size, toiDa);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const dong = buf.toString('utf8').split('\n');
    return size > toiDa ? dong.slice(1) : dong;
  } catch { return []; }
}
const soGanDay = (toiDa = 40) => gopNhatKy(docDuoiLog()).slice(0, toiDa).map(({ params, ...x }) => x);   // không đưa params (lệnh đầy đủ) ra tệp

function layBan() {
  const c = cfg();
  const pending = [...requests.values()].filter((r) => r.state === 'pending').map((r) => ({
    id: r.id, tier: tierOf(r), client: r.client, action: r.action, text: r.text,
    buttons: keyboard(r).flat().map((b) => b.callback_data.slice(-1)).join(''),
    ageSec: Math.round((Date.now() - r.created) / 1000), expires: new Date(r.created + c.expireSec * 1000).toISOString() }));
  const agents = agentList().map((a) => ({ ten: a.name, vai: a.role, user: a.user, tam_dung: a.suspended }));
  return { ts: new Date().toISOString(), host: hostname(), pending, homNay: homNay(), agents, so: soGanDay() };
}
let banHen = null;
function publishBan() {   // đổi trạng thái dồn dập (một việc: pending → running → done) → ghi một lần
  if (banHen) return;
  banHen = setTimeout(() => { banHen = null; publishBanNgay(); }, 150);
}
function publishBanNgay() {
  const data = JSON.stringify(layBan());
  try {
    mkdirSync(path.dirname(BAN_FILE), { recursive: true, mode: 0o755 });
    const tmp = `${BAN_FILE}.tmp`;
    writeFileSync(tmp, data, { mode: 0o640 });
    const gid = ownerGid();
    try { if (gid != null) chownSync(tmp, 0, gid); } catch { /* không phải root (bài thử) → giữ chủ tệp hiện tại */ }
    renameSync(tmp, BAN_FILE);
  } catch (e) { log({ warn: `công bố Bàn: ${e.message}` }); }
}
setInterval(publishBan, 60_000);

// Socket quản trị: root 0600 — ghép cặp app, gỡ điện thoại, duyệt tại máy (`sudo axle duyet`, mức tin cậy T3).
// Agent (kể cả trợ lý chính chạy bằng quyền chủ) KHÔNG chạm được: không có đường tự duyệt.
const ADMIN_SOCKET = process.env.AXLE_APPROVE_ADMIN_SOCKET || '/run/axle-approve/admin.sock';
const adminServer = createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /pair/start': return send(200, await app.startPair());
      case 'GET /pair/wait': {
        const x = await app.waitPair(Math.min(Number(url.searchParams.get('timeout') || 120), 600) * 1000);
        return x ? send(200, x) : send(408, { error: 'Chưa thấy điện thoại nào quét mã' });
      }
      case 'POST /pair/confirm': return send(200, { device: await app.confirmPair(body.pendingId, body.ok === true) });
      case 'GET /devices': return send(200, app.devices());
      case 'POST /devices/remove': return send(200, await app.removeDevice(body.id));
      case 'GET /pending':
        return send(200, [...requests.values()].filter((r) => r.state === 'pending').map((r) => ({
          id: r.id, tier: tierOf(r), client: r.client, text: r.text, buttons: keyboard(r).flat().map((b) => b.callback_data.slice(-1)).join(''),
          ageSec: Math.round((Date.now() - r.created) / 1000) })));
      case 'POST /screen/forget':   // quên giấy phép màn hình GNOME đã nhớ (hết hạn quyền, hoặc chủ gõ tay)
        return send(200, await ownerPortal({ cmd: 'forget' }, 10_000));
      case 'POST /decide': {
        const r = requests.get(body.id);
        if (!r || r.state !== 'pending') return send(404, { error: 'Không có yêu cầu đang chờ này' });
        if (!['a', 'h', 'l', 'r'].includes(body.decision)) return send(400, { error: 'a | h | l | r' });
        log({ id: r.id, console: `quyết định ${body.decision} tại máy` });
        return send(200, { result: applyDecision(r, body.decision, ' · tại máy') });
      }
      default: return send(404, { error: 'Không có đường này' });
    }
  } catch (e) { send(400, { error: e.message }); }
});
if (existsSync(ADMIN_SOCKET)) unlinkSync(ADMIN_SOCKET);
adminServer.listen(ADMIN_SOCKET, () => { chmodSync(ADMIN_SOCKET, 0o600); publishBanNgay(); });

// Socket riêng từng agent: root:ag-<tên> 0660 → chỉ agent đó nối được, danh tính = socket. Đồng bộ theo sổ agent.
const agentServers = new Map();
function syncAgentSockets() {
  let names = [];
  try { names = Object.entries(JSON.parse(readFileSync(CLIENTS, 'utf8'))).filter(([, c]) => c.user).map(([n]) => n); } catch { /* chưa có sổ */ }
  mkdirSync(AGENT_DIR, { recursive: true, mode: 0o755 });
  for (const n of names) {
    if (agentServers.has(n) || !/^[a-z][a-z0-9-]{1,20}$/.test(n)) continue;
    const gid = groupId(`ag-${n}`);
    if (gid == null) continue;
    const sock = path.join(AGENT_DIR, `${n}.sock`);
    if (existsSync(sock)) unlinkSync(sock);
    const srv = makeServer(agentWho(n));
    srv.listen(sock, () => { chownSync(sock, 0, gid); chmodSync(sock, 0o660); });
    agentServers.set(n, { srv, sock });
  }
  for (const [n, { srv, sock }] of agentServers) {
    if (names.includes(n)) continue;
    srv.close(); try { unlinkSync(sock); } catch { /* đã xoá */ } agentServers.delete(n);
  }
}
function groupId(name) {
  const line = readFileSync('/etc/group', 'utf8').split('\n').find((l) => l.startsWith(`${name}:`));
  return line ? Number(line.split(':')[2]) : null;
}
function cancelSuspended() {
  const sus = suspendedList();
  for (const r of requests.values()) {
    if (r.state === 'pending' && sus.includes(agentOf(r))) { setState(r, 'rejected'); finishMessage(r, '⛔ Agent đã bị dừng khẩn cấp, huỷ'); }
  }
}
syncAgentSockets();
// Luật/phiên còn sống: agent phụ còn trong sổ; trợ lý chính (ssh:<tên>) còn trong sổ; chủ máy thì giữ
function pruneRules() {
  let names = [];
  try { names = Object.keys(JSON.parse(readFileSync(CLIENTS, 'utf8'))); } catch { return; }
  const isLive = (k) => {
    const m = /^(?:phu:|chu:ssh:)([a-z][a-z0-9-]{1,20})$/.exec(k);
    return m ? names.includes(m[1]) : true;
  };
  const R = loadRules();
  if (prune(R, isLive)) saveRules(R);
}

const STATE_FILE = process.env.AXLE_APPROVE_STATE || '/var/lib/axle-approve/state.json';
function digestText(sinceMs) {
  return buildDigest({ sinceMs, owner: cfg().user, host: hostname(), approvalsLog: LOG,
    vaultLog: '/var/log/axle-vault/access.log', rules: loadRules() });
}
async function maybeDigest() {
  const c = cfg();
  const hour = c.digestHour ?? 21;
  if (hour == null || hour === false || !c.owner) return;
  const now = new Date();
  const today = now.toLocaleDateString('sv-SE');
  let st = {};
  try { st = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* chưa có */ }
  if (now.getHours() !== hour || st.lastDigest === today) return;
  const since = st.lastDigestAt ? Date.parse(st.lastDigestAt) : Date.now() - 24 * 3600 * 1000;
  await tg('sendMessage', { chat_id: c.owner, text: cap(digestText(since), 4000) }).catch((e) => log({ warn: `tóm tắt: ${e.message}` }));
  writeDurable(STATE_FILE, JSON.stringify({ lastDigest: today, lastDigestAt: now.toISOString() }));
}

setInterval(() => { syncAgentSockets(); cancelSuspended(); pruneRules(); }, 3000);
setInterval(() => { maybeDigest().catch(() => {}); }, 60_000);
// Rút quyền hết hạn (thư mục: gỡ ACL + tháo khỏi hộp cát; mạng: bỏ khỏi danh sách)
setInterval(() => { runAxle(['agent', 'expire']).then((r) => { if (r.output.trim()) log({ expire: r.output.trim() }); }); }, 60_000);
pollTelegram();
