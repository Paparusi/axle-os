// Điện thoại giả: làm đúng giao thức app Axle (docs/APP-DUYET.md) để thử máy + trạm khi chưa có app thật.
// Khoá P-256 tạo bằng phần mềm (app thật: trong chip bảo mật, mỗi lần ký phải vân tay/Face ID).
import crypto from 'node:crypto';
import { b64u, commandString, decisionString, idOf, newKeys, openMsg, qrDecode, relayHeaders, sas, sealMsg } from '../app/proto.js';

export class Phone {
  constructor(name, relayOverride) {
    Object.assign(this, newKeys());
    this.id = idOf(this.edPub);
    this.name = name;
    this.relayOverride = relayOverride;
    this.chip = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = this.chip.publicKey.export({ format: 'jwk' });
    this.ds = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));   // như iOS
    this.after = 0;
    this.inbox = [];
  }
  async call(method, p, body) {
    const raw = body ? JSON.stringify(body) : '';
    const r = await fetch(this.relay + p, { method, body: raw || undefined, headers: { ...relayHeaders(this, method, p, raw), 'content-type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, json: j };
  }
  async pair(qrText) {
    const q = qrDecode(qrText);
    this.machine = { id: q.m, edPub: q.e, xPub: q.x, name: q.n };
    this.relay = this.relayOverride || q.r;
    this.sas = sas(q.x, this.xPub, q.c);
    const box = sealMsg(this, q.x, { type: 'pair', code: q.c, name: this.name, de: this.edPub, dx: this.xPub, ds: this.ds });
    const r = await this.call('POST', '/v1/pair', { m: q.m, code: q.c, box });
    if (r.status !== 200) throw new Error(`ghép cặp: ${r.status} ${r.json.error}`);
    await this.call('POST', '/v1/link', { peer: q.m });   // cho máy gửi vào hộp thư của điện thoại
    return this.sas;
  }
  // Lấy tin mới (chỉ nhận tin có chữ ký đúng của máy đã ghép)
  async poll(waitSec = 20) {
    const r = await this.call('GET', `/v1/inbox?after=${this.after}&wait=${waitSec}`);
    for (const m of r.json.msgs ?? []) {
      this.after = m.n;
      const o = openMsg(this, m.box, (from) => (from === this.machine.id ? this.machine.edPub : null));
      if (o) this.inbox.push(o.msg); else this.rejected = (this.rejected ?? 0) + 1;
    }
  }
  async next(pred, ms = 30_000) {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      if (Date.now() > end) return null;
      await this.poll(Math.max(1, Math.min(10, Math.round((end - Date.now()) / 1000))));
    }
  }
  sign(str, key = this.chip.privateKey) { return b64u(crypto.sign('sha256', Buffer.from(str), { key, dsaEncoding: 'der' })); }
  decisionMsg(req, d, { hash = req.hash, id = req.id, key, ts = Date.now() } = {}) {
    return { type: 'decision', id, hash, decision: d, ts, dsig: this.sign(decisionString(this.machine.id, id, hash, d, ts), key) };
  }
  sendMsg(msg) { return this.call('POST', '/v1/send', { to: this.machine.id, box: sealMsg(this, this.machine.xPub, msg) }); }
  decide(req, d, opts) { return this.sendMsg(this.decisionMsg(req, d, opts)); }
  hello() { return this.sendMsg({ type: 'hello' }); }
  command(cmd, agent) {
    const ts = Date.now();
    return this.sendMsg({ type: cmd, agent, ts, dsig: this.sign(commandString(this.machine.id, cmd, agent, ts)) });
  }
}
