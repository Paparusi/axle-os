#!/usr/bin/env node
// Duyệt ĐĂNG NHẬP bằng điện thoại (docs/DESKTOP.md, nhịp D5). PAM của màn đăng nhập gọi file này:
//   auth  sufficient  pam_exec.so  quiet /opt/axle/core/login/pam-approve.mjs
//
// Thoát 0  = chủ máy đã chạm duyệt trên điện thoại → PAM cho vào luôn, khỏi gõ mật khẩu.
// Thoát ≠0 = không duyệt, hết giờ, hỏng, hay không đủ điều kiện → PAM chạy tiếp xuống ô mật khẩu NHƯ CŨ.
//
// Vì đặt `sufficient` (không phải `required`) nên file này hỏng kiểu gì cũng KHÔNG khoá được máy.
// Mọi nhánh lỗi phải thoát ≠0 thật nhanh: người đang ngồi trước máy đang chờ bàn phím.
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { hostname } from 'node:os';

const CFG = process.env.AXLE_LOGIN_CFG || '/etc/axle/login-approve.json';
const SOCKET = process.env.AXLE_APPROVE_SOCKET || '/run/axle-approve/approve.sock';
const COUNT = process.env.AXLE_LOGIN_COUNT || '/run/axle-login-approve.json';

const thoat = (ma, vi) => {
  if (vi && process.env.AXLE_LOGIN_DEBUG) console.error(`axle-login: ${vi}`);
  process.exit(ma);
};

// Chốt chặn cuối: kẹt ở đâu cũng phải nhả bàn phím lại cho ô mật khẩu
setTimeout(() => thoat(1, 'quá giờ chung'), 60_000).unref?.();

const doc = (f, mac) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return mac; } };

const c = doc(CFG, {});
if (c.enabled === false) thoat(1, 'đang tắt');
const giay = Math.min(Math.max(Number(c.timeoutSec ?? 25), 5), 50);
const dichVu = c.services ?? ['gdm-password'];
const soLan = Math.max(Number(c.maxPerMinute ?? 3), 1);

// 1. Chỉ nhận đúng loại PAM và đúng màn đăng nhập TẠI MÁY — không mở cho ssh, sudo, hay máy khác gọi vào
if (process.env.PAM_TYPE !== 'auth') thoat(1, `PAM_TYPE=${process.env.PAM_TYPE}`);
if (!dichVu.includes(process.env.PAM_SERVICE || '')) thoat(1, `dịch vụ ${process.env.PAM_SERVICE} không trong danh sách`);
if (process.env.PAM_RHOST) thoat(1, 'gọi từ máy khác');

// 2. Chỉ cho chủ máy. root và các tài khoản agent thì không bao giờ.
const chu = (() => { try { return readFileSync('/etc/axle/owner', 'utf8').trim(); } catch { return ''; } })();
const ai = process.env.PAM_USER || '';
const duocPhep = c.users ?? (chu ? [chu] : []);
if (!ai || !duocPhep.includes(ai)) thoat(1, `tài khoản ${ai} không trong danh sách`);

// 3. Người ngồi trước máy CHƯA chứng minh mình là ai → chặn dội chuông điện thoại
const gio = Date.now();
const moc = (doc(COUNT, {}).moc ?? []).filter((t) => gio - t < 60_000);
if (moc.length >= soLan) thoat(1, `đã hỏi ${moc.length} lần trong 1 phút`);
try { writeFileSync(COUNT, JSON.stringify({ moc: [...moc, gio] }), { mode: 0o600 }); } catch { /* không ghi được vẫn chạy tiếp */ }

// 4. Hỏi bộ duyệt → điện thoại đổ chuông
const goi = (method, duong, than) => new Promise((ok, hong) => {
  const req = request({ socketPath: SOCKET, method, path: duong, headers: than ? { 'content-type': 'application/json' } : {} }, (res) => {
    let s = '';
    res.on('data', (x) => { s += x; });
    res.on('end', () => { try { ok({ code: res.statusCode, body: JSON.parse(s || '{}') }); } catch { hong(new Error('trả lời không phải JSON')); } });
  });
  req.on('error', hong);
  req.setTimeout((giay + 10) * 1000, () => req.destroy(new Error('bộ duyệt không trả lời')));
  req.end(than ? JSON.stringify(than) : undefined);
});

const XONG = new Set(['done', 'failed', 'rejected', 'expired']);
try {
  const tao = await goi('POST', '/request', {
    action: 'login',
    params: { user: ai, tty: process.env.PAM_TTY || '' },
    client: `màn đăng nhập ${hostname()}`,
  });
  if (tao.code !== 200 || !tao.body.id) thoat(1, `bộ duyệt không nhận: ${tao.body.error ?? tao.code}`);

  const het = gio + giay * 1000;
  let tt = tao.body;
  while (!XONG.has(tt.state)) {
    const conLai = Math.ceil((het - Date.now()) / 1000);
    if (conLai <= 0) thoat(1, 'hết giờ chờ duyệt');
    const r = await goi('GET', `/status/${tao.body.id}?wait=${Math.min(conLai, 10)}`);
    if (r.code !== 200) thoat(1, `mất dấu yêu cầu: ${r.code}`);
    tt = r.body;
  }
  thoat(tt.state === 'done' && tt.exitCode === 0 ? 0 : 1, `kết quả ${tt.state}`);
} catch (e) {
  thoat(1, e.message);
}
