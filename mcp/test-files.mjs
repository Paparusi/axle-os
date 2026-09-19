// Thử luật vùng file với một home giả: `npm test`. Không cần máy ảo.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const H = mkdtempSync(path.join(tmpdir(), 'axle-home-'));
for (const d of ['work', '.ssh', 'brain/vault', 'proj', '.config/gh']) mkdirSync(path.join(H, d), { recursive: true });
writeFileSync(path.join(H, '.ssh/authorized_keys'), 'ssh-key-bi-mat');
writeFileSync(path.join(H, 'brain/vault/tokens.env'), 'TOKEN=x');
writeFileSync(path.join(H, '.config/gh/hosts.yml'), 'oauth_token: x');
writeFileSync(path.join(H, 'work/.env'), 'SECRET=1');
writeFileSync(path.join(H, 'proj/notes.txt'), 'hello axle');
symlinkSync(path.join(H, '.ssh'), path.join(H, 'work/link'));
symlinkSync(path.join(H, '.ssh/authorized_keys'), path.join(H, 'proj/innocent.txt'));
process.env.HOME = H;
process.env.AXLE_MCP_CONFIG = '/nonexistent';
const f = await import('./files.js');

let fail = 0;
const t = async (name, fn, shouldPass) => {
  let ok, msg;
  try { await fn(); ok = shouldPass; msg = shouldPass ? '' : 'LẼ RA PHẢI CHẶN'; }
  catch (e) { ok = !shouldPass; msg = e.message.replace(H, '~'); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${msg ? ` → ${msg}` : ''}`);
  if (!ok) fail++;
};
const expect = (cond, what) => { if (!cond) throw new Error(what); };

await t('ghi ~/work/a.txt', () => f.write('~/work/a.txt', 'dong 1\n', 'create'), true);
await t('create lần 2 bị từ chối', () => f.write('~/work/a.txt', 'x', 'create'), false);
await t('overwrite', () => f.write('~/work/a.txt', 'dong moi\n', 'overwrite'), true);
await t('append (đường dẫn tương đối)', () => f.write('work/a.txt', 'them\n', 'append'), true);
await t('đọc lại đúng nội dung', async () => { const r = await f.read('~/work/a.txt'); expect(r.includes('dong moi') && r.includes('them'), r); }, true);
await t('ghi thư mục con mới', () => f.write('~/work/sub/b.md', '# b', 'create'), true);
await t('ghi ngoài vùng ~/x.txt', () => f.write('~/x.txt', 'x', 'create'), false);
await t('ghi /etc/passwd', () => f.write('/etc/passwd', 'x', 'overwrite'), false);
await t('ghi thoát ra bằng ../', () => f.write('~/work/../x.txt', 'x', 'create'), false);
await t('ghi xuyên symlink', () => f.write('~/work/link/x', 'x', 'create'), false);
await t('ghi file .env', () => f.write('~/work/new.env', 'x', 'create'), false);
await t('đọc ~/.ssh', () => f.read('~/.ssh/authorized_keys'), false);
await t('đọc qua symlink thư mục', () => f.read('~/work/link/authorized_keys'), false);
await t('đọc qua symlink tên vô hại', () => f.read('~/proj/innocent.txt'), false);
await t('đọc vault', () => f.read('~/brain/vault/tokens.env'), false);
await t('đọc ~/.config', () => f.read('~/.config/gh/hosts.yml'), false);
await t('đọc .env', () => f.read('~/work/.env'), false);
await t('đọc /etc/shadow', () => f.read('/etc/shadow'), false);
await t('đọc file thường', () => f.read('~/proj/notes.txt'), true);
await t('list ẩn mục bí mật', async () => { const l = await f.list('~', 3); expect(!/\.ssh|vault|\.env|innocent|\.config/.test(l), l); }, true);
await t('search không lộ bí mật', async () => { const s = await f.search('~', 'bi-mat'); expect(!s.includes('ssh-key'), s); }, true);
await t('search thấy file thường', async () => { const s = await f.search('~', 'HELLO'); expect(s.includes('notes.txt'), s); }, true);
await t('digest không chứa nội dung', async () => { const d = f.digest('abc'); expect(d.bytes === 3 && d.sha256 === 'ba7816bf8f01cfea' && !JSON.stringify(d).includes('abc'), JSON.stringify(d)); }, true);

rmSync(H, { recursive: true, force: true });
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ luật vùng file đạt');
