#!/usr/bin/env node
// Cửa trước của cổng MCP HTTP. Chạy bằng user axle-gw — không sudo, không Docker, không đọc được home ai.
// Việc duy nhất: kiểm token → chuyển yêu cầu tới máy chủ MCP của ĐÚNG agent đó qua Unix socket
// /run/axle-mcp/<tên>.sock (root:axle-gw 0660 — agent không nối thẳng vào được, phải qua cửa này).
// Tên agent và danh sách công cụ do cửa trước gắn vào; header cùng tên từ bên ngoài bị bỏ.
// Không dùng thư viện ngoài.
import { createServer, request as httpRequest } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const PORT = Number(process.env.AXLE_MCP_HTTP_PORT || 8765);
const HOST = process.env.AXLE_MCP_HTTP_HOST || '127.0.0.1';
const CLIENTS = process.env.AXLE_MCP_CLIENTS || '/etc/axle/mcp-clients.json';
const SOCK_DIR = process.env.AXLE_MCP_SOCK_DIR || '/run/axle-mcp';
const MAX_BODY = 2 * 1024 * 1024;
const PASS_UP = ['content-type', 'accept', 'mcp-protocol-version', 'last-event-id'];
const PASS_DOWN = ['content-type', 'mcp-protocol-version', 'cache-control'];
const AGENT = /^[a-z][a-z0-9-]{1,20}$/;

const sha = (s) => createHash('sha256').update(s).digest();
const STATE = process.env.AXLE_AGENTS_STATE || '/etc/axle/agents-state.json';
const suspendedAgents = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')).suspended ?? []; } catch { return []; } };
// Nhật ký ra stdout → journald (agent không sửa được journal).
const audit = (e) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...e }));

function findClient(auth) {
  const token = /^Bearer\s+(\S+)$/i.exec(auth || '')?.[1];
  if (!token || !existsSync(CLIENTS)) return null;
  const want = sha(token);
  let hit = null;
  for (const [name, c] of Object.entries(JSON.parse(readFileSync(CLIENTS, 'utf8')))) {
    const have = Buffer.from(String(c.hash || ''), 'hex');
    // thời gian hằng, duyệt hết không dừng sớm
    if (have.length === want.length && timingSafeEqual(have, want) && !hit && AGENT.test(name)) hit = { name, tools: c.tools ?? [] };
  }
  return hit;
}

const rpcError = (res, status, message, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

createServer(async (req, res) => {
  try {
    if (new URL(req.url, 'http://x').pathname !== '/mcp') return rpcError(res, 404, 'Không có đường này');
    const client = findClient(req.headers.authorization);
    if (!client) {
      audit({ tool: 'http_auth', ok: false, why: req.headers.authorization ? 'token sai' : 'thiếu token',
        from: req.headers['tailscale-user-login'] || req.socket.remoteAddress });
      return rpcError(res, 401, 'Cần token hợp lệ', { 'www-authenticate': 'Bearer' });
    }
    if (req.method !== 'POST') return rpcError(res, 405, 'Chỉ nhận POST (chế độ không phiên)', { allow: 'POST' });
    if (suspendedAgents().includes(client.name)) {
      audit({ tool: 'http_auth', ok: false, why: 'tạm dừng', client: `http:${client.name}` });
      return rpcError(res, 403, `Agent ${client.name} đang bị tạm dừng`);
    }

    // Quá lớn: trả 413 rồi ĐÓNG socket — bên kia còn đang gửi dở, để nguyên thì kết nối hỏng bị dùng lại.
    const tooBig = () => { rpcError(res, 413, 'Yêu cầu quá lớn', { connection: 'close' }); res.on('finish', () => req.destroy()); };
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return tooBig();
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return tooBig();
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);

    const headers = { 'x-axle-client': client.name, 'x-axle-tools': client.tools.join(','), 'content-length': body.length };
    for (const h of PASS_UP) if (req.headers[h]) headers[h] = req.headers[h];
    const up = httpRequest({ socketPath: `${SOCK_DIR}/${client.name}.sock`, path: '/mcp', method: 'POST', headers }, (ur) => {
      const down = {};
      for (const h of PASS_DOWN) if (ur.headers[h]) down[h] = ur.headers[h];
      res.writeHead(ur.statusCode, down);
      ur.pipe(res);
    });
    up.on('error', (e) => {
      audit({ tool: 'proxy', ok: false, client: `http:${client.name}`, why: e.code || e.message });
      if (!res.headersSent) rpcError(res, 502, `Máy chủ của agent ${client.name} chưa chạy`);
    });
    up.end(body);
  } catch (e) {
    if (!res.headersSent) rpcError(res, 500, `Lỗi cửa trước: ${e.message}`);
  }
}).listen(PORT, HOST, () => console.error(`axle mcp cửa trước nghe ở http://${HOST}:${PORT}/mcp`));
