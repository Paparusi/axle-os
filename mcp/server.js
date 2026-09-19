#!/usr/bin/env node
// Cổng MCP của Axle qua stdio — cho CHỦ MÁY và TRỢ LÝ CHÍNH, chạy bằng quyền của chủ.
//   ssh admin_1@<máy> axle mcp                 chủ máy (khoá SSH của chủ)
//   ssh -i <khoá cog> admin_1@<máy> …          trợ lý chính "cog": authorized_keys ép chạy `axle mcp --as cog`
//                                              (restrict: không shell, không chuyển cổng) → AXLE_AS=cog
// Tên trong nhật ký lấy theo khoá (ssh:cog), không tin tên client tự khai.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { buildServer } from './tools.js';

const AS = process.env.AXLE_AS;
const STATE = process.env.AXLE_AGENTS_STATE || '/etc/axle/agents-state.json';

if (AS) {
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(AS)) { console.error('Tên trợ lý không hợp lệ'); process.exit(2); }
  const suspended = () => {
    try { return (JSON.parse(readFileSync(STATE, 'utf8')).suspended ?? []).includes(AS); } catch { return false; }
  };
  if (suspended()) { console.error(`Trợ lý ${AS} đang bị tạm dừng`); process.exit(3); }
  // Bị /dung giữa chừng → tự thoát (lệnh dừng cũng diệt tiến trình, đây là lớp thứ hai)
  setInterval(() => { if (suspended()) process.exit(3); }, 3000).unref();
  // Ghi phiên đăng nhập → axle cmdlog biết lệnh nào do trợ lý này chạy.
  // File nằm trong vùng MCP không cho ghi, và trợ lý không có shell → không giả mạo được.
  try {
    const ses = readFileSync('/proc/self/sessionid', 'utf8').trim();
    const f = path.join(homedir(), '.local/state/axle/sessions.jsonl');
    mkdirSync(path.dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ses, agent: AS, pid: process.pid }) + '\n');
  } catch { /* không có sessionid (không qua đăng nhập) */ }
}

await buildServer({ clientName: AS ? `ssh:${AS}` : undefined }).connect(new StdioServerTransport());
