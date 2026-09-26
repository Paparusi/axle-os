// Thử Nhóm báo cáo trên bộ duyệt THẬT (approve/daemon.js) với Telegram giả + vault giả, không cần root / mạng:
// nhóm có bot từ trước → giữ tạm + hỏi chủ → chủ bấm Ghi → tin vào ~/Axle/BaoCao; người lạ bấm nút / nhắn riêng → bỏ;
// tin "/agents" trong nhóm (kể cả của chủ) chỉ là dữ liệu; người khác thêm bot (chủ không trong nhóm → tự rời, có chủ → hỏi);
// chủ thêm bot → ghi ngay + nhắc chế độ riêng tư; bot bị xoá → báo; nhóm lên supergroup → đổi id; /baocao; tổng kết tự gửi.
//   node build/nhom-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const T = mkdtempSync(path.join(tmpdir(), 'axle-nhom-smoke-'));
const CHU = 111;
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Telegram giả ----
const updates = [];
let seqUpd = 1; let seqMsg = 500;
const sent = [];       // { method, body }
const members = {};    // chat id → trạng thái của CHỦ trong nhóm đó
let docDuocHet = false;
const tgServer = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', async () => {
    const body = JSON.parse(b || '{}');
    const method = req.url.split('/')[2];
    const tra = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
    if (method === 'getUpdates') {
      for (let i = 0; i < 10; i++) {
        const ra = updates.filter((u) => u.update_id >= (body.offset || 0));
        if (ra.length) return tra(ra);
        await sleep(100);
      }
      return tra([]);
    }
    sent.push({ method, body });
    if (method === 'sendMessage') return tra({ message_id: ++seqMsg });
    if (method === 'getMe') return tra({ id: 999, is_bot: true, can_read_all_group_messages: docDuocHet });
    if (method === 'getChatMemberCount') return tra(7);
    if (method === 'getChatMember') return tra({ status: members[body.chat_id] || 'left', user: { id: body.user_id } });
    return tra(true);   // editMessageText, answerCallbackQuery, leaveChat
  });
});
await new Promise((r) => tgServer.listen(0, '127.0.0.1', r));
const TG = `http://127.0.0.1:${tgServer.address().port}`;
const day = (u) => { updates.push({ update_id: seqUpd++, ...u }); };

// ---- vault giả: thay {{secret.X}} rồi gọi thẳng ----
const VAULT = path.join(T, 'vault.sock');
const vault = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', async () => {
    const p = JSON.parse(b);
    const r = await fetch(p.url.replace(/\{\{secret\.[A-Z_]+\}\}/g, 'TOKEN'), { method: p.method, headers: p.headers, body: p.body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: r.status, body: await r.text() }));
  });
});
await new Promise((r) => vault.listen(VAULT, r));

// ---- bộ duyệt thật ----
const NHA = path.join(T, 'home');
mkdirSync(NHA);
const gioQua = (() => { const d = new Date(Date.now() - 60_000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; })();
writeFileSync(path.join(T, 'approve.json'), JSON.stringify({ owner: CHU, api: TG, digestHour: false, baoCaoGio: gioQua }));
const env = { ...process.env, TZ: 'Asia/Ho_Chi_Minh', AXLE_APPROVE_CONFIG: path.join(T, 'approve.json'), AXLE_APPROVE_SOCKET: path.join(T, 'a.sock'),
  AXLE_VAULT_SOCKET: VAULT, AXLE_APPROVE_LOG: path.join(T, 'approvals.jsonl'), AXLE_APPROVE_AGENT_DIR: path.join(T, 'agents'),
  AXLE_MCP_CLIENTS: path.join(T, 'clients.json'), AXLE_AGENTS_STATE: path.join(T, 'agents-state.json'), AXLE_APPROVE_ADMIN_SOCKET: path.join(T, 'admin.sock'),
  AXLE_APPROVE_STATE: path.join(T, 'state.json'), AXLE_APPROVE_STATE_DIR: path.join(T, 'state'), AXLE_APPROVE_RULES: path.join(T, 'rules.json'),
  AXLE_APP_CONFIG: path.join(T, 'app.json'), AXLE_APP_HOI: path.join(T, 'hoi.json'), AXLE_APP_TERMINAL: path.join(T, 'term.json'),
  AXLE_BAN_FILE: path.join(T, 'ban.json'), AXLE_MAY_BAO_STATE: path.join(T, 'may-bao.json'), AXLE_LICH_DA_CHAY: path.join(T, 'lich-da-chay.json'),
  AXLE_LICH_FILE: path.join(T, 'lich.json'), AXLE_THU_CFG: path.join(T, 'thu.json'), AXLE_THU_DA_LAY: path.join(T, 'thu-da-lay.json'),
  AXLE_GRANTS_DIR: path.join(T, 'grants'), AXLE_BRAIN_DIR: path.join(T, 'brain'), AXLE_NHA_CHU: NHA, AXLE_NHOM_SO: path.join(T, 'nhom.json'),
  AXLE_NHOM_CHO: path.join(T, 'nhom-cho') };
const d = spawn(process.execPath, [path.join(ROOT, 'approve/daemon.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let loiDaemon = '';
d.stderr.on('data', (c) => { loiDaemon += c; });
const nhatKy = () => { try { return readFileSync(env.AXLE_APPROVE_LOG, 'utf8'); } catch { return ''; } };
async function cho(f, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { const x = f(); if (x) return x; await sleep(100); }
  return null;
}
const tinGui = (needle) => sent.find((s) => s.method === 'sendMessage' && String(s.body.text).includes(needle));
const soSo = () => JSON.parse(readFileSync(env.AXLE_NHOM_SO, 'utf8'));
const GOC = path.join(NHA, 'Axle/BaoCao');
const tepNgay = (tm) => { try { return readdirSync(path.join(GOC, tm)).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(path.join(GOC, tm, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l))); } catch { return []; } };

try {
  const G1 = { id: -1001, type: 'supergroup', title: 'Báo cáo HRVN' };
  const now = () => Math.floor(Date.now() / 1000);
  const An = { id: 201, first_name: 'An' }; const Binh = { id: 202, first_name: 'Bình' };
  // 1. Nhóm có bot từ trước: tin đầu → giữ tạm + hỏi chủ; tin thứ hai không hỏi lại
  day({ message: { message_id: 1, chat: G1, date: now(), from: An, text: 'Báo cáo: tuyển 12 CN' } });
  const hoi = await cho(() => tinGui('Ghi lại tin của nhóm này'));
  ok(hoi && hoi.body.chat_id === CHU && hoi.body.text.includes('«Báo cáo HRVN» (7 thành viên)') && hoi.body.text.includes('chế độ riêng tư')
    && hoi.body.reply_markup.inline_keyboard[0][0].callback_data === 'nhom:-1001:ghi', 'nhóm lạ → hỏi RIÊNG chủ, nút Ghi/Rời, nhắc chế độ riêng tư');
  day({ message: { message_id: 2, chat: G1, date: now(), from: Binh, text: '/agents' } });
  day({ message: { message_id: 3, chat: G1, date: now(), from: { id: CHU, first_name: 'Hiếu' }, text: '/agents' } });
  await sleep(1500);
  ok(sent.filter((s) => String(s.body.text || '').includes('Ghi lại tin của nhóm này')).length === 1, 'tin thứ hai, thứ ba → không hỏi lại');
  ok(!tepNgay('bao-cao-hrvn').length && readFileSync(path.join(env.AXLE_NHOM_CHO, '-1001.jsonl'), 'utf8').trim().split('\n').length === 3,
    'chưa bấm Ghi → chưa vào ~/Axle, giữ tạm 3 tin (root)');
  // 2. Người lạ bấm nút → bỏ; chủ bấm Ghi → đổ tin tạm
  day({ callback_query: { id: 'q1', from: { id: 555 }, data: 'nhom:-1001:roi', message: { message_id: 501 } } });
  await cho(() => sent.find((s) => s.method === 'answerCallbackQuery' && s.body.callback_query_id === 'q1'));
  ok(soSo().nhom['-1001'].trang_thai === 'cho' && !sent.some((s) => s.method === 'leaveChat'), 'người lạ bấm Rời → không làm gì');
  day({ callback_query: { id: 'q2', from: { id: CHU }, data: 'nhom:-1001:ghi', message: { message_id: 501 } } });
  const tl = await cho(() => sent.find((s) => s.method === 'answerCallbackQuery' && s.body.callback_query_id === 'q2'));
  ok(tl?.body.text === 'Đã bật ghi' && tepNgay('bao-cao-hrvn').length === 3 && soSo().nhom['-1001'].trang_thai === 'ghi'
    && JSON.parse(readFileSync(path.join(GOC, 'bao-cao-hrvn/nhom.json'), 'utf8')).ten === 'Báo cáo HRVN', 'chủ bấm Ghi → 3 tin vào ~/Axle/BaoCao/bao-cao-hrvn, có nhom.json');
  ok(sent.some((s) => s.method === 'editMessageText' && s.body.text.includes('đã lưu 3 tin giữ tạm')), 'tin hỏi được sửa thành "đang ghi"');
  ok(!sent.some((s) => s.method === 'sendMessage' && s.body.chat_id !== CHU), 'Axle không nói gì trong nhóm');
  ok(!sent.some((s) => s.method === 'sendMessage' && /Agent|agent/.test(s.body.text)), '"/agents" trong nhóm (kể cả của chủ) không chạy lệnh');
  // 3. Tin mới + tin sửa khi đang ghi
  day({ message: { message_id: 4, chat: G1, date: now(), from: Binh, caption: 'bảng công', photo: [{ file_id: 'P', file_unique_id: 'uP', width: 9, height: 9 }] } });
  day({ edited_message: { message_id: 1, chat: G1, date: now() - 60, edit_date: now(), from: An, text: 'Báo cáo: tuyển 14 CN' } });
  await cho(() => tepNgay('bao-cao-hrvn').length === 5);
  const ds = tepNgay('bao-cao-hrvn');
  ok(ds.length === 5 && ds[3].anh?.id === 'P' && ds[4].sua === true && ds[4].noi_dung === 'Báo cáo: tuyển 14 CN', 'đang ghi: ảnh + tin sửa ghi thẳng');
  // 4. /baocao của chủ; người lạ nhắn riêng
  day({ message: { message_id: 90, chat: { id: CHU, type: 'private' }, date: now(), from: { id: CHU }, text: '/baocao' } });
  const bc = await cho(() => tinGui('📋 «Báo cáo HRVN»'));
  ok(bc && bc.body.text.includes('✅ Đã gửi 2: An') && bc.body.text.includes('Bình') && !bc.body.text.includes('Hiếu'), '/baocao: ai đã gửi, không đếm chủ');
  day({ message: { message_id: 91, chat: { id: 555, type: 'private' }, date: now(), from: { id: 555 }, text: '/baocao' } });
  await cho(() => nhatKy().includes('tin nhắn từ người lạ 555'));
  ok(sent.filter((s) => String(s.body.text || '').startsWith('📋')).length === 1 && !sent.some((s) => s.body.chat_id === 555), 'người lạ nhắn riêng → không trả lời');
  // 5. Người khác thêm bot: nhóm không có chủ → tự rời; nhóm có chủ → hỏi chủ
  const G2 = { id: -2002, type: 'group', title: 'Nhóm lạ' };
  day({ my_chat_member: { chat: G2, from: { id: 777, first_name: 'Kẻ' }, date: now(), old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } });
  ok(await cho(() => sent.find((s) => s.method === 'leaveChat' && s.body.chat_id === -2002)) && await cho(() => tinGui('Kẻ vừa thêm bot Axle vào nhóm «Nhóm lạ»')),
    'người khác thêm vào nhóm KHÔNG có chủ → tự rời + báo chủ');
  const G3 = { id: -3003, type: 'supergroup', title: 'Đội kho' };
  members[-3003] = 'member';
  day({ my_chat_member: { chat: G3, from: { id: 778, first_name: 'Quản trị' }, date: now(), old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } });
  ok(await cho(() => tinGui('«Đội kho»')) && soSo().nhom['-3003'].trang_thai === 'cho' && !sent.some((s) => s.method === 'leaveChat' && s.body.chat_id === -3003),
    'người khác thêm vào nhóm CÓ chủ → hỏi chủ, không rời');
  // 6. Chủ tự thêm bot → ghi ngay (bot đã tắt chế độ riêng tư → không nhắc)
  docDuocHet = true;
  const G4 = { id: -4004, type: 'group', title: 'Báo cáo HRVN' };
  day({ my_chat_member: { chat: G4, from: { id: CHU }, date: now(), old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } });
  const vao = await cho(() => tinGui('✅ Bot Axle đã vào nhóm «Báo cáo HRVN»'));
  ok(vao && !vao.body.text.includes('chế độ riêng tư') && soSo().nhom['-4004'].thu_muc === 'bao-cao-hrvn-2', 'chủ thêm bot → ghi ngay, thư mục không trùng (bao-cao-hrvn-2)');
  // 7. Nhóm lên supergroup → đổi id, giữ thư mục
  day({ message: { message_id: 7, chat: G4, date: now(), from: { id: CHU }, migrate_to_chat_id: -1004004 } });
  day({ message: { message_id: 1, chat: { id: -1004004, type: 'supergroup', title: 'Báo cáo HRVN' }, date: now(), from: An, text: 'tin sau khi lên supergroup' } });
  await cho(() => tepNgay('bao-cao-hrvn-2').length === 1);
  ok(!soSo().nhom['-4004'] && soSo().nhom['-1004004']?.thu_muc === 'bao-cao-hrvn-2' && tepNgay('bao-cao-hrvn-2').length === 1, 'lên supergroup → đổi id, ghi tiếp cùng thư mục');
  // 8. Bot bị xoá khỏi nhóm đang ghi → báo chủ, thôi ghi
  day({ my_chat_member: { chat: { id: -1004004, type: 'supergroup', title: 'Báo cáo HRVN' }, from: { id: 202 }, date: now(), old_chat_member: { status: 'member' }, new_chat_member: { status: 'kicked' } } });
  ok(await cho(() => tinGui('không còn trong nhóm')) && soSo().nhom['-1004004'].trang_thai === 'roi', 'bot bị xoá → báo chủ, trạng thái roi');
  // 9. Tổng kết tự gửi khi tới giờ (giờ đặt = 1 phút trước lúc chạy; bộ duyệt xem mỗi phút)
  const tk = await cho(() => sent.find((s) => s.method === 'sendMessage' && String(s.body.text).startsWith('📋') && s !== bc), 75_000);
  ok(tk && tk.body.text.includes('«Báo cáo HRVN»') && soSo().tong_ket, 'tới giờ → tổng kết nhắn riêng chủ, ghi đã gửi hôm nay');
  ok(!/TypeError|ReferenceError/.test(nhatKy() + loiDaemon), 'không lỗi TypeError/ReferenceError trong nhật ký bộ duyệt');
} finally {
  d.kill('SIGTERM');
  tgServer.close(); vault.close();
  if (fail) console.log(`  (thư mục thử giữ lại: ${T})\n${nhatKy().split('\n').filter((l) => /warn|nhom/.test(l)).slice(-15).join('\n')}\n${loiDaemon.slice(-2000)}`);
  else rmSync(T, { recursive: true, force: true });
}
console.log(fail ? `✗ ${fail} lỗi` : '✓ Nhóm báo cáo trên bộ duyệt: mọi phép thử qua');
process.exit(fail ? 1 : 0);
