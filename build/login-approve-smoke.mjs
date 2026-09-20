// Thử phần QUYẾT ĐỊNH của "đăng nhập bằng điện thoại" (core/login/pam-approve.mjs) — không cần máy ảo,
// không cần GNOME: dựng một bộ duyệt giả trên unix socket rồi gọi script y như PAM gọi.
//   node build/login-approve-smoke.mjs
// Điều quan trọng nhất phải chứng minh: MỌI nhánh không-duyệt đều thoát ≠0 (PAM rơi về ô mật khẩu),
// và chỉ đúng một nhánh "chủ bấm duyệt" mới thoát 0.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRIPT = path.join(HERE, '..', 'core', 'login', 'pam-approve.mjs');
const W = mkdtempSync(path.join(tmpdir(), 'axle-login-'));
const SOCK = path.join(W, 'approve.sock');
const CFG = path.join(W, 'cfg.json');
const COUNT = path.join(W, 'count.json');

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

// Bộ duyệt giả: `ketQua` quyết định lần hỏi tới trả gì, `nhan` ghi lại yêu cầu đã nhận
let ketQua = { state: 'done', exitCode: 0 };
let treoMs = 0;
const nhan = [];
const srv = createServer(async (req, res) => {
  const tra = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    nhan.push(JSON.parse(body || '{}'));
    return tra(200, { id: 'a1b2c3d4', state: 'pending', action: 'login' });
  }
  if (treoMs) await new Promise((r) => setTimeout(r, treoMs));
  return tra(200, { id: 'a1b2c3d4', action: 'login', ...ketQua });
});
await new Promise((r) => srv.listen(SOCK, r));

const cfg = (extra = {}) => writeFileSync(CFG, JSON.stringify({ users: ['admin_1'], timeoutSec: 5, ...extra }));
const chay = (env = {}) => new Promise((done) => {
  const p = spawn(process.execPath, [SCRIPT], {
    env: {
      PATH: process.env.PATH,
      AXLE_APPROVE_SOCKET: SOCK,
      AXLE_LOGIN_CFG: CFG,
      AXLE_LOGIN_COUNT: COUNT,
      PAM_TYPE: 'auth',
      PAM_SERVICE: 'gdm-password',
      PAM_USER: 'admin_1',
      PAM_TTY: '/dev/tty1',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const t0 = Date.now();
  p.on('exit', (code) => done({ code, ms: Date.now() - t0 }));
});
const moi = () => { writeFileSync(COUNT, JSON.stringify({ moc: [] })); nhan.length = 0; };

// 1. Chủ bấm duyệt → cho vào, KHÔNG cần mật khẩu
cfg(); moi();
ketQua = { state: 'done', exitCode: 0 };
ok((await chay()).code === 0, 'chủ duyệt trên điện thoại → PAM cho vào thẳng');
ok(nhan[0]?.action === 'login' && nhan[0]?.params?.user === 'admin_1' && nhan[0]?.params?.tty === '/dev/tty1',
  'yêu cầu gửi đi ghi rõ tài khoản và chỗ ngồi');

// 2. Mọi nhánh còn lại PHẢI rơi về ô mật khẩu (thoát ≠0)
for (const [kq, ten] of [[{ state: 'rejected' }, 'chủ bấm từ chối'],
  [{ state: 'expired' }, 'yêu cầu hết hạn'],
  [{ state: 'failed', exitCode: 1 }, 'bộ duyệt báo hỏng'],
  [{ state: 'done', exitCode: 1 }, 'duyệt nhưng chạy không xong']]) {
  moi(); ketQua = kq;
  ok((await chay()).code !== 0, `${ten} → rơi về ô mật khẩu`);
}

// 3. Không ai chạm vào điện thoại: phải tự nhả bàn phím trong khoảng đã hẹn, không treo màn đăng nhập
moi(); ketQua = { state: 'pending' }; treoMs = 0;
const cho = await chay();
ok(cho.code !== 0 && cho.ms < 12_000, `không ai bấm → tự nhả sau ${(cho.ms / 1000).toFixed(1)}s (hẹn 5s)`);
treoMs = 0;

// 4. Chặn dội chuông: người lạ ngồi trước máy không được bấm gọi điện thoại liên tục
moi(); ketQua = { state: 'rejected' };
cfg({ maxPerMinute: 2 });
await chay(); await chay();
const lan3 = await chay();
ok(lan3.code !== 0 && lan3.ms < 1500, 'quá số lần cho phép trong 1 phút → chặn ngay, không gọi điện thoại nữa');
ok(nhan.length === 2, `chỉ 2 yêu cầu lọt tới bộ duyệt (thấy ${nhan.length})`);

// 5. Cổng vào: chỉ màn đăng nhập TẠI MÁY, chỉ chủ máy
cfg();
for (const [env, ten] of [[{ PAM_SERVICE: 'sshd' }, 'gọi từ sshd'],
  [{ PAM_SERVICE: 'sudo' }, 'gọi từ sudo'],
  [{ PAM_RHOST: '10.0.0.9' }, 'gọi từ máy khác'],
  [{ PAM_TYPE: 'account' }, 'không phải bước xác thực'],
  [{ PAM_USER: 'root' }, 'xin đăng nhập root'],
  [{ PAM_USER: 'ag-thu' }, 'xin đăng nhập bằng tài khoản agent']]) {
  moi(); ketQua = { state: 'done', exitCode: 0 };
  const r = await chay(env);
  ok(r.code !== 0 && nhan.length === 0, `${ten} → từ chối ngay, không làm phiền điện thoại`);
}

// 6. Tắt trong cấu hình → coi như không có
moi(); cfg({ enabled: false });
ok((await chay()).code !== 0 && nhan.length === 0, 'tắt trong cấu hình → không hỏi gì cả');

// 7. Bộ duyệt chết → không được treo màn đăng nhập
cfg(); moi();
await new Promise((r) => srv.close(r));
const chet = await chay();
ok(chet.code !== 0 && chet.ms < 5000, `bộ duyệt chết → nhả bàn phím sau ${(chet.ms / 1000).toFixed(1)}s`);

rmSync(W, { recursive: true, force: true });
console.log(fail ? `✗ ${fail} mục hỏng` : '✓ đăng nhập bằng điện thoại: đạt');
process.exit(fail ? 1 : 0);
