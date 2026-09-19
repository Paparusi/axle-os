// Thử giao thức app: node app/test-proto.mjs
import crypto from 'node:crypto';
import { b64u, canon, commandString, decisionString, edVerify, idOf, newKeys, open, openMsg, p256Verify, qrDecode, qrEncode,
  relayHeaders, relayVerify, requestHash, sas, seal, sealMsg } from './proto.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const who = () => { const k = newKeys(); return { ...k, id: idOf(k.edPub) }; };
const M = who(); const P = who(); const X = who();

ok(open(P.xPriv, P.xPub, seal(P.xPub, 'bí mật')) === 'bí mật', 'hộp: người nhận mở được');
let threw = false; try { open(X.xPriv, X.xPub, seal(P.xPub, 'bí mật')); } catch { threw = true; }
ok(threw, 'hộp: người khác KHÔNG mở được');
const box = seal(P.xPub, 'abc'); const bad = Buffer.from(box, 'base64url'); bad[bad.length - 1] ^= 1;
threw = false; try { open(P.xPriv, P.xPub, b64u(bad)); } catch { threw = true; }
ok(threw, 'hộp: sửa 1 bit → mở thất bại (chống sửa)');

const m1 = openMsg(P, sealMsg(M, P.xPub, { type: 'request', id: 'abc' }), (from) => (from === M.id ? M.edPub : null));
ok(m1?.msg.id === 'abc' && m1.from === M.id, 'tin có chữ ký: mở + kiểm chữ ký máy');
ok(openMsg(P, sealMsg(X, P.xPub, { type: 'request' }), (from) => (from === M.id ? M.edPub : null)) === null, 'tin do kẻ khác ký → bị loại');
ok(openMsg(P, sealMsg(M, P.xPub, { type: 'update', id: 'a', agent: undefined }), (from) => (from === M.id ? M.edPub : null))?.msg.id === 'a',
  'trường undefined trong tin không làm hỏng chữ ký (bên nhận dựng lại từ JSON)');
const forged = seal(P.xPub, JSON.stringify({ from: M.id, msg: { type: 'request', id: 'gia' }, sig: 'AAAA' }));
ok(openMsg(P, forged, () => M.edPub) === null, 'tin mạo danh máy (chữ ký giả) → bị loại');

ok(canon({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }) === '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}', 'JSON chuẩn hoá xếp khoá');
const r = { id: 'r1', action: 'run_command', params: { command: 'ls', cwd: '/w', asRoot: false }, client: 'ssh:cog', nonce: 'n1' };
ok(requestHash(r) !== requestHash({ ...r, params: { ...r.params, command: 'rm -rf /' } }), 'băm việc đổi khi lệnh đổi');

const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const point = b64u(ec.publicKey.export({ format: 'jwk' }) && Buffer.concat([Buffer.from([4]),
  Buffer.from(ec.publicKey.export({ format: 'jwk' }).x, 'base64url'), Buffer.from(ec.publicKey.export({ format: 'jwk' }).y, 'base64url')]));
const spki = b64u(ec.publicKey.export({ format: 'der', type: 'spki' }));
const ds = decisionString(M.id, 'r1', requestHash(r), 'a', 123);
const dsig = b64u(crypto.sign('sha256', Buffer.from(ds), { key: ec.privateKey, dsaEncoding: 'der' }));
ok(p256Verify(point, ds, dsig) && p256Verify(spki, ds, dsig), 'chữ ký P-256: nhận khoá dạng điểm thô (iOS) và SPKI (Android)');
ok(!p256Verify(point, decisionString(M.id, 'r1', requestHash(r), 'l', 123), dsig), 'đổi "a" thành "l" → chữ ký sai');
ok(!p256Verify(point, commandString(M.id, 'stop', 'bot2', 123), dsig), 'chữ ký duyệt không dùng làm lệnh dừng được');

ok(sas(M.xPub, P.xPub, 'code') === sas(M.xPub, P.xPub, 'code') && sas(M.xPub, X.xPub, 'code') !== sas(M.xPub, P.xPub, 'code'),
  'mã đối chiếu: hai bên tính ra như nhau; khoá bị tráo → mã khác');

const h = relayHeaders(P, 'POST', '/v1/send', '{"x":1}');
ok(relayVerify(h, 'POST', '/v1/send', '{"x":1}')?.id === P.id, 'ký lời gọi trạm: đúng');
ok(!relayVerify(h, 'POST', '/v1/send', '{"x":2}'), 'ký lời gọi trạm: sửa nội dung → sai');
ok(!relayVerify({ ...h, 'x-axle-id': X.id }, 'POST', '/v1/send', '{"x":1}'), 'ký lời gọi trạm: mạo danh id khác → sai');
ok(!relayVerify({ ...h, 'x-axle-ts': String(Date.now() - 600_000) }, 'POST', '/v1/send', '{"x":1}'), 'ký lời gọi trạm: quá 5 phút → sai');
ok(qrDecode(qrEncode({ m: M.id, c: 'x' })).m === M.id, 'mã QR: mã hoá / giải mã');
ok(edVerify(M.edPub, 'a', 'bad') === false, 'chữ ký Ed25519 hỏng → false (không văng lỗi)');

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ giao thức app đạt');
