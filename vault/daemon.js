#!/usr/bin/env node
// Vault của Axle: giữ khoá, gọi HTTP hộ agent, không bao giờ trả giá trị khoá ra ngoài.
// Chạy bằng user hệ thống axle-vault (systemd), nghe trên Unix socket; chỉ nhóm axle-agent nối vào được.
// Không dùng thư viện ngoài — chạy bằng Node của hệ thống (root sở hữu), không dùng Node trong home agent.
import { createServer } from 'node:http';
import { appendFileSync, chmodSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { hostAllowed, prepare, redact } from './lib.js';

const DIR = process.env.AXLE_VAULT_DIR || '/var/lib/axle-vault';
const SOCKET = process.env.AXLE_VAULT_SOCKET || '/run/axle-vault/vault.sock';
const LOG = process.env.AXLE_VAULT_LOG || '/var/log/axle-vault/access.log';
const MAX_BODY = 1024 * 1024;
const DROP_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
const PASS_HEADERS = /^(content-type|location|retry-after|etag|last-modified|link|x-ratelimit-.*|x-request-id)$/i;

// Người gọi: chủ máy (socket chính, nhóm axle-agent) hoặc một agent riêng (socket riêng của agent đó,
// systemd tạo với nhóm ag-<tên> — chỉ user của agent đó mở được). Agent chỉ thấy/dùng khoá có tên nó trong `agents`.
const OWNER = { agent: null };
function secretsFor(who) {
  const all = secrets();
  if (!who.agent) return all;
  return Object.fromEntries(Object.entries(all).filter(([, s]) => (s.agents ?? []).includes(who.agent)));
}

// Đọc lại mỗi lần: `axle vault set/rm` (root) sửa file là có hiệu lực ngay, không cần khởi động lại.
// File hỏng/rỗng (mất điện giữa lúc ghi): dùng bản sao lưu .bak thay vì chết — và la lên trong nhật ký.
function secrets() {
  const f = path.join(DIR, 'secrets.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) {
    log({ error: `secrets.json hỏng (${e.message}), dùng bản sao lưu` });
    try { return JSON.parse(readFileSync(`${f}.bak`, 'utf8')); } catch { return {}; }
  }
}

function log(entry) {
  try { appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* không để nhật ký làm sập vault */ }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2 * MAX_BODY) throw new Error('Yêu cầu quá lớn');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function doRequest(input, who) {
  const S = secretsFor(who);
  const ALL = secrets();              // ẩn MỌI khoá khỏi phản hồi, không chỉ khoá agent được dùng
  const p = prepare(input, S);
  const headers = Object.fromEntries(Object.entries(p.headers).filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())));
  const t0 = Date.now();
  const u = new URL(p.url);
  // Vá đường rò dữ liệu: agent phụ đọc được file + nhận tin lạ mà gọi mạng tự do = đủ "bộ ba chết người"
  if (who.agent) {
    const allowed = [...netGranted(who.agent), ...Object.values(S).flatMap((x) => x.hosts ?? [])];
    if (!hostAllowed(u.hostname, allowed)) {
      throw new Error(`Agent ${who.agent} chưa được gọi tới ${u.hostname} (chủ cấp: sudo axle agent grant ${who.agent} mang ${u.hostname})`);
    }
  }
  const where = { method: p.method, host: u.hostname, path: redact(u.pathname, ALL), used: p.used, ...(who.agent ? { agent: who.agent } : {}) };
  try {
    const res = await fetch(p.url, {
      method: p.method, headers, body: p.body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    const textual = !type || /json|text|xml|javascript|x-www-form-urlencoded/i.test(type);
    const body = textual
      ? redact(buf.subarray(0, MAX_BODY).toString('utf8'), ALL)
      : `[nhị phân ${buf.length} byte, ${type}]`;
    const outHeaders = {};
    res.headers.forEach((v, k) => { if (PASS_HEADERS.test(k)) outHeaders[k] = redact(v, ALL); });
    log({ ...where, status: res.status, ms: Date.now() - t0 });
    return { status: res.status, headers: outHeaders, body, truncated: textual && buf.length > MAX_BODY };
  } catch (e) {
    log({ ...where, error: redact(e.message, ALL), ms: Date.now() - t0 });
    throw new Error(redact(e.message, ALL));
  }
}

// Mạng ra ngoài của agent phụ: /etc/axle/grants/<tên>.json .net (axle agent grant … mang …), còn hạn
const GRANTS_DIR = process.env.AXLE_GRANTS_DIR || '/etc/axle/grants';
function netGranted(agent) {
  try {
    const g = JSON.parse(readFileSync(path.join(GRANTS_DIR, `${agent}.json`), 'utf8'));
    return (g.net ?? []).filter((n) => !n.until || Date.parse(n.until) > Date.now()).map((n) => n.host);
  } catch { return []; }
}

function makeServer(who) {
  return createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === 'GET' && req.url === '/secrets') {
        const S = secretsFor(who);
        return send(200, Object.entries(S).map(([name, s]) => ({ name, hosts: s.hosts ?? [], desc: s.desc ?? '', updated: s.updated ?? '',
          ...(who.agent ? {} : { agents: s.agents ?? [] }) })));
      }
      if (req.method === 'POST' && req.url === '/request') return send(200, await doRequest(await readJson(req), who));
      send(404, { error: 'Không có đường này' });
    } catch (e) {
      let S = {};
      try { S = secrets(); } catch { /* file hỏng */ }
      if (req.url === '/request') log({ refused: redact(e.message, S), ...(who.agent ? { agent: who.agent } : {}) });
      send(400, { error: redact(e.message, S) });
    }
  });
}

// Socket chính (chủ máy + dịch vụ duyệt): vault tự tạo.
if (existsSync(SOCKET)) unlinkSync(SOCKET);
makeServer(OWNER).listen(SOCKET, () => {
  chmodSync(SOCKET, 0o660); // chủ axle-vault + nhóm axle-agent
  console.log(`axle-vault nghe ở ${SOCKET}`);
});

// Socket từng agent: systemd đưa sẵn (axle-vault-agent@<tên>.socket, FileDescriptorName=agent-<tên>).
if (Number(process.env.LISTEN_PID) === process.pid) {
  const names = (process.env.LISTEN_FDNAMES || '').split(':');
  for (let i = 0; i < Number(process.env.LISTEN_FDS || 0); i++) {
    const m = /^agent-([a-z][a-z0-9-]{1,20})$/.exec(names[i] || '');
    if (!m) continue;
    makeServer({ agent: m[1] }).listen({ fd: 3 + i });
    console.log(`axle-vault nghe cho agent ${m[1]}`);
  }
}
