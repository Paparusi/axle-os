#!/usr/bin/env node
// Máy chủ MCP của MỘT agent — chạy bằng user riêng ag-<tên> (systemd axle-mcp@<tên>, khoá chặt: chỉ thấy home
// của chính nó, không sudo, không mạng ngoài). Nghe trên socket systemd đưa sẵn (/run/axle-mcp/<tên>.sock,
// root:axle-gw 0660) nên CHỈ cửa trước (front.js) nối vào được; tên agent + công cụ được phép do cửa trước gắn.
// Thử tại chỗ: AXLE_MCP_BACKEND_SOCKET=<đường dẫn> thay cho socket systemd.
import { createServer } from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './tools.js';

const NAME = process.env.AXLE_CLIENT;
if (!/^[a-z][a-z0-9-]{1,20}$/.test(NAME || '')) { console.error('Thiếu AXLE_CLIENT'); process.exit(2); }

const server = createServer(async (req, res) => {
  const fail = (status, message) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };
  try {
    // Cửa trước đi nhầm agent → từ chối, không phục vụ thay agent khác
    if (req.headers['x-axle-client'] !== NAME) return fail(403, 'Sai agent');
    const allow = String(req.headers['x-axle-tools'] || '').split(',').filter(Boolean);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400, 'JSON hỏng'); }
    const mcp = buildServer({ allow, clientName: `http:${NAME}` });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) fail(500, `Lỗi máy chủ agent: ${e.message}`);
  }
});

if (process.env.LISTEN_FDS) {
  server.listen({ fd: 3 });          // socket systemd đưa sẵn (axle-mcp@<tên>.socket)
} else {
  const p = process.env.AXLE_MCP_BACKEND_SOCKET;
  if (!p) { console.error('Thiếu socket'); process.exit(2); }
  if (existsSync(p)) unlinkSync(p);
  server.listen(p);
}
