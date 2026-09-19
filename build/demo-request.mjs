// Tạo một yêu cầu duyệt THẬT trên máy demo (chủ gọi run_command qua cổng MCP) để thử app iPhone.
//   node build/demo-request.mjs "<lệnh>" [--root] <đối số ssh…>     (chờ quyết định tối đa 100 giây rồi in kết quả)
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const [command, ...rest] = process.argv.slice(2);
const asRoot = rest[0] === '--root';
const ssh = asRoot ? rest.slice(1) : rest;
if (!command || !ssh.length) { console.error('node build/demo-request.mjs "<lệnh>" [--root] <đối số ssh…>'); process.exit(2); }
const c = new Client({ name: 'demo', version: '1' });
await c.connect(new StdioClientTransport({ command: 'ssh', args: [...ssh, 'axle', 'mcp'], stderr: 'ignore' }));
const r = await c.callTool({ name: 'run_command', arguments: { command, asRoot, waitSec: 100 } }, undefined, { timeout: 180_000 });
console.log(r.content[0].text);
await c.close();
