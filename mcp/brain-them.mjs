// Đưa tệp TRÊN MÁY vào Bộ não (chạy bằng chủ): `axle brain them`, `axle claude --tep`, nút Thêm tài liệu trên Bàn,
// chuột phải "Đưa vào Bộ não Axle" trong Files. Cùng hàm themTep với tệp điện thoại gửi (bộ duyệt) — một khuôn raw/.
// In một dòng JSON: { ds: [{ten, duong, abs, moi, da_co_tu, doi}], loi: [{tep, loi}], loi_dan }.
//   node /opt/axle/mcp/brain-them.mjs [--cau "câu hỏi kèm"] [--] <tệp…>
import { hostname } from 'node:os';
import path from 'node:path';
import { BRAIN, loiDanIngest, themTep } from './brain.js';

const vao = process.argv.slice(2);
let cau = '';
const tep = [];
for (let i = 0; i < vao.length; i++) {
  if (vao[i] === '--cau') cau = vao[++i] ?? '';
  else if (vao[i] === '--') { tep.push(...vao.slice(i + 1)); break; } else tep.push(vao[i]);
}
const ds = [];
const loi = [];
for (const [i, f] of tep.entries()) {
  try {
    ds.push(await themTep(path.resolve(f), { thietBi: hostname(), cau, i: i + 1 }));
  } catch (e) {
    loi.push({ tep: f, loi: e.message });
  }
}
process.stdout.write(`${JSON.stringify({ ds, loi, loi_dan: ds.length ? loiDanIngest(ds, BRAIN) : '' })}\n`);
process.exitCode = ds.length ? 0 : 1;
