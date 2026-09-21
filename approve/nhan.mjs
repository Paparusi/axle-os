// Xuất NHÃN từ nhật ký duyệt cho lớp phản xạ (docs/DESKTOP.md D9): mỗi yêu cầu chủ đã QUYẾT là một mẫu
// {state, questions, gold} — đúng khuôn laya/typed-decisions, để sau này fine-tune một model tại chỗ học "tay chủ"
// (gom việc thường, cờ đỏ việc lạ) mà không byte nào rời máy. Hôm nay chỉ xuất; chưa có model nào đọc.
//   sudo axle phanxa xuat [--tu 2026-09-01] > nhan.jsonl        (nhật ký là của root)
// Bỏ: việc tự duyệt theo luật/phiên (không phải quyết định mới của chủ), việc hết hạn (chủ không quyết).
import { readFileSync } from 'node:fs';
import { gopNhatKy } from './mota.js';

const LOG = process.env.AXLE_APPROVE_LOG || '/var/log/axle-approve/approvals.jsonl';
const args = process.argv.slice(2);
const tu = args.includes('--tu') ? Date.parse(args[args.indexOf('--tu') + 1] || '') : 0;
if (Number.isNaN(tu)) { console.error('--tu cần ngày dạng YYYY-MM-DD'); process.exit(2); }

const CAU_HOI = {
  quyet_dinh: { type: 'choice', instructions: 'Chủ máy sẽ quyết gì với yêu cầu này của agent?',
    criteria: { cho_phep: 'cho làm (lần này, 1 giờ hay luôn)', tu_choi: 'không cho làm' } },
  nho: { type: 'choice', instructions: 'Nếu cho làm, chủ nhớ quyết định này tới đâu?',
    criteria: { lan_nay: 'chỉ lần này', mot_gio: 'cùng loại việc trong 1 giờ', luon: 'luôn việc này', khong: 'không cho làm' } },
};
const NHO = { a: 'lan_nay', h: 'mot_gio', l: 'luon', r: 'khong' };
const mot = (nhan, cac) => ({ label: nhan, probabilities: Object.fromEntries(cac.map((c) => [c, c === nhan ? 1 : 0])) });

let dong;
try { dong = readFileSync(LOG, 'utf8').split('\n'); } catch (e) { console.error(`Không đọc được ${LOG}: ${e.message}`); process.exit(1); }
let n = 0, bo = 0;
for (const x of gopNhatKy(dong).reverse()) {
  if (tu && Date.parse(x.luc) < tu) continue;
  if (x.tu_duyet || x.ket_qua === 'expired' || x.ket_qua === 'pending') { bo++; continue; }
  const qd = x.quyet_dinh ? (x.quyet_dinh === 'r' ? 'tu_choi' : 'cho_phep')
    : x.ket_qua === 'rejected' ? 'tu_choi' : ['running', 'done', 'failed'].includes(x.ket_qua) ? 'cho_phep' : null;
  if (!qd) { bo++; continue; }
  const t = new Date(x.luc);
  const p = x.params || {};
  const state = { agent: x.agent, action: x.action, viec: x.viec, gio: t.getHours(), thu: t.getDay(),
    ...(p.tool ? { tool: p.tool } : {}), ...(p.command ? { command: p.command } : {}), ...(p.file ? { file: p.file } : {}),
    ...(p.path ? { path: p.path } : {}), ...(p.cwd ? { cwd: p.cwd } : {}), ...(p.unit ? { unit: p.unit } : {}),
    root: !!p.asRoot, nguy: !!p.nguy };
  const questions = { quyet_dinh: CAU_HOI.quyet_dinh };
  const gold = { quyet_dinh: mot(qd, ['cho_phep', 'tu_choi']) };
  if (x.quyet_dinh) { questions.nho = CAU_HOI.nho; gold.nho = mot(NHO[x.quyet_dinh], Object.keys(CAU_HOI.nho.criteria)); }
  process.stdout.write(`${JSON.stringify({ id: x.id, luc: x.luc, state, questions, gold })}\n`);
  n++;
}
console.error(`✓ ${n} mẫu có nhãn (bỏ ${bo}: tự duyệt / hết hạn / chưa quyết)`);
