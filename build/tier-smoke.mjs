// Duyệt 4 bậc: "✅ 1 giờ", "✅ Luôn việc này", bậc 3 luôn hỏi, luật gắn theo agent, /luat /quen /tomtat.
//   node build/tier-smoke.mjs <url Telegram giả> <owner> <url cửa trước> <token bot2> <đối số ssh…>
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { StreamableHTTPClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const [mock, owner, front, tokB, ...ssh] = process.argv.slice(2);
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (c) => async (name, args = {}) => {
  try { const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }); return { err: !!r.isError, text: r.content[0].text }; }
  catch (e) { return { err: true, text: e.message }; }
};
const a = new Client({ name: 'tier-smoke', version: '1' });
await a.connect(new StdioClientTransport({ command: 'ssh', args: [...ssh, 'axle', 'mcp'], stderr: 'ignore' }));
const A = wrap(a);
const b = new Client({ name: 'bot2', version: '1' });
await b.connect(new StreamableHTTPClientTransport(new URL(front), { requestInit: { headers: { Authorization: `Bearer ${tokB}` } } }));
const B = wrap(b);

const all = async () => (await (await fetch(`${mock}/_messages`)).json()).messages;
const matching = async (needle) => Object.entries(await all()).filter(([, m]) => m.text.includes(needle));
async function waitNew(needle, known = 0) {
  for (let i = 0; i < 100; i++) {
    const hits = await matching(needle);
    if (hits.length > known) { const [id, m] = hits[hits.length - 1]; return { id, ...m }; }
    await sleep(200);
  }
  return null;
}
const buttons = (m) => (m.reply_markup?.inline_keyboard ?? []).flat().map((x) => x.callback_data.split(':')[2]).join('');
const post = (p, body) => fetch(`${mock}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const press = (id, d) => post('/_press', { message_id: id, decision: d, from_id: Number(owner) });
const say = (text) => post('/_send', { text, from_id: Number(owner) });
async function ask(call, needle, decision) {        // gửi yêu cầu, chờ tin, bấm nút, lấy kết quả
  const known = (await matching(needle)).length;
  const p = call();
  const m = await waitNew(needle, known);
  if (!m) return { m: null, r: await p };
  await press(m.id, decision);
  return { m, r: await p };
}

// 1. "Luôn việc này" → lần sau tự duyệt, không hỏi (ở ~/projects: tách khỏi phiên "1 giờ" ở ~/work bên dưới)
let x = await ask(() => A('run_command', { command: 'echo bac2-a', cwd: '/home/admin_1/projects', waitSec: 60 }), 'echo bac2-a', 'l');
ok(x.m && x.m.text.includes('Bậc 2') && buttons(x.m) === 'ahlr', 'lệnh thường: tin ghi Bậc 2, có 4 nút (Lần này · 1 giờ · Luôn · Từ chối)');
ok(x.r.text.startsWith('✅ Đã duyệt'), 'bấm "Luôn việc này" → chạy');
const ruleId = (await all())[x.m.id].edits.join('\n').match(/luật #(\d+)/)?.[1];
ok(!!ruleId, `tin được sửa thành "luôn việc này (luật #${ruleId})"`);
const before = (await matching('echo bac2-a')).length;
x = { r: await A('run_command', { command: 'echo bac2-a', cwd: '/home/admin_1/projects', waitSec: 30 }) };
ok(x.r.text.startsWith(`✅ Tự duyệt theo luật #${ruleId}`) && x.r.text.includes('bac2-a'), 'lần sau: tự duyệt theo luật, vẫn chạy đúng');
ok((await matching('echo bac2-a')).length === before, 'lần sau KHÔNG gửi tin hỏi nữa');

// 2. Lệnh gài thêm vào sau lệnh đã cho "luôn" → phải hỏi lại
x = await ask(() => A('run_command', { command: 'echo bac2-a && echo them', cwd: '/home/admin_1/projects', waitSec: 60 }), 'echo bac2-a && echo them', 'r');
ok(x.m && x.r.text.startsWith('❌'), 'lệnh gài thêm "&& …" sau lệnh đã cho luôn → vẫn phải hỏi (và bị từ chối)');

// 3. "1 giờ" → cùng thư mục tự duyệt, khác thư mục thì hỏi
x = await ask(() => A('run_command', { command: 'echo bac2-b', waitSec: 60 }), 'echo bac2-b', 'h');
ok(x.r.text.startsWith('✅'), 'bấm "1 giờ" → chạy');
x = { r: await A('run_command', { command: 'echo bac2-c', waitSec: 30 }) };
ok(x.r.text.startsWith('✅ Tự duyệt theo phiên 1 giờ'), 'lệnh KHÁC cùng thư mục trong 1 giờ → tự duyệt theo phiên');
ok((await matching('echo bac2-c')).length === 0, 'không gửi tin hỏi cho lệnh trong phiên');
x = await ask(() => A('run_command', { command: 'echo bac2-c', cwd: '/tmp', waitSec: 60 }), 'Thư mục: /tmp', 'r');
ok(x.m && x.r.text.startsWith('❌'), 'thư mục khác → phiên không áp, phải hỏi');

// 4. Bậc 3: root → chỉ 2 nút, không nhớ được
x = await ask(() => A('run_command', { command: 'id -u', asRoot: true, waitSec: 60 }), 'id -u', 'a');
ok(x.m && x.m.text.includes('Bậc 3') && buttons(x.m) === 'ar', 'lệnh root: Bậc 3, chỉ 2 nút (Lần này · Từ chối)');

// 5. Xoá: 1 file = bậc 2 không có "luôn"; cả thư mục = bậc 3
await A('file_write', { path: '~/work/t1.txt', content: '1', mode: 'overwrite' });
await A('file_write', { path: '~/work/t2.txt', content: '2', mode: 'overwrite' });
await A('file_write', { path: '~/work/dirx/f.txt', content: '3', mode: 'overwrite' });
x = await ask(() => A('file_delete', { path: '~/work/t1.txt', waitSec: 60 }), 'work/t1.txt', 'h');
ok(x.m && buttons(x.m) === 'ahr', 'xoá 1 file: 3 nút (không có "Luôn")');
x = { r: await A('file_delete', { path: '~/work/t2.txt', waitSec: 30 }) };
ok(x.r.text.startsWith('✅ Tự duyệt theo phiên'), 'xoá file khác cùng thư mục trong 1 giờ → tự duyệt');
x = await ask(() => A('file_delete', { path: '~/work/dirx', waitSec: 60 }), 'work/dirx', 'r');
ok(x.m && x.m.text.includes('Bậc 3') && buttons(x.m) === 'ar', 'xoá cả thư mục: Bậc 3, phiên xoá KHÔNG áp');

// 6. Luật gắn theo agent: bot2 chạy đúng lệnh đó vẫn phải hỏi
x = await ask(() => B('run_command', { command: 'echo bac2-a', waitSec: 60 }), 'Agent: http:bot2', 'r');
ok(x.m && x.r.text.startsWith('❌'), 'luật của tier-smoke KHÔNG áp cho bot2');

// 7. /luat, /quen, /tomtat
await say('/luat');
let m = await waitNew('Đang nhớ:');
ok(m && m.text.includes(`#${ruleId} luôn · tier-smoke · lệnh \`echo bac2-a\` ở /home/admin_1/projects`) && m.text.includes('phiên tới'), '/luat liệt kê luật "luôn" + phiên 1 giờ');
await say(`/quen ${ruleId}`);
ok(!!(await waitNew(`Đã quên #${ruleId}`)), `/quen ${ruleId} → bot xác nhận`);
x = await ask(() => A('run_command', { command: 'echo bac2-a', cwd: '/home/admin_1/projects', waitSec: 60 }), 'echo bac2-a', 'r');
ok(x.m && x.r.text.startsWith('❌'), 'quên luật → lệnh đó phải hỏi lại');
await say('/tomtat');
m = await waitNew('📋 Tóm tắt Axle');
const autoN = Number(m?.text.match(/(\d+) tự duyệt/)?.[1] ?? 0);
ok(m && autoN >= 3 && m.text.includes('tier-smoke') && m.text.includes('http:bot2'), `/tomtat: tóm tắt có agent + ${autoN} lần tự duyệt`);

await a.close();
await b.close();
if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ duyệt 4 bậc đạt');
