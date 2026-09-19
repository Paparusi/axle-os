// Kiểm chéo giao thức Node ⇄ Swift (app iOS). Chạy trên CI macOS (.github/workflows/ios.yml):
//   node app/vectors.mjs gen   <vectors.json> <priv.json>              — Node sinh bộ mẫu (máy gửi điện thoại)
//   swift test (ios/AxleCore, AXLE_VECTORS + AXLE_SWIFT_OUT)           — Swift đọc bộ mẫu, ghi thứ nó tạo ra
//   node app/vectors.mjs check <vectors.json> <priv.json> <swift-out.json> — Node đóng vai máy Axle kiểm ngược
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { b64u, canon, commandString, decisionString, edSign, idOf, newKeys, openMsg, p256Verify, qrEncode, relayVerify,
  sas, seal, sealMsg } from './proto.js';

const [cmd, ...args] = process.argv.slice(2);
const mk = () => { const k = newKeys(); k.id = idOf(k.edPub); return k; };
const rawPriv = (pem) => b64u(crypto.createPrivateKey(pem).export({ format: 'der', type: 'pkcs8' }).subarray(-32));

if (cmd === 'gen') {
  const [pubOut, privOut] = args;
  const machine = mk(); const phone = mk(); const evil = mk();
  const text = 'cog xin chạy lệnh:\n`docker compose up -d --build` "trích" \\ tab\t ✓ 😀 𝒜 \u0001 \u007f  ';
  const req = { type: 'request', id: 'a1b2c3d4', hash: 'x'.repeat(43), tier: 2, agent: 'cog', action: 'run_command', text,
    buttons: 'ahlr', expires: 1789824150123 };
  const msgs = [req, { type: 'paired', machine: machine.id, name: 'axle-office' }, { type: 'update', id: 'a1b2c3d4', state: 'done' },
    { type: 'command-result', cmd: 'stop', agent: 'bot2', ok: true, text: 'Đã dừng bot2' }];
  const code = b64u(crypto.randomBytes(16));
  const canonCases = [
    { b: 1, a: [3, 'x', null, true, false, -0, 0.5], c: { z: '', y: 1789824150123, x: {} } },
    { 'é': 1, e: 2, E: 3, _: 4, '𝒜': 5, 'ﬀ': 6, '': 7 },
    { s: text }, [], {}, 'chuỗi', 42, null, true,
  ];
  const vectors = {
    machine: { id: machine.id, edPub: machine.edPub, xPub: machine.xPub },
    phone: { id: phone.id, edPub: phone.edPub, xPub: phone.xPub, edPriv: rawPriv(phone.edPriv), xPriv: rawPriv(phone.xPriv) },
    canon: canonCases.map((c) => ({ json: JSON.stringify(c), canon: canon(c) })),
    boxes: msgs.map((m) => ({ msg: m, box: sealMsg(machine, phone.xPub, m) })),
    // mang id máy nhưng ký bằng khoá kẻ khác
    forged: seal(phone.xPub, JSON.stringify({ from: machine.id, msg: req, sig: edSign(evil.edPriv, `${machine.id}|${canon(req)}`) })),
    sas: { mx: machine.xPub, dx: phone.xPub, code, value: sas(machine.xPub, phone.xPub, code) },
    qr: qrEncode({ r: 'https://relay.axle.test', m: machine.id, e: machine.edPub, x: machine.xPub, c: code, n: 'axle-office' }),
    strings: { decision: decisionString(machine.id, 'a1b2c3d4', 'HASH', 'a', 1789824150123),
      command: commandString(machine.id, 'stop', 'bot2', 1789824150123) },
  };
  writeFileSync(pubOut, JSON.stringify(vectors, null, 1));
  writeFileSync(privOut, JSON.stringify({ machine }));
  console.log(`✓ bộ mẫu: ${vectors.canon.length} JSON chuẩn hoá, ${vectors.boxes.length} hộp máy gửi, 1 hộp giả chữ ký`);
} else if (cmd === 'check') {
  const [vecFile, privFile, outFile] = args;
  const v = JSON.parse(readFileSync(vecFile, 'utf8'));
  const { machine } = JSON.parse(readFileSync(privFile, 'utf8'));
  const out = JSON.parse(readFileSync(outFile, 'utf8'));
  let fail = 0;
  const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

  ok(out.phone.id === v.phone.id && idOf(out.phone.edPub) === out.phone.id, 'Swift dựng đúng id điện thoại từ khoá');
  const opened = out.boxes.map((b) => ({ b, o: openMsg(machine, b.box, (from) => (from === v.phone.id ? v.phone.edPub : null)) }));
  ok(opened.length === 3 && opened.every(({ b, o }) => o && o.from === v.phone.id && canon(o.msg) === canon(b.msg)),
    'máy mở được 3 hộp Swift gửi (ghép cặp / quyết định / dừng), chữ ký Ed25519 đúng');
  const pair = opened[0]?.o?.msg;
  ok(pair?.type === 'pair' && idOf(pair.de) === v.phone.id && pair.code === v.sas.code && pair.ds === out.ds,
    'tin ghép cặp: khoá khớp id người gửi, đúng mã trong QR, kèm khoá P-256');
  const d = opened[1]?.o?.msg;
  ok(!!d && p256Verify(out.ds, decisionString(machine.id, d.id, d.hash, d.decision, d.ts), d.dsig),
    'quyết định ký P-256 (DER, điểm thô 65 byte) — máy kiểm đúng như verifyDecision');
  ok(!!d && Number.isInteger(d.ts) && Math.abs(Date.now() - d.ts) < 600_000, 'ts quyết định là mili-giây hiện tại (số nguyên)');
  ok(!!d && !p256Verify(out.ds, decisionString(machine.id, d.id, d.hash, 'r', d.ts), d.dsig), 'đổi quyết định a → r thì chữ ký hỏng');
  const s = opened[2]?.o?.msg;
  ok(!!s && s.type === 'stop' && p256Verify(out.ds, commandString(machine.id, s.type, s.agent, s.ts), s.dsig),
    'lệnh dừng khẩn cấp ký P-256 — máy kiểm đúng');
  ok(!!relayVerify(out.relay.headers, out.relay.method, out.relay.path, out.relay.body), 'trạm chấp nhận chữ ký lời gọi của Swift');
  ok(!relayVerify(out.relay.headers, out.relay.method, out.relay.path, `${out.relay.body} `), 'sửa thân lời gọi → trạm từ chối');
  ok(out.canon.length === 3 && out.canon.every((c) => canon(JSON.parse(c)) === c),
    'JSON chuẩn hoá Swift = Node (chữ có dấu, xuống dòng, ký tự điều khiển, số)');
  if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
  console.log('✓ Swift ⇄ Node khớp giao thức');
} else {
  console.error('node app/vectors.mjs gen <vectors> <priv> | check <vectors> <priv> <swift-out>');
  process.exit(2);
}
