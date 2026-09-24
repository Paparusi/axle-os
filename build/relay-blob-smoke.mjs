// Thử tệp đính kèm trên trạm (chạy trạm THẬT ở cổng rỗi, không cần mạng): điện thoại gửi hộp ảnh cho máy, chỉ máy lấy
// được và chỉ MỘT lần; kẻ chưa được liên kết không gửi được; quá to / hộp giả bị chặn.   node build/relay-blob-smoke.mjs
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { b64u, idOf, newKeys, openBytes, relayHeaders, seal, sha256 } from '../app/proto.js';

const D = mkdtempSync(path.join(tmpdir(), 'axle-relay-'));
const PORT = 8790 + Math.floor(Math.random() * 100);
const srv = spawn(process.execPath, ['relay/server.js'], { stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, AXLE_RELAY_PORT: String(PORT), AXLE_RELAY_HOST: '127.0.0.1', AXLE_RELAY_STATE: `${D}/state.json` } });
const base = `http://127.0.0.1:${PORT}`;
const mk = () => { const k = newKeys(); k.id = idOf(k.edPub); return k; };
const call = async (me, method, p, body) => {
  const raw = body ? JSON.stringify(body) : '';
  const r = await fetch(base + p, { method, body: raw || undefined, headers: { ...relayHeaders(me, method, p, raw), 'content-type': 'application/json' } });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* chưa lên */ } await new Promise((r) => setTimeout(r, 100)); }
  const may = mk(); const dt = mk(); const ke = mk();
  ok((await call(may, 'POST', '/v1/link', { peer: dt.id })).status === 200, 'máy cho phép điện thoại gửi vào hộp của mình');
  const anh = crypto.randomBytes(300 * 1024);
  const box = seal(may.xPub, anh);
  const up = await call(dt, 'POST', '/v1/blob', { to: may.id, blob: box });
  ok(up.status === 200 && /^[A-Za-z0-9_-]{22}$/.test(up.j.id || ''), `điện thoại gửi ảnh 300KB → id tệp (${up.status})`);
  ok((await call(ke, 'GET', `/v1/blob/${up.j.id}`)).status === 404, 'kẻ khác lấy → 404');
  ok((await call(dt, 'GET', `/v1/blob/${up.j.id}`)).status === 404, 'chính người gửi cũng không lấy lại được (chỉ người nhận)');
  const lay = await call(may, 'GET', `/v1/blob/${up.j.id}`);
  const mo = lay.status === 200 ? openBytes(may.xPriv, may.xPub, lay.j.blob) : null;
  ok(!!mo && mo.length === anh.length && b64u(sha256(mo)) === b64u(sha256(anh)) && lay.j.from === dt.id, 'máy lấy, mở hộp ra đúng từng byte, biết ai gửi');
  ok((await call(may, 'GET', `/v1/blob/${up.j.id}`)).status === 404, 'lấy xong là xoá — lần hai 404');
  ok((await call(ke, 'POST', '/v1/blob', { to: may.id, blob: box })).status === 403, 'kẻ chưa được liên kết gửi → 403');
  ok((await call(dt, 'POST', '/v1/blob', { to: may.id, blob: 'x'.repeat(40) })).status === 400, 'hộp quá ngắn → 400');
  const lon = crypto.randomBytes(6 * 1024 * 1024);
  const upLon = await call(dt, 'POST', '/v1/blob', { to: may.id, blob: seal(may.xPub, lon) });
  ok(upLon.status === 200, `tệp 6MB (PDF scan) đi lọt (${upLon.status})`);
  const layLon = await call(may, 'GET', `/v1/blob/${upLon.j.id}`);
  ok(layLon.status === 200 && b64u(sha256(openBytes(may.xPriv, may.xPub, layLon.j.blob))) === b64u(sha256(lon)), 'máy mở tệp 6MB đúng từng byte');
  const to = await call(dt, 'POST', '/v1/blob', { to: may.id, blob: 'A'.repeat(16 * 1024 * 1024 + 100) });
  ok(to.status === 413, `quá 16MB → 413 (${to.status})`);
  ok((await call(dt, 'POST', '/v1/send', { to: may.id, box: seal(may.xPub, 'x'.repeat(70 * 1024)) })).status === 413, 'hộp thư thường vẫn giới hạn 80KB thân');
  // Chiều ngược (24/9, xem tệp trên máy từ app): máy gửi tệp cho điện thoại đã cho phép máy — tệp 12 MB (giới hạn tep.js) lọt
  ok((await call(dt, 'POST', '/v1/link', { peer: may.id })).status === 200, 'điện thoại cho phép máy gửi vào hộp của mình');
  const tepMay = crypto.randomBytes(12_000_000);
  const upMay = await call(may, 'POST', '/v1/blob', { to: dt.id, blob: seal(dt.xPub, tepMay) });
  ok(upMay.status === 200, `máy gửi tệp 12 MB cho điện thoại (${upMay.status})`);
  const layMay = await call(dt, 'GET', `/v1/blob/${upMay.j.id}`);
  ok(layMay.status === 200 && b64u(sha256(openBytes(dt.xPriv, dt.xPub, layMay.j.blob))) === b64u(sha256(tepMay)), 'điện thoại mở tệp của máy đúng từng byte');
  ok((await call(may, 'GET', `/v1/blob/${upMay.j.id}`)).status === 404, 'máy (người gửi) không lấy lại được tệp đã gửi');
} finally {
  srv.kill(); rmSync(D, { recursive: true, force: true });
}
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ tệp đính kèm trên trạm đạt');
