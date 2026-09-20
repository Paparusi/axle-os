// Thử "agent xin xem màn hình thật của chủ" (docs/DESKTOP.md D3) — chạy TRÊN máy Axle có giao diện.
//   node build/owner-screen-smoke.mjs <url /mcp> <token agent> <url telegram giả> <id chủ>
// Kiểm mấy nhánh QUYẾT ĐỊNH (không cần bấm chuột): chưa có quyền thì xin, chủ duyệt thì ghi quyền có hạn,
// màn hình khoá thì từ chối, rút quyền thì hết xem. Riêng việc bấm "Share" trong hộp thoại GNOME là của
// con người — bài thử chỉ ghi lại chụp được hay không, không coi đó là điều kiện đạt.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const [url, token, tgUrl, ownerId] = process.argv.slice(2);
const agent = process.env.AXLE_TEST_AGENT || 'xem';
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execFileSync('bash', ['-lc', cmd], { encoding: 'utf8' }).trim();
const grants = () => { try { return JSON.parse(readFileSync(`/etc/axle/grants/${agent}.json`, 'utf8')); } catch { return {}; } };

const c = new Client({ name: 'thu-man-hinh-chu', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const call = async (name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }); return { err: !!r.isError, content: r.content }; }
  catch (e) { return { err: true, content: [{ type: 'text', text: e.message }] }; }
};
const text = (r) => r.content.map((x) => x.text ?? '').join(' ');

// 0. Sạch sẽ: rút mọi quyền cũ
sh(`sudo -n axle agent revoke ${agent} man-hinh >/dev/null 2>&1 || true`);
ok(!grants().screen, 'bắt đầu: agent KHÔNG có quyền xem màn hình');

// 1. Chưa có quyền mà đòi chụp → phải thành yêu cầu chờ chủ duyệt, KHÔNG được có ảnh
const xin = await call('owner_screen_shot', { minutes: 5, waitSec: 0 });
ok(!xin.content.some((x) => x.type === 'image'), 'chưa duyệt thì KHÔNG có ảnh nào lọt ra');
ok(/chờ chủ duyệt/.test(text(xin)), `đổi thành yêu cầu chờ chủ: ${text(xin).slice(0, 60)}`);

// 2. Tin nhắn gửi chủ phải nói rõ đây là việc bậc 3
const msgs = JSON.parse(sh(`curl -s -m 3 ${tgUrl}/_messages`)).messages;
const ids = Object.keys(msgs).map(Number).sort((a, b) => a - b);
const last = msgs[String(ids.at(-1))];
ok(/MÀN HÌNH THẬT/.test(last.text) && /Bậc 3/.test(last.text), 'tin nhắn cho chủ ghi rõ việc + bậc 3');

// 3. Chủ bấm duyệt → quyền CÓ HẠN được ghi
sh(`curl -s -m 3 -X POST ${tgUrl}/_press -d '{"message_id": ${ids.at(-1)}, "decision": "a", "from_id": ${ownerId}}'`);
await sleep(4000);
const g = grants().screen;
ok(!!g?.until, `duyệt xong có quyền tới ${g?.until}`);
ok(g && Date.parse(g.until) - Date.now() <= 6 * 60_000, 'quyền có hạn giờ (không phải vĩnh viễn)');

// 4. Màn hình khoá thì không chụp, dù đang có quyền
const bus = `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus`;
const manHinh = (bat) => sh(`${bus} gdbus call --session --dest org.gnome.ScreenSaver `
  + `--object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.SetActive ${bat} >/dev/null 2>&1 || true`);
manHinh('true');
await sleep(4000);
const khoa = await call('owner_screen_shot', { waitSec: 0 });
ok(khoa.err && /khoá/.test(text(khoa)), `màn hình khoá → từ chối: ${text(khoa).slice(0, 60)}`);
manHinh('false');
await sleep(3000);

// 5. Có quyền + màn hình mở: chụp được thì tốt, không thì là do hộp thoại GNOME chờ người bấm
const chup = await call('owner_screen_shot', { waitSec: 0 });
const img = chup.content.find((x) => x.type === 'image');
console.log(img ? `  ✓ chụp được màn hình của chủ (${Buffer.from(img.data, 'base64').length} byte)`
  : `  · chưa chụp (cần người bấm Share trong hộp thoại GNOME): ${text(chup).slice(0, 70)}`);

// 6. Rút quyền → hết xem ngay
sh(`sudo -n axle agent revoke ${agent} man-hinh >/dev/null`);
const sau = await call('owner_screen_shot', { waitSec: 0 });
ok(!sau.content.some((x) => x.type === 'image'), 'rút quyền xong là không xem được nữa');

console.log(fail ? `✗ ${fail} mục hỏng` : '✓ xin xem màn hình của chủ: đạt');
process.exit(fail ? 1 : 0);
