// Công cụ MCP của Axle — dùng chung cho cổng stdio (server.js, qua SSH) và cổng HTTP (http.js).
// v1: chỉ xem + chụp snapshot. Việc có thể phá (undo, restart, chạy lệnh) để Nhịp 3, khi có duyệt qua Telegram.
// Mọi lần gọi ghi một dòng JSON vào nhật ký (AXLE_AUDIT, mặc định ~/.local/state/axle/audit.jsonl).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import * as files from './files.js';
import * as screen from './screen.js';
import * as web from './web.js';
import * as tay from './tay.js';
import * as brain from './brain.js';
import * as lich from './lich.js';
import * as thu from './thu.js';

const AUDIT = process.env.AXLE_AUDIT || path.join(homedir(), '.local/state/axle/audit.jsonl');
const SNAP = process.env.AXLE_SNAP || '/usr/local/lib/axle/axle-snap';
const PM2 = path.join(path.dirname(process.execPath), 'pm2');
const MAX_TEXT = 30_000;
const VAULT_SOCKET = process.env.AXLE_VAULT_SOCKET || '/run/axle-vault/vault.sock';
const APPROVE_SOCKET = process.env.AXLE_APPROVE_SOCKET || '/run/axle-approve/approve.sock';
const NAME = /^[A-Za-z0-9@._:-]{1,128}$/;

function run(cmd, args, { timeout = 20_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function clip(s) {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (cắt, còn ${s.length - MAX_TEXT} ký tự)` : s;
}

async function audit(entry) {
  // AXLE_AUDIT=- : ra stdout → journald (máy chủ của agent riêng: agent không sửa được journal)
  if (AUDIT === '-') { process.stdout.write(JSON.stringify(entry) + '\n'); return; }
  try {
    await mkdir(path.dirname(AUDIT), { recursive: true });
    await appendFile(AUDIT, JSON.stringify(entry) + '\n');
  } catch { /* nhật ký hỏng không được làm hỏng công cụ */ }
}

const TOOL_INFO = new Map();

// Dựng một máy chủ MCP. allow: danh sách công cụ được phép (undefined = tất cả, dùng cho stdio qua SSH).
// clientName: tên ghi vào nhật ký — với HTTP lấy theo token, không tin tên client tự khai.
export function buildServer({ allow, clientName } = {}) {
  const server = new McpServer(
    { name: 'axle', version: '0.1.0' },
    { instructions: `Tools for the Axle machine "${hostname()}". Read-only inspection, file access (read in allowed areas, write only in the work area ~/work), creating btrfs snapshots, and HTTP requests that use vault secrets without seeing them. Secrets (.ssh, vault, .env, keys) are always blocked. Every call is audited. Commands, service restarts, snapshot undo and file deletion need the owner's approval (Axle phone app, Telegram or at the machine; then approval_status).` },
  );

  // Bọc mọi công cụ: kiểm lỗi, cắt chữ, ghi nhật ký.
  // auditArgs: đổi tham số trước khi ghi nhật ký (vd. không ghi nội dung file, chỉ số byte + hash).
  function tool(name, config, handler, { auditArgs = (x) => x } = {}) {
    // Công cụ không có inputSchema được SDK gọi với (extra) thay vì (args, extra)
    TOOL_INFO.set(name, { readOnly: !!config.annotations?.readOnlyHint });
    if (allow && !allow.includes(name)) return;   // token HTTP chỉ thấy đúng công cụ được cấp
    server.registerTool(name, config, async (...a) => {
      const args = config.inputSchema ? a[0] : {};
      const t0 = Date.now();
      let out, ok = true;
      try {
        out = await handler(args, { client: clientName ?? server.server.getClientVersion()?.name });
      } catch (e) {
        ok = false;
        out = `Lỗi: ${e.message}`;
      }
      await audit({ ts: new Date().toISOString(), tool: name, args: auditArgs(args), ok, ms: Date.now() - t0,
        client: clientName ?? server.server.getClientVersion()?.name });
      // Công cụ trả ảnh (vd. chụp màn hình agent) → gửi kèm khối image, KHÔNG ghi ảnh vào nhật ký
      const content = typeof out === 'object' && out?.image
        ? [{ type: 'image', data: out.image, mimeType: out.mimeType || 'image/png' },
          ...(out.text ? [{ type: 'text', text: clip(out.text) }] : [])]
        : [{ type: 'text', text: clip(String(out)) }];
      return { content, isError: !ok };
    });
  }

  const must = (r, what) => {
    if (!r.ok) throw new Error(`${what} thất bại: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
    return r.stdout;
  };
  const unitArg = z.string().regex(NAME).describe('systemd unit name, e.g. "ssh" or "docker.service"');
  const linesArg = z.number().int().min(1).max(500).default(100).describe('How many lines, 1-500');

  tool('system_status', {
    title: 'System status',
    description: 'Hostname, OS, uptime, disk, memory, swap, load, failed services and Axle version.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const [os, up, df, free, load, failed] = await Promise.all([
      readFile('/etc/os-release', 'utf8'), run('uptime', ['-p']), run('df', ['-h', '--output=size,used,avail,pcent,fstype', '/']),
      run('free', ['-h']), readFile('/proc/loadavg', 'utf8'), run('systemctl', ['--failed', '--no-legend', '--plain']),
    ]);
    const version = existsSync('/etc/axle/version') ? (await readFile('/etc/axle/version', 'utf8')).trim() : '?';
    return [
      `host: ${hostname()} · axle ${version}`,
      `os: ${os.match(/^PRETTY_NAME="(.*)"$/m)?.[1]} · ${up.stdout.trim()}`,
      `load: ${load.split(' ').slice(0, 3).join(' ')}`,
      `disk /:\n${df.stdout.trim()}`,
      `memory:\n${free.stdout.trim()}`,
      `failed services: ${failed.stdout.trim() || 'none'}`,
    ].join('\n');
  });

  tool('service_status', {
    title: 'Service status',
    description: 'State of one systemd service: active state, since when, main PID, memory, restarts.',
    inputSchema: { unit: unitArg },
    annotations: { readOnlyHint: true },
  }, async ({ unit }) => must(await run('systemctl', ['show', unit, '--no-pager',
    '--property=Id,Description,LoadState,ActiveState,SubState,ActiveEnterTimestamp,MainPID,MemoryCurrent,NRestarts,Result']), 'systemctl show'));

  tool('logs', {
    title: 'Service logs',
    description: 'Recent journal lines of one systemd service.',
    inputSchema: { unit: unitArg, lines: linesArg,
      since: z.string().regex(/^[0-9A-Za-z :-]{1,32}$/).optional().describe('e.g. "1 hour ago" or "2026-09-19 10:00"') },
    annotations: { readOnlyHint: true },
  }, async ({ unit, lines, since }) => {
    const args = ['-u', unit, '-n', String(lines), '--no-pager', '-o', 'short-iso'];
    if (since) args.push('--since', since);
    return must(await run('journalctl', args), 'journalctl') || '(không có dòng nào)';
  });

  tool('docker_ps', {
    title: 'Docker containers',
    description: 'All Docker containers with image, status and ports.',
    annotations: { readOnlyHint: true },
  }, async () => must(await run('docker', ['ps', '-a', '--format', 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']), 'docker ps'));

  tool('docker_logs', {
    title: 'Docker container logs',
    description: 'Recent log lines of one container.',
    inputSchema: { container: z.string().regex(NAME).describe('Container name or ID'), lines: linesArg },
    annotations: { readOnlyHint: true },
  }, async ({ container, lines }) => {
    const r = await run('docker', ['logs', '--tail', String(lines), container]);
    must(r, 'docker logs');
    return `${r.stdout}${r.stderr}` || '(không có dòng nào)';
  });

  tool('pm2_list', {
    title: 'PM2 processes',
    description: 'Node processes managed by PM2: status, restarts, CPU, memory, uptime.',
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!existsSync(PM2)) return 'PM2 chưa cài';
    const list = JSON.parse(must(await run(PM2, ['jlist']), 'pm2 jlist') || '[]');
    if (!list.length) return 'Không có tiến trình PM2 nào';
    return list.map((p) => `${p.name} · ${p.pm2_env.status} · restarts ${p.pm2_env.restart_time} · cpu ${p.monit.cpu}% · mem ${Math.round(p.monit.memory / 1048576)}MB · up since ${new Date(p.pm2_env.pm_uptime).toISOString()}`).join('\n');
  });

  tool('pm2_logs', {
    title: 'PM2 process logs',
    description: 'Recent stdout and stderr lines of one PM2 process.',
    inputSchema: { name: z.string().regex(NAME).describe('PM2 process name'), lines: linesArg },
    annotations: { readOnlyHint: true },
  }, async ({ name, lines }) => {
    const dir = path.join(homedir(), '.pm2/logs');
    const out = [];
    for (const kind of ['out', 'error']) {
      const f = path.join(dir, `${name}-${kind}.log`);
      if (existsSync(f)) out.push(`--- ${kind} ---\n${must(await run('tail', ['-n', String(lines), f]), 'tail')}`);
    }
    return out.join('\n') || `Không thấy log của "${name}"`;
  });

  tool('snapshot_list', {
    title: 'List snapshots',
    description: 'System snapshots (btrfs/snapper): number, date, description. /home and Docker data are not part of them.',
    annotations: { readOnlyHint: true },
  }, async () => must(await run('sudo', ['-n', SNAP, 'list']), 'snapshot list'));

  tool('snapshot_diff', {
    title: 'Changes since snapshot',
    description: 'System files changed since the given snapshot number (up to 400 lines).',
    inputSchema: { number: z.number().int().min(1).describe('Snapshot number from snapshot_list') },
    annotations: { readOnlyHint: true },
  }, async ({ number }) => {
    const out = must(await run('sudo', ['-n', SNAP, 'status', String(number)], { timeout: 60_000 }), 'snapshot status');
    const rows = out.split('\n');
    return rows.length > 400 ? `${rows.slice(0, 400).join('\n')}\n… (${rows.length - 400} dòng nữa)` : (out || 'Không có gì thay đổi');
  });

  tool('snapshot_create', {
    title: 'Create snapshot',
    description: 'Take a system snapshot now, e.g. before changing configuration. Returns its number.',
    inputSchema: { description: z.string().min(1).max(120).describe('What is about to change') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ description }) => `Đã chụp snapshot #${must(await run('sudo', ['-n', SNAP, 'create', description]), 'snapshot create').trim()}`);

  tool('audit_recent', {
    title: 'Recent audit log',
    description: 'Latest calls made through this MCP server (tool, arguments, result, duration).',
    inputSchema: { lines: z.number().int().min(1).max(200).default(30) },
    annotations: { readOnlyHint: true },
  }, async ({ lines }) => {
    if (!existsSync(AUDIT)) return 'Nhật ký trống';
    return (await readFile(AUDIT, 'utf8')).trim().split('\n').slice(-lines).join('\n');
  });

  const pathArg = z.string().min(1).max(4096).describe('Absolute path, ~/relative, or relative to home');

  tool('file_list', {
    title: 'List directory',
    description: `List a directory (sizes, modified time). Readable areas: ${files.cfg().read.join(', ')}. Secret locations are hidden.`,
    inputSchema: { path: pathArg, depth: z.number().int().min(1).max(4).default(1).describe('How deep to recurse, 1-4') },
    annotations: { readOnlyHint: true },
  }, async ({ path: p, depth }) => files.list(p, depth));

  tool('file_read', {
    title: 'Read file',
    description: 'Read a text file with line numbers. Use offset/limit for long files. Secrets (.ssh, vault, .env, keys) are always blocked.',
    inputSchema: { path: pathArg, offset: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(2000).default(400) },
    annotations: { readOnlyHint: true },
  }, async ({ path: p, offset, limit }) => files.read(p, offset, limit));

  tool('file_search', {
    title: 'Search text in files',
    description: 'Find a literal text in files under a directory (skips node_modules, .git, binaries, secrets). Up to 200 hits.',
    inputSchema: { path: pathArg, text: z.string().min(1).max(200), ignoreCase: z.boolean().default(true) },
    annotations: { readOnlyHint: true },
  }, async ({ path: p, text, ignoreCase }) => files.search(p, text, ignoreCase));

  tool('file_write', {
    title: 'Write file',
    description: `Write a text file, only inside: ${files.cfg().write.join(', ')}. mode=create fails if the file exists; overwrite keeps the old version in history; append adds to the end. No delete.`,
    inputSchema: { path: pathArg, content: z.string().max(1024 * 1024), mode: z.enum(['create', 'overwrite', 'append']).default('create') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ path: p, content, mode }) => files.write(p, content, mode),
  { auditArgs: ({ content, ...rest }) => ({ ...rest, ...files.digest(content ?? '') }) });

  // Gọi vault qua Unix socket. Vault không bao giờ trả giá trị khoá.
  const vault = (method, route, payload) => unixJson(VAULT_SOCKET, 'vault', method, route, payload);
  const approve = (method, route, payload) => unixJson(APPROVE_SOCKET, 'dịch vụ duyệt', method, route, payload);

  function unixJson(socketPath, label, method, route, payload) {
    return new Promise((resolve, reject) => {
      const data = payload ? JSON.stringify(payload) : undefined;
      const req = httpRequest({ socketPath, path: route, method,
        headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let j;
          try { j = JSON.parse(body); } catch { return reject(new Error(`${label} trả lời lạ: ${body.slice(0, 200)}`)); }
          return res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || `${label} lỗi ${res.statusCode}`));
        });
      });
      req.on('error', (e) => reject(new Error(`Không nối được ${label} (${e.code || e.message})`)));
      if (data) req.write(data);
      req.end();
    });
  }

  tool('vault_list', {
    title: 'List vault secrets',
    description: 'Names of stored secrets and which hosts each may be sent to. Values are never shown. Use them in http_request as {{secret.NAME}}.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const list = await vault('GET', '/secrets');
    return list.length
      ? list.map((x) => `${x.name} → ${x.hosts.join(', ') || '(không nơi nào)'}${x.desc ? ` · ${x.desc}` : ''}`).join('\n')
      : 'Vault trống. Người dùng thêm khoá bằng: sudo axle vault set TEN --host api.example.com';
  });

  tool('http_request', {
    title: 'HTTP request (with vault secrets)',
    description: 'Make an HTTPS request. Put secrets as {{secret.NAME}} in the URL path/query, headers or body; the vault fills them in, '
      + 'only sends each secret to its allowed hosts, and removes secret values from the response. Redirects are not followed.',
    inputSchema: {
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
      url: z.string().url().max(8192),
      headers: z.record(z.string(), z.string().max(8192)).default({}),
      body: z.string().max(1024 * 1024).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const r = await vault('POST', '/request', args);
    const head = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `HTTP ${r.status}${head ? `\n${head}` : ''}\n\n${r.body}${r.truncated ? '\n… (cắt ở 1MB)' : ''}`;
  }, { auditArgs: ({ body, ...rest }) => ({ ...rest, ...(body != null ? { body: files.digest(body) } : {}) }) });


  // ---------- việc có thể phá: phải được chủ duyệt (app / Telegram / tại máy) ----------
  const waitArg = z.number().int().min(0).max(110).default(90)
    .describe('Seconds to wait for the owner to approve before returning (then use approval_status)');

  function showApproval(r) {
    const head = { pending: `⏳ Đang chờ chủ duyệt (#${r.id}) — app Axle trên điện thoại, Telegram hoặc tại máy. Gọi approval_status với id này để xem tiếp.`,
      running: `▶ Đã duyệt, đang chạy (#${r.id}).`, rejected: `❌ Chủ đã từ chối (#${r.id}). Không chạy.`,
      expired: `⌛ Hết hạn, không ai duyệt (#${r.id}). Không chạy.`,
      done: r.auto ? `✅ Tự duyệt theo ${r.auto} (chủ đã cho phép), chạy xong (#${r.id}), mã thoát ${r.exitCode}.`
        : `✅ Đã duyệt và chạy xong (#${r.id}), mã thoát ${r.exitCode}.`,
      failed: `⚠ ${r.auto ? `Tự duyệt theo ${r.auto}` : 'Đã duyệt'} nhưng chạy lỗi (#${r.id}), mã thoát ${r.exitCode}.` }[r.state] ?? `Trạng thái ${r.state} (#${r.id})`;
    return r.output ? `${head}\n\n${r.output}` : head;
  }

  async function askAndWait(action, params, client, waitSec) {
    const r = await approve('POST', '/request', { action, params, client });
    return showApproval(waitSec ? await approve('GET', `/status/${r.id}?wait=${waitSec}`) : r);
  }

  // CẦU XIN PHÉP cho Claude Code chạy trên máy:
  //   claude -p … --mcp-config <axle> --permission-prompt-tool mcp__axle__duyet_quyen
  // Claude Code gọi công cụ này mỗi khi muốn dùng Bash/Edit/Write… (những gì không được cho sẵn). Ta biến
  // nó thành một yêu cầu duyệt bình thường → điện thoại chủ rung → chờ tới khi có quyết định → trả lời
  // đúng dạng Claude Code hiểu: {"behavior":"allow","updatedInput":…} hoặc {"behavior":"deny","message":…}.
  // Chờ theo từng khúc 110 giây (giới hạn của /status?wait) cho tới khi hết hạn yêu cầu (mặc định 10 phút).
  tool('duyet_quyen', {
    title: 'Permission prompt for Claude Code (owner approves on the phone)',
    description: 'Internal bridge for `claude --permission-prompt-tool mcp__axle__duyet_quyen`. Turns a tool '
      + 'permission request into an Axle approval the owner answers on the phone (Face ID) or Telegram, and '
      + 'returns the allow/deny decision in the shape Claude Code expects.',
    inputSchema: {
      tool_name: z.string().max(64),
      input: z.record(z.any()).default({}),
      tool_use_id: z.string().max(200).optional(),
      permission_suggestions: z.any().optional(),
    },
    annotations: { readOnlyHint: false },
  }, async ({ tool_name, input }, { client }) => {
    const tra = (o) => JSON.stringify(o);
    let r;
    try {
      r = await approve('POST', '/request', { action: 'claude_tool', params: { tool: tool_name, input }, client });
    } catch (e) {
      return tra({ behavior: 'deny', message: `Axle không nhận được yêu cầu duyệt: ${e.message}` });
    }
    const CUOI = new Set(['done', 'failed', 'rejected', 'expired']);
    for (let i = 0; i < 12 && !CUOI.has(r.state); i++) {   // 12 × 110s ≈ 22 phút, dư so với hạn 10 phút
      r = await approve('GET', `/status/${r.id}?wait=110`).catch(() => r);
    }
    if (r.state === 'done') return tra({ behavior: 'allow', updatedInput: input });
    const vi = { rejected: 'Chủ máy đã từ chối', expired: 'Không ai duyệt trong thời hạn', failed: 'Bộ duyệt báo lỗi' }[r.state]
      ?? `Yêu cầu còn ở trạng thái ${r.state}`;
    return tra({ behavior: 'deny', message: `${vi} (#${r.id}). Đừng thử lại việc này.` });
  });

  tool('run_command', {
    title: 'Run a shell command (needs owner approval)',
    description: 'Run a bash command. The owner sees the exact command (Axle phone app / Telegram) and must approve before it runs. '
      + 'Runs as the agent user in ~/work by default; asRoot=true runs as root (flagged in the message). 120 s limit.',
    inputSchema: {
      command: z.string().min(1).max(4000),
      cwd: z.string().max(4096).optional().describe('Absolute working directory (default ~/work)'),
      asRoot: z.boolean().default(false),
      waitSec: waitArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ command, cwd, asRoot, waitSec }, { client }) => askAndWait('run_command', { command, cwd, asRoot }, client, waitSec));

  tool('service_restart', {
    title: 'Restart a service (needs owner approval)',
    description: 'Restart one systemd service after the owner approves it.',
    inputSchema: { unit: unitArg, waitSec: waitArg },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ unit, waitSec }, { client }) => askAndWait('service_restart', { unit }, client, waitSec));

  tool('snapshot_undo', {
    title: 'Undo system changes back to a snapshot (needs owner approval)',
    description: 'Revert system files to how they were at snapshot N. The owner sees the exact list of changes '
      + 'and must approve. Only changes up to the moment of asking are reverted. /home and Docker data are never touched. '
      + 'A snapshot is taken first so the undo itself can be undone.',
    inputSchema: { number: z.number().int().min(1).describe('Snapshot number from snapshot_list'), waitSec: waitArg },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ number, waitSec }, { client }) => askAndWait('snapshot_undo', { number }, client, waitSec));

  tool('file_delete', {
    title: 'Delete a file or folder (needs owner approval)',
    description: 'Move a file or folder in the home directory to the trash (~/.local/share/axle-trash) after the owner approves. '
      + 'Protected places (.ssh, .config, vault, …) cannot be deleted.',
    inputSchema: { path: z.string().min(1).max(4096).describe('Absolute path or ~/relative'), waitSec: waitArg },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ path: p, waitSec }, { client }) => {
    const abs = p === '~' ? homedir() : p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : path.resolve(homedir(), p);
    return askAndWait('file_delete', { path: abs }, client, waitSec);
  });

  // Màn hình riêng của agent (chỉ có khi chủ bật: sudo axle agent screen <tên> on)
  if (screen.hasDisplay()) screen.register(tool);
  else for (const [n, ro] of screen.TOOL_NAMES) TOOL_INFO.set(n, { readOnly: ro });
  // Đọc web app thành BẢNG PHẦN TỬ ĐÁNH SỐ — chỉ có nghĩa khi agent có màn hình riêng để mở app
  if (screen.hasDisplay() && web.coWeb()) web.registerWeb(tool);
  // Tay cho MỌI ứng dụng trên desktop của chủ (AT-SPI) — chỉ trong ngữ cảnh chủ có bus phiên đăng nhập
  if (tay.coTay()) tay.registerTay(tool);
  // Bộ não Axle (~/Axle/Brain): tra/ghi kho tri thức của chủ — chỉ trong ngữ cảnh chủ
  if (brain.coBrain()) brain.register(tool);
  // Lịch của Axle (~/Axle/lich.json): nhắc chủ đúng giờ + việc Claude tự làm theo lịch — chỉ trong ngữ cảnh chủ
  if (lich.coLich()) lich.register(tool);
  // Thư của Axle (~/Axle/Thu, approve/thu.js): đọc thư dùng thẳng; gửi thư = việc thu_gui, chủ duyệt từng lá
  if (thu.coThu()) thu.register(tool, askAndWait);
  // Màn hình THẬT của chủ: luôn khai báo, nhưng dịch vụ duyệt chỉ cho qua khi chủ đã cấp quyền còn hạn
  screen.registerOwnerScreen(tool, approve);

  tool('approval_status', {
    title: 'Approval status',
    description: 'State of an approval request (pending, rejected, expired, done, failed) and its output; can wait for it.',
    inputSchema: { id: z.string().regex(/^[0-9a-f]{8}$/), waitSec: waitArg },
    annotations: { readOnlyHint: true },
  }, async ({ id, waitSec }) => showApproval(await approve('GET', `/status/${id}?wait=${waitSec}`)));

  return server;
}

// Tên + tính chất mọi công cụ (để CLI kiểm tên khi cấp quyền cho token).
export function toolInfo() {
  if (!TOOL_INFO.size) buildServer();
  return [...TOOL_INFO].map(([name, v]) => ({ name, ...v }));
}
