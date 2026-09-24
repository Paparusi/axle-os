// Kênh app Axle phía máy (docs/APP-DUYET.md): ghép cặp điện thoại, gửi yêu cầu duyệt tới mọi điện thoại đã ghép,
// nhận quyết định và TỰ KIỂM chữ ký P-256 (khoá trong chip điện thoại) — trạm chuyển tiếp chỉ chở hộp đã mã hoá.
import { existsSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { b64u, commandString, decisionString, hoiString, idOf, newKeys, openBytes, openMsg, p256Verify, qrEncode, relayHeaders, requestHash,
  sas, seal, sealMsg, shellString, sha256, taskString } from '../app/proto.js';
import { writeDurable } from './rules.js';

const DIR = process.env.AXLE_APPROVE_STATE_DIR || '/var/lib/axle-approve';
const CFG = process.env.AXLE_APP_CONFIG || '/etc/axle/app.json';   // { "relay": "https://…" }
const SKEW = 600_000;   // quyết định phải ký trong 10 phút

const readJson = (f, dflt) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } };

export function createAppChannel({ log, hostname, onDecision, onCommand, onHello, onQuery, onTask, onShell, onHoi }) {
  const cfg = () => readJson(CFG, {});
  const keysFile = `${DIR}/app-keys.json`; const devFile = `${DIR}/devices.json`; const stFile = `${DIR}/app-state.json`;
  let me = readJson(keysFile, null);
  if (!me?.edPriv) { me = newKeys(); writeDurable(keysFile, JSON.stringify(me)); }
  me.id = idOf(me.edPub);
  let devices = readJson(devFile, []);
  const saveDevices = () => writeDurable(devFile, JSON.stringify(devices, null, 1));
  let codeOpen = null;               // mã ghép cặp đang mở (chỉ máy + QR biết)
  const pending = new Map();         // pendingId → { device, sas, created }
  let pairWaiters = [];

  async function call(method, p, body, ms = 30_000) {
    const raw = body ? JSON.stringify(body) : '';
    const r = await fetch(cfg().relay + p, { method, body: raw || undefined, signal: AbortSignal.timeout(ms),
      headers: { ...relayHeaders(me, method, p, raw), 'content-type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`trạm ${r.status}: ${j.error || ''}`);
    return j;
  }

  async function startPair() {
    if (!cfg().relay) throw new Error('Chưa đặt trạm chuyển tiếp: sudo axle app setup --relay <url>');
    const code = b64u(crypto.randomBytes(16));
    await call('POST', '/v1/pairing', { codeHash: b64u(sha256(code)), ttlSec: 600 });
    codeOpen = { code, expires: Date.now() + 600_000 };
    return { qr: qrEncode({ r: cfg().relay, m: me.id, e: me.edPub, x: me.xPub, c: code, n: hostname }), expires: codeOpen.expires };
  }
  function waitPair(ms) {
    const ready = [...pending.entries()].find(([, p]) => !p.shown);
    if (ready) { ready[1].shown = true; return Promise.resolve({ pendingId: ready[0], sas: ready[1].sas, name: ready[1].device.name }); }
    return new Promise((resolve) => {
      const t = setTimeout(() => { pairWaiters = pairWaiters.filter((w) => w !== done); resolve(null); }, ms);
      const done = (x) => { clearTimeout(t); resolve(x); };
      pairWaiters.push(done);
    });
  }
  async function confirmPair(pendingId, ok) {
    const p = pending.get(pendingId);
    if (!p) throw new Error('Không có yêu cầu ghép cặp này (quá hạn?)');
    pending.delete(pendingId);
    if (!ok) return null;
    devices = [...devices.filter((d) => d.id !== p.device.id), { ...p.device, pairedAt: new Date().toISOString() }];
    saveDevices();
    await call('POST', '/v1/link', { peer: p.device.id });
    await send(p.device, { type: 'paired', machine: me.id, name: hostname });
    log({ app: 'ghép cặp', device: p.device.name, id: p.device.id });
    return p.device;
  }
  async function removeDevice(id) {
    const d = devices.find((x) => x.id === id);
    if (!d) throw new Error('Không có điện thoại này');
    devices = devices.filter((x) => x.id !== id);
    saveDevices();
    await call('POST', '/v1/link', { peer: id, remove: true }).catch(() => {});
    log({ app: 'gỡ điện thoại', device: d.name, id });
    return d;
  }

  // Chỉ yêu cầu duyệt (push: 'alert') và máy tự báo sự cố (push: 'may') mới làm điện thoại rung; trạm không đọc được hộp
  // nên máy phải đánh dấu
  const coDay = (msg) => (msg.type === 'request' ? { push: 'alert' } : msg.type === 'thong-bao' ? { push: 'may' } : {});
  const send = (d, msg) => call('POST', '/v1/send', { to: d.id, box: sealMsg(me, d.dx, msg), ...coDay(msg) });
  async function broadcast(msg) {
    for (const d of devices) await send(d, msg).catch((e) => log({ warn: `app → ${d.name}: ${e.message}` }));
  }
  const sendTo = (id, msg) => { const d = devices.find((x) => x.id === id); return d ? send(d, msg).catch(() => {}) : null; };

  // Quyết định chỉ có hiệu lực khi: điện thoại đã ghép + chữ ký P-256 đúng + băm khớp ĐÚNG việc đang chờ + ký trong 10 phút
  function verifyDecision(d, msg, r) {
    if (msg.hash !== requestHash(r)) return 'băm việc không khớp';
    if (!Number.isFinite(msg.ts) || Math.abs(Date.now() - msg.ts) > SKEW) return 'chữ ký quá cũ';
    if (!['a', 'h', 'l', 'r'].includes(msg.decision)) return 'quyết định lạ';
    if (!p256Verify(d.ds, decisionString(me.id, msg.id, msg.hash, msg.decision, msg.ts), msg.dsig)) return 'chữ ký sai';
    return null;
  }

  const daLam = new Set();   // (việc|mốc giờ) đã làm, chặn phát lại trong cửa sổ lệch giờ
  function handle(m) {
    const opened = openMsg(me, m.box, (from, msg) => {
      const d = devices.find((x) => x.id === from);
      if (d) return d.de;
      return msg?.type === 'pair' && idOf(msg.de) === from ? msg.de : null;   // lần đầu: khoá phải khớp id người gửi
    });
    if (!opened || opened.from !== m.from) { log({ warn: `app: hộp lạ hoặc sai chữ ký từ ${m.from}` }); return; }
    const { msg } = opened;
    if (msg.type === 'pair') {
      if (!codeOpen || codeOpen.expires < Date.now() || msg.code !== codeOpen.code) { log({ warn: 'app: ghép cặp sai mã / hết hạn' }); return; }
      codeOpen = null;
      const pendingId = b64u(crypto.randomBytes(6));
      const device = { id: m.from, name: String(msg.name || 'điện thoại').slice(0, 40), de: msg.de, dx: msg.dx, ds: msg.ds };
      const item = { device, sas: sas(me.xPub, msg.dx, msg.code), created: Date.now() };
      pending.set(pendingId, item);
      const w = pairWaiters.shift();
      if (w) { item.shown = true; w({ pendingId, sas: item.sas, name: device.name }); }
      return;
    }
    const d = devices.find((x) => x.id === m.from);
    if (!d) return;
    if (msg.type === 'decision') { onDecision(d, msg); return; }
    if (msg.type === 'hello') { onHello?.(d); return; }   // app mở lên: xin danh sách agent
    // App hỏi máy một chuyện gì đó (chỉ ĐỌC, không làm gì đổi máy) → máy trả lời bằng tin 'state'.
    // Không đòi chữ ký duyệt: hộp đã niêm phong bằng khoá ghép cặp, đọc được tức là đúng điện thoại của chủ.
    if (msg.type === 'query') { onQuery?.(d, String(msg.what || '').slice(0, 32), msg); return; }
    // Việc nhanh từ app: phải ký bằng khoá Face ID, và mỗi (việc, mốc giờ) chỉ làm MỘT lần — chống phát lại
    if (msg.type === 'task') {
      const t = String(msg.task || '');
      const khoa = `${t}|${msg.ts}`;
      const ok = Number.isFinite(msg.ts) && Math.abs(Date.now() - msg.ts) <= SKEW && /^[a-z][a-z-]{1,20}$/.test(t)
        && !daLam.has(khoa) && p256Verify(d.ds, taskString(me.id, t, msg.ts), msg.dsig);
      if (!ok) { log({ warn: `app: việc ${t} từ ${d.name} sai chữ ký / lặp lại / quá giờ` }); return; }
      daLam.add(khoa);
      if (daLam.size > 200) daLam.delete(daLam.values().next().value);
      onTask?.(d, t);
      return;
    }
    // Gõ lệnh từ app. Ký cả nội dung lệnh, mỗi mốc giờ chỉ nhận một lần. Bật/tắt là việc của máy (onShell).
    if (msg.type === 'shell') {
      const c = typeof msg.cmd === 'string' ? msg.cmd : '';
      const khoa = `shell|${msg.ts}`;
      const ok = Number.isFinite(msg.ts) && Math.abs(Date.now() - msg.ts) <= SKEW && c && c.length <= 4000
        && !daLam.has(khoa) && p256Verify(d.ds, shellString(me.id, c, msg.ts), msg.dsig);
      if (!ok) { log({ warn: `app: lệnh gõ từ ${d.name} sai chữ ký / lặp lại / quá giờ` }); return; }
      daLam.add(khoa);
      if (daLam.size > 200) daLam.delete(daLam.values().next().value);
      onShell?.(d, c);
      return;
    }
    // Hỏi Axle (chat) từ app: ký băm câu hỏi như gõ lệnh; máy chạy Claude với cầu xin phép (onHoi)
    if (msg.type === 'hoi') {
      const c = typeof msg.cau === 'string' ? msg.cau : '';
      const khoa = `hoi|${msg.ts}`;
      const ok = Number.isFinite(msg.ts) && Math.abs(Date.now() - msg.ts) <= SKEW && c.trim() && c.length <= 2000
        && !daLam.has(khoa) && p256Verify(d.ds, hoiString(me.id, c, msg.ts), msg.dsig);
      if (!ok) { log({ warn: `app: câu hỏi từ ${d.name} sai chữ ký / lặp lại / quá giờ` }); return; }
      daLam.add(khoa);
      if (daLam.size > 200) daLam.delete(daLam.values().next().value);
      const phien = typeof msg.phien === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(msg.phien) ? msg.phien : null;
      // Tệp đính kèm (ảnh, Excel, Word, PDF…): {id trên trạm, tên gốc} — tối đa 6; điện thoại đã niêm phong cho máy,
      // máy lấy một lần rồi trạm xoá. `anh` (bản app cũ) = ảnh không tên.
      const idOk = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{22}$/.test(x);
      const tep = Array.isArray(msg.tep) ? msg.tep.filter((t) => t && idOk(t.id)).map((t, i) => ({ id: t.id, ten: typeof t.ten === 'string' ? t.ten.slice(0, 120) : `tep-${i + 1}` })) : [];
      if (Array.isArray(msg.anh)) for (const [i, id] of msg.anh.entries()) if (idOk(id)) tep.push({ id, ten: `anh-${i + 1}.jpg` });
      onHoi?.(d, { cau: c.trim(), tiep: msg.tiep === true, phien, tep: tep.slice(0, 6) });
      return;
    }
    if (msg.type === 'stop' || msg.type === 'start') {
      const ok = Number.isFinite(msg.ts) && Math.abs(Date.now() - msg.ts) <= SKEW && /^[a-z][a-z0-9-]{1,20}$/.test(msg.agent || '')
        && p256Verify(d.ds, commandString(me.id, msg.type, msg.agent, msg.ts), msg.dsig);
      if (!ok) { log({ warn: `app: lệnh ${msg.type} từ ${d.name} sai chữ ký` }); return; }
      onCommand(d, msg);
    }
  }

  async function loop() {
    let after = readJson(stFile, {}).after ?? 0;
    for (;;) {
      // Chỉ gọi trạm khi đã ghép điện thoại hoặc đang ghép — máy chưa dùng app không làm phiền trạm (Axle Cloud)
      if (!cfg().relay || (!devices.length && !(codeOpen && codeOpen.expires > Date.now()))) { await new Promise((s) => setTimeout(s, 5000)); continue; }
      try {
        const t0 = Date.now();
        const r = await call('GET', `/v1/inbox?after=${after}&wait=20`);
        // Trạm trả rỗng quá nhanh (lẽ ra phải chờ) → nghỉ 2 giây, không quay vòng dồn trạm
        if (!r.msgs?.length && Date.now() - t0 < 1500) await new Promise((s) => setTimeout(s, 2000));
        for (const m of r.msgs ?? []) { after = m.n; try { handle(m); } catch (e) { log({ warn: `app: ${e.message}` }); } }
        if (r.msgs?.length) writeDurable(stFile, JSON.stringify({ after }));
      } catch (e) {
        log({ warn: `app: ${e.message}` });
        await new Promise((s) => setTimeout(s, 3000));
      }
    }
  }
  setInterval(() => { for (const [k, p] of pending) if (Date.now() - p.created > 600_000) pending.delete(k); }, 60_000).unref();

  return {
    start: () => { loop(); },
    enabled: () => !!cfg().relay && devices.length > 0,
    devices: () => devices.map(({ id, name, pairedAt }) => ({ id, name, pairedAt })),
    machineId: () => me.id,
    startPair, waitPair, confirmPair, removeDevice, broadcast, sendTo, verifyDecision,
    // Lấy tệp đính kèm từ trạm (chỉ máy — người nhận — lấy được, một lần) rồi mở hộp ra byte
    layBlob: async (id) => openBytes(me.xPriv, me.xPub, (await call('GET', `/v1/blob/${id}`)).blob),
    // Gửi tệp về một điện thoại đã ghép (xem tệp trên máy từ app, 24/9): niêm phong cho đúng điện thoại đó rồi gửi lên trạm
    // (≤ 16 MB sau mã hoá); trả id để điện thoại lấy (chỉ nó lấy được, một lần). Tệp to từ mạng văn phòng → chờ tới 3 phút.
    guiBlob: async (deviceId, bytes) => {
      const d = devices.find((x) => x.id === deviceId);
      if (!d) throw new Error('điện thoại chưa ghép');
      const r = await call('POST', '/v1/blob', { to: d.id, blob: seal(d.dx, bytes) }, 180_000);
      if (!r?.id) throw new Error('trạm không nhận tệp');
      return r.id;
    },
  };
}
