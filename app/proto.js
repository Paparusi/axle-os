// Giao thức app Axle v1 (docs/APP-DUYET.md): khoá, hộp mã hoá đầu cuối, chữ ký. Chỉ dùng node:crypto.
// Dùng chung cho máy Axle (approve/app-channel.js), trạm chuyển tiếp (relay/) và điện thoại giả (build/fake-phone.mjs).
import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url');
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

const PREFIX = {
  ed25519: Buffer.from('302a300506032b6570032100', 'hex'),
  x25519: Buffer.from('302a300506032b656e032100', 'hex'),
  p256: Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
};
const rawOf = (keyObj) => keyObj.export({ format: 'der', type: 'spki' }).subarray(-32);
const pubFrom = (kind, raw) => crypto.createPublicKey({ key: Buffer.concat([PREFIX[kind], raw]), format: 'der', type: 'spki' });

export function newKeys() {
  const ed = crypto.generateKeyPairSync('ed25519');
  const x = crypto.generateKeyPairSync('x25519');
  return {
    edPub: b64u(rawOf(ed.publicKey)), edPriv: ed.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    xPub: b64u(rawOf(x.publicKey)), xPriv: x.privateKey.export({ format: 'pem', type: 'pkcs8' }),
  };
}
export const idOf = (edPubB64) => b64u(sha256(unb64u(edPubB64))).slice(0, 32);

export const edSign = (privPem, data) => b64u(crypto.sign(null, Buffer.from(data), privPem));
export function edVerify(pubB64, data, sigB64) {
  try { return crypto.verify(null, Buffer.from(data), pubFrom('ed25519', unb64u(pubB64)), unb64u(sigB64)); } catch { return false; }
}

// JSON chuẩn hoá (khoá xếp theo thứ tự) — để hai bên băm ra cùng một chuỗi
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// ---- hộp mã hoá: X25519 dùng một lần + HKDF-SHA256 + ChaCha20-Poly1305 ----
function boxKey(shared, ephRaw, recipRaw) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ephRaw, recipRaw]), 'axle-box-v1', 32));
}
export function seal(recipXPubB64, plaintext) {
  const recip = unb64u(recipXPubB64);
  const eph = crypto.generateKeyPairSync('x25519');
  const ephRaw = rawOf(eph.publicKey);
  const key = boxKey(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubFrom('x25519', recip) }), ephRaw, recip);
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
  return b64u(Buffer.concat([ephRaw, nonce, c.getAuthTag(), ct]));
}
export function open(myXPrivPem, myXPubB64, boxB64) {
  const b = unb64u(boxB64);
  if (b.length < 60) throw new Error('hộp quá ngắn');
  const ephRaw = b.subarray(0, 32); const nonce = b.subarray(32, 44); const tag = b.subarray(44, 60); const ct = b.subarray(60);
  const key = boxKey(crypto.diffieHellman({ privateKey: crypto.createPrivateKey(myXPrivPem), publicKey: pubFrom('x25519', ephRaw) }),
    ephRaw, unb64u(myXPubB64));
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Tin có chữ ký người gửi BÊN TRONG hộp: trạm không chèn / sửa được
export function sealMsg(me, recipXPubB64, msg) {
  const m = JSON.parse(JSON.stringify(msg));   // bỏ trường undefined: ký đúng thứ bên nhận dựng lại được
  return seal(recipXPubB64, JSON.stringify({ from: me.id, msg: m, sig: edSign(me.edPriv, `${me.id}|${canon(m)}`) }));
}
// edPubOf(from) → khoá Ed25519 của người gửi (máy: từ QR; điện thoại: lúc ghép cặp). Trả null nếu hộp hỏng / sai chữ ký.
export function openMsg(me, boxB64, edPubOf) {
  let inner;
  try { inner = JSON.parse(open(me.xPriv, me.xPub, boxB64)); } catch { return null; }
  const pub = edPubOf(inner.from, inner.msg);
  if (!pub || !edVerify(pub, `${inner.from}|${canon(inner.msg)}`, inner.sig)) return null;
  return { from: inner.from, msg: inner.msg };
}

// ---- quyết định duyệt: ký bằng khoá P-256 trong chip (vân tay) ----
export const requestHash = (r) => b64u(sha256(canon({ id: r.id, action: r.action, params: r.params, client: r.client, nonce: r.nonce })));
export const decisionString = (machineId, id, hash, decision, ts) => `axle-approve-v1|${machineId}|${id}|${hash}|${decision}|${ts}`;
export const commandString = (machineId, cmd, agent, ts) => `axle-command-v1|${machineId}|${cmd}|${agent}|${ts}`;
// Gõ lệnh từ app (mặc định TẮT — sudo axle app terminal on). Ký BĂM CỦA NỘI DUNG lệnh chứ không chỉ mốc giờ:
// chữ ký chỉ đúng với đúng chuỗi lệnh đó, không tráo được lệnh sẽ chạy.
export const shellString = (machineId, cmd, ts) => `axle-shell-v1|${machineId}|${b64u(sha256(cmd))}|${ts}`;
// Việc nhanh bấm thẳng từ app (khoá máy, chụp ảnh hệ thống, cập nhật, khởi động lại). Điện thoại đã ghép + ký
// bằng khoá trong chip (Face ID) = mức tin cậy T3, nên máy làm luôn, không hỏi lại qua kênh duyệt.
export const taskString = (machineId, task, ts) => `axle-task-v1|${machineId}|${task}|${ts}`;
// Khoá P-256 của điện thoại: điểm thô 65 byte (04‖X‖Y, iOS) hoặc SPKI DER (Android), base64url
export function p256Key(b64) {
  const raw = unb64u(b64);
  return raw.length === 65 && raw[0] === 4 ? pubFrom('p256', raw) : crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
}
export function p256Verify(pubB64, data, sigB64) {
  try { return crypto.verify('sha256', Buffer.from(data), { key: p256Key(pubB64), dsaEncoding: 'der' }, unb64u(sigB64)); } catch { return false; }
}

// Mã đối chiếu 6 số lúc ghép cặp: máy và điện thoại tự tính, chủ thấy khớp mới xác nhận (chống trạm tráo khoá)
export function sas(machineXPub, deviceXPub, code) {
  const h = sha256(Buffer.concat([unb64u(machineXPub), unb64u(deviceXPub), Buffer.from(code)]));
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

// ---- ký lời gọi tới trạm: METHOD ‖ path ‖ ts ‖ sha256(body) ----
export function relayHeaders(me, method, pathWithQuery, body = '') {
  const ts = String(Date.now());
  const sig = edSign(me.edPriv, `${method}\n${pathWithQuery}\n${ts}\n${b64u(sha256(body))}`);
  return { 'x-axle-id': me.id, 'x-axle-pub': me.edPub, 'x-axle-ts': ts, 'x-axle-sig': sig };
}
export function relayVerify(headers, method, pathWithQuery, body = '') {
  const id = headers['x-axle-id']; const pub = headers['x-axle-pub']; const ts = Number(headers['x-axle-ts']); const sig = headers['x-axle-sig'];
  if (!id || !pub || !sig || idOf(pub) !== id) return null;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 300_000) return null;
  return edVerify(pub, `${method}\n${pathWithQuery}\n${ts}\n${b64u(sha256(body))}`, sig) ? { id, sig } : null;
}

export const QR_PREFIX = 'axle1:';
export const qrEncode = (o) => QR_PREFIX + b64u(Buffer.from(JSON.stringify(o)));
export function qrDecode(s) {
  if (!String(s).startsWith(QR_PREFIX)) throw new Error('Không phải mã ghép cặp Axle');
  return JSON.parse(unb64u(s.slice(QR_PREFIX.length)).toString('utf8'));
}
