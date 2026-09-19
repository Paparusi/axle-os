// Vùng file cho agent: đọc rộng, ghi hẹp, bí mật luôn bị chặn.
// Cấu hình ghi đè ở /etc/axle/mcp.json (root sở hữu — agent không tự nới quyền cho mình được):
//   { "read": ["~", "/opt/axle"], "write": ["~/work"], "denyPaths": ["~/private"], "denyNames": ["*.bak"] }
// denyPaths/denyNames trong file cấu hình được CỘNG thêm vào danh sách chặn gốc, không thay thế.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const HOME = homedir();
const CONFIG = process.env.AXLE_MCP_CONFIG || '/etc/axle/mcp.json';
const HISTORY = path.join(HOME, '.local/state/axle/file-history');

const DEFAULTS = {
  read: ['~', '/opt/axle', '/etc/axle', '/var/log'],
  write: ['~/work'],
};
// Không bao giờ cho đụng, dù cấu hình nói gì.
const DENY_PATHS = [
  '~/.ssh', '~/.gnupg', '~/.aws', '~/.docker', '~/.kube', '~/.config', '~/.pm2',
  '~/.local/share/keyrings', '~/.local/state/axle', '~/brain/vault', '~/.claude',
];
const DENY_WRITE_PATHS = ['/etc', '/opt', '/usr', '/var', '/boot', '/root']; // phòng khi cấu hình lỡ mở ghi
const DENY_NAMES = [
  '.env', '.env.*', '*.env', '*.pem', '*.key', '*.p8', '*.p12', '*.pfx', '*.keystore', '*.jks',
  'id_rsa*', 'id_ed25519*', 'id_ecdsa*', '.git-credentials', '.netrc', '.npmrc', '.pgpass',
  '.credentials*', 'credentials*', '*secret*', 'tokens.env',
];

const expand = (p) => (p === '~' ? HOME : p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };

// Quyền cấp riêng cho agent đang chạy (axle agent grant … thu-muc): /etc/axle/grants/<tên>.json, root sở hữu.
// <tên> lấy từ AXLE_AS (trợ lý chính, khoá SSH ép) hoặc AXLE_CLIENT (agent phụ, systemd đặt) — agent không tự đổi được.
const GRANTS_DIR = process.env.AXLE_GRANTS_DIR || '/etc/axle/grants';
const WHO = process.env.AXLE_AS || process.env.AXLE_CLIENT || '';

function grantedDirs() {
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(WHO)) return [];
  const f = path.join(GRANTS_DIR, `${WHO}.json`);
  if (!existsSync(f)) return [];
  const now = Date.now();
  return (JSON.parse(readFileSync(f, 'utf8')).dirs ?? []).filter((d) => !d.until || Date.parse(d.until) > now);
}

// Agent phụ có HOME riêng, nên ~/.ssh ở trên là của nó; chặn thêm vùng bí mật của CHỦ (phòng cấp nhầm thư mục)
function ownerDeny() {
  let owner = 'admin_1';
  try { owner = readFileSync('/etc/axle/owner', 'utf8').trim() || owner; } catch { /* mặc định */ }
  const h = `/home/${owner}`;
  return h === HOME ? [] : DENY_PATHS.map((d) => d.replace(/^~/, h));
}

function loadConfig() {
  let user = {};
  if (existsSync(CONFIG)) user = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const roots = (list) => list.map((p) => realOrSelf(path.resolve(expand(p))));
  const g = grantedDirs();
  return {
    read: roots([...(user.read ?? DEFAULTS.read), ...g.map((d) => d.path)]),
    write: roots([...(user.write ?? DEFAULTS.write), ...g.filter((d) => d.mode === 'rw').map((d) => d.path)]),
    denyPaths: roots([...DENY_PATHS, ...ownerDeny(), ...(user.denyPaths ?? [])]),
    denyWrite: roots(DENY_WRITE_PATHS),
    denyNames: [...DENY_NAMES, ...(user.denyNames ?? [])].map(globRe),
  };
}
// Nạp lại tối đa mỗi 2 giây: cấp/rút quyền (và quyền hết hạn) có hiệu lực ngay, không cần khởi động lại
let cached = null;
let cachedAt = 0;
export function cfg() {
  if (!cached || Date.now() - cachedAt > 2000) { cached = loadConfig(); cachedAt = Date.now(); }
  return cached;
}

const inside = (p, root) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
const nameDenied = (p) => p.split('/').some((seg) => seg && cfg().denyNames.some((re) => re.test(seg)));
const pathDenied = (p) => cfg().denyPaths.some((d) => inside(p, d)) || nameDenied(p);
export const hidden = (p) => pathDenied(realOrSelf(p));

function userPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Đường dẫn không hợp lệ');
  const e = expand(p);
  return path.resolve(path.isAbsolute(e) ? e : path.join(HOME, e));
}

// Đường dẫn để ĐỌC: phải tồn tại, đường dẫn THẬT (sau symlink) nằm trong vùng đọc và không bị chặn.
export function forRead(p) {
  const abs = userPath(p);
  if (pathDenied(abs)) throw new Error(`Bị chặn: ${p}`);
  let real;
  try { real = realpathSync(abs); } catch { throw new Error(`Không tồn tại: ${p}`); }
  if (!cfg().read.some((r) => inside(real, r))) throw new Error(`Ngoài vùng được đọc: ${p}`);
  if (pathDenied(real)) throw new Error(`Bị chặn: ${p}`);
  return real;
}

// Đường dẫn để GHI: thư mục cha thật nằm trong vùng ghi; không ghi xuyên symlink.
export async function forWrite(p) {
  const abs = userPath(p);
  if (pathDenied(abs)) throw new Error(`Bị chặn: ${p}`);
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) throw new Error(`Không ghi vào symlink: ${p}`);
  let anc = path.dirname(abs);
  while (!existsSync(anc)) anc = path.dirname(anc);
  const realAnc = realpathSync(anc);
  const target = path.join(realAnc, path.relative(anc, abs));
  const c = cfg();
  const ok = c.write.some((r) => inside(target, r) && target !== r)
    && !c.denyWrite.some((d) => inside(target, d) && !c.write.some((r) => inside(target, r) && inside(r, d)));
  if (!ok || pathDenied(target)) throw new Error(`Ngoài vùng được ghi (${c.write.join(', ')}): ${p}`);
  await mkdir(path.dirname(target), { recursive: true });
  return target;
}

const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

export async function list(p, depth = 1) {
  const root = forRead(p);
  const out = [];
  async function walk(dir, d) {
    for (const ent of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= 500) return;
      const full = path.join(dir, ent.name);
      if (hidden(full)) continue;
      const rel = path.relative(root, full) || '.';
      if (ent.isDirectory()) {
        out.push(`${rel}/`);
        if (d < depth && ent.name !== 'node_modules' && ent.name !== '.git') await walk(full, d + 1);
      } else {
        const s = await stat(full).catch(() => null);
        out.push(`${rel}${ent.isSymbolicLink() ? ' @' : ''}  ${s ? `${s.size}B  ${s.mtime.toISOString().slice(0, 16)}` : ''}`);
      }
    }
  }
  if (!(await stat(root)).isDirectory()) throw new Error(`Không phải thư mục: ${p}`);
  await walk(root, 1);
  return `${root}\n${out.join('\n') || '(trống)'}${out.length >= 500 ? '\n… (dừng ở 500 mục)' : ''}`;
}

export async function read(p, offset = 1, limit = 400) {
  const real = forRead(p);
  if ((await stat(real)).isDirectory()) throw new Error(`Là thư mục, dùng file_list: ${p}`);
  const buf = await readFile(real);
  if (isBinary(buf)) throw new Error(`File nhị phân, không đọc dạng chữ: ${p}`);
  const lines = buf.toString('utf8').split('\n');
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const more = lines.length - (offset - 1 + slice.length);
  return `${slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n')}${more > 0 ? `\n… còn ${more} dòng (đọc tiếp với offset=${offset + slice.length})` : ''}`;
}

export async function search(p, text, ignoreCase = true) {
  const root = forRead(p);
  const needle = ignoreCase ? text.toLowerCase() : text;
  const hits = [];
  let files = 0;
  async function walk(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (hits.length >= 200 || files >= 5000) return;
      const full = path.join(dir, ent.name);
      if (hidden(full) || ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules' && ent.name !== '.git') await walk(full);
      } else if (ent.isFile()) {
        files++;
        const s = await stat(full).catch(() => null);
        if (!s || s.size > 2 * 1024 * 1024) continue;
        const buf = await readFile(full).catch(() => null);
        if (!buf || isBinary(buf)) continue;
        buf.toString('utf8').split('\n').forEach((line, i) => {
          if (hits.length < 200 && (ignoreCase ? line.toLowerCase() : line).includes(needle)) {
            hits.push(`${path.relative(root, full)}:${i + 1}: ${line.slice(0, 300)}`);
          }
        });
      }
    }
  }
  if ((await stat(root)).isDirectory()) await walk(root);
  else throw new Error(`Không phải thư mục: ${p}`);
  return hits.length ? `${hits.join('\n')}${hits.length >= 200 ? '\n… (dừng ở 200 kết quả)' : ''}` : `Không thấy "${text}" (đã xét ${files} file)`;
}

export async function write(p, content, mode) {
  const target = await forWrite(p);
  const exists = existsSync(target);
  if (mode === 'create' && exists) throw new Error(`Đã có file, dùng mode=overwrite hoặc append: ${p}`);
  let backup = null;
  if (exists && mode === 'overwrite') {
    backup = path.join(HISTORY, `${new Date().toISOString().replace(/[:.]/g, '-')}${target}`);
    await mkdir(path.dirname(backup), { recursive: true });
    await copyFile(target, backup);
  }
  if (mode === 'append') await appendFile(target, content);
  else await writeFile(target, content);
  return `Đã ${mode === 'append' ? 'ghi thêm vào' : 'ghi'} ${target} (${Buffer.byteLength(content)} byte)${backup ? `\nBản cũ lưu ở ${backup}` : ''}`;
}

export const digest = (s) => ({ bytes: Buffer.byteLength(s), sha256: createHash('sha256').update(s).digest('hex').slice(0, 16) });
