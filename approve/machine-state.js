// Số liệu tình trạng máy gửi cho app iPhone (tab Máy). Tách riêng để thử được không cần bộ duyệt chạy.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

const CLIENTS = process.env.AXLE_MCP_CLIENTS || '/etc/axle/mcp-clients.json';
const STATE = process.env.AXLE_AGENTS_STATE || '/etc/axle/agents-state.json';
const SNAPPER = ['/usr/bin/snapper', '-c', 'root'];

// Không dùng runProc của daemon: ở đây chỉ cần đọc nhanh, lệnh nào lâu quá 5 giây thì bỏ qua
function chay(cmd, args) {
  return new Promise((xong) => {
    let out = '';
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return xong(''); }
    const t = setTimeout(() => p.kill('SIGKILL'), 5000);
    p.stdout.on('data', (d) => { if (out.length < 65536) out += d; });
    p.on('error', () => { clearTimeout(t); xong(''); });
    p.on('close', () => { clearTimeout(t); xong(out); });
  });
}

// Tình trạng máy cho app (tab Máy). CHỈ ĐỌC, số liệu thô — không tên file, không nội dung, không khoá.
// Gói phải nhỏ: đi qua hộp niêm phong của trạm chuyển tiếp, và điện thoại hỏi lại mỗi lần mở app.
export async function machineState() {
  const doc = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  const suspendedList = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')).suspended ?? []; } catch { return []; } };
  const gb = (kb) => Math.round((kb / 1048576) * 10) / 10;
  const mem = Object.fromEntries(doc('/proc/meminfo').split('\n')
    .map((l) => l.match(/^(\w+):\s+(\d+) kB$/)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
  const [df, hong, snap] = await Promise.all([
    chay('df', ['-kP', '/']),
    chay('systemctl', ['--failed', '--no-legend', '--plain', '--no-pager']),
    chay(SNAPPER[0], [...SNAPPER.slice(1), '--machine-readable', 'csv', 'list', '--columns', 'number,date']),
  ]);
  const cot = df.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
  const dungDia = Number(cot[2] || 0);
  const tongDia = Number(cot[1] || 0);
  const ramTong = mem.MemTotal ?? 0;
  const ramDung = ramTong - (mem.MemAvailable ?? 0);
  const cuoi = snap.trim().split('\n').filter((l) => /^\d/.test(l)).at(-1)?.split(',') ?? [];
  const clients = (() => { try { return JSON.parse(readFileSync(CLIENTS, 'utf8')); } catch { return {}; } })();
  const pam = doc('/etc/pam.d/gdm-password');
  return {
    host: hostname(),
    version: doc('/etc/axle/version').trim() || '?',
    os: doc('/etc/os-release').match(/^PRETTY_NAME="(.*)"$/m)?.[1] ?? '?',
    uptimeSec: Math.round(Number(doc('/proc/uptime').split(' ')[0] || 0)),
    load1: Number(doc('/proc/loadavg').split(' ')[0] || 0),
    disk: { totalGb: gb(tongDia), usedGb: gb(dungDia), pct: tongDia ? Math.round((dungDia / tongDia) * 100) : 0 },
    ram: { totalGb: gb(ramTong), usedGb: gb(ramDung), pct: ramTong ? Math.round((ramDung / ramTong) * 100) : 0 },
    failed: hong.trim() ? hong.trim().split('\n').map((l) => l.split(/\s+/)[0]).slice(0, 5) : [],
    agents: { total: Object.keys(clients).length, suspended: suspendedList().length },
    snapshot: cuoi.length >= 2 ? { number: Number(cuoi[0]), date: cuoi[1] } : null,
    desktop: existsSync('/etc/dconf/db/axle.d/99-axle'),
    loginPhone: /pam-approve\.mjs/.test(pam),
    ts: Date.now(),
  };
}

