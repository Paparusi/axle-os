// Mô tả NGẮN một yêu cầu duyệt từ action + params — dùng chung cho Sổ (daemon công bố ra ban.json) và xuất
// nhãn (nhan.mjs). Không phải bản đầy đủ A.describe() (cần `who` và có thể gọi ra ngoài); đây chỉ là một dòng.
export function moTaNgan(action, p = {}) {
  switch (action) {
    case 'run_command': return `lệnh \`${p.command ?? '?'}\`${p.asRoot ? ' (root)' : ''}`;
    case 'claude_tool': return `Claude ${p.tool ?? '?'}${p.command ? ` \`${p.command}\`` : p.file ? ` ${p.file}` : ''}`;
    case 'file_delete': return `xoá ${p.path ?? '?'}`;
    case 'service_restart': return `khởi động lại ${p.unit ?? '?'}`;
    case 'snapshot_undo': return `quay về ảnh #${p.number ?? '?'}`;
    case 'login': return `đăng nhập${p.user ? ` ${p.user}` : ''}`;
    case 'screen_grant': return 'xem màn hình của chủ';
    default: return String(action);
  }
}

// Gộp các dòng nhật ký duyệt (approvals.jsonl) theo id → một mục mỗi yêu cầu: lúc xin, ai xin, việc gì,
// tự duyệt hay chủ quyết (chữ a/h/l/r + qua đâu), kết quả cuối. Dùng cho Sổ và cho xuất nhãn.
export function gopNhatKy(dong) {
  const m = new Map();
  for (const l of dong) {
    if (!l) continue;
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (!e.id) continue;
    if ((e.state === 'pending' || e.state === 'auto') && e.params) {
      m.set(e.id, { id: e.id, luc: e.ts, agent: e.client ?? '?', action: e.action, params: e.params,
        viec: moTaNgan(e.action, e.params), tu_duyet: e.state === 'auto' ? (e.by || true) : false,
        quyet_dinh: null, via: null, ket_qua: 'pending', exitCode: null });
      continue;
    }
    const x = m.get(e.id);
    if (!x) continue;
    if (e.decision) { x.quyet_dinh = e.decision; x.via = e.via ?? null; }
    if (e.state && e.state !== 'pending') { x.ket_qua = e.state; if (e.exitCode !== undefined) x.exitCode = e.exitCode; }
  }
  return [...m.values()].sort((a, b) => Date.parse(b.luc) - Date.parse(a.luc));
}

// Tên tệp đính kèm an toàn để ghi vào đĩa: bỏ đường dẫn, dấu tiếng Việt → không dấu (đ→d), chỉ giữ [A-Za-z0-9._-],
// giữ phần mở rộng (chữ thường), ≤60 ký tự. Tên rỗng/hỏng → tep-<i>.
export function tenTepAnToan(ten, i = 1) {
  let t = String(ten ?? '').split(/[\\/]/).pop().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  t = t.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').replace(/-{2,}/g, '-');
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(t);
  let goc = (m?.[1] || '').replace(/[.-]+$/g, '').slice(0, 50).replace(/[.-]+$/g, '');   // không để '-' dính trước đuôi
  const duoi = (m?.[2] || '').toLowerCase();
  if (!goc) goc = `tep-${i}`;
  return goc + duoi;
}

// Bản cho app (`query so`): bỏ `pending` (app đã nhận từng yêu cầu bằng tin `request` rồi) và cắt `so` cho vừa
// hộp chuyển tiếp (≤64KB kể cả phong bì mã hoá — giữ dưới 48KB cho chắc). Cắt một nửa mỗi vòng tới khi vừa.
export function banChoApp(ban, gioiHan = 48000) {
  const { pending, ...rest } = ban;   // eslint-disable-line no-unused-vars
  let so = rest.so ?? [];
  for (;;) {
    const data = { ...rest, so };
    if (Buffer.byteLength(JSON.stringify(data)) <= gioiHan || so.length === 0) return data;
    so = so.slice(0, Math.floor(so.length / 2));
  }
}

// Công cụ MCP của Axle mà Claude xin dùng (web_*, tay_*): dựng một DÒNG LỆNH mô tả đích thật (app, phần tử) để
// (1) tin xin duyệt đọc được: "bấm nút 'Lưu' trong Calc" thay vì {"so":37}; (2) "Luôn việc này" nhớ theo ĐÚNG
// đích đó, không phải theo tên công cụ (nếu không, một lần "luôn" là tự duyệt mọi cú bấm về sau — lỗ 21/9).
// tayBang: nội dung ~/.cache/axle-tay/bang.json của chủ (bảng vừa chụp) để đổi số thứ tự thành phần tử.
// Trả { command, mo } — mo=true khi KHÔNG xác định được đích (bảng cũ/mất) → bậc 3, luôn hỏi, không nhớ.
export function lenhCongCu(tool, input = {}, tayBang = null) {
  const t = String(tool).replace(/^mcp__axle__/, '');
  const s = (v, n = 120) => String(v ?? '').slice(0, n);
  if (!/^(web_|tay_)/.test(t)) return null;
  if (t === 'web_click' || t === 'web_type') return { command: `${t} ${s(input.app, 30)}: ${s(input.vai, 20)} "${s(input.ten)}"`, mo: false };
  if (t === 'web_key') return { command: `web_key ${s(input.app, 30)}: ${s(input.phim, 20)}`, mo: false };
  if (t === 'web_scroll' || t === 'web_snapshot' || t === 'web_text') return { command: `${t} ${s(input.app, 30)}`, mo: false };
  if (t === 'tay_open') return { command: `tay_open ${s(input.app, 80)}`, mo: false };
  if (t === 'tay_click' || t === 'tay_type') {
    const so = Number(input.so);
    const muc = tayBang && tayBang.muc && tayBang.muc[String(so)];
    const cu = !tayBang || !tayBang.luc || Date.now() / 1000 - Number(tayBang.luc) > 600;
    if (!muc || cu) return { command: `${t} #${Number.isFinite(so) ? so : '?'} (không rõ phần tử — bảng cũ hoặc chưa chụp)`, mo: true };
    return { command: `${t} ${s(tayBang.app, 30)} "${s(tayBang.cua_so, 60)}": ${s(muc.vai, 20)} "${s(muc.ten)}"`, mo: false };
  }
  return { command: `${t}`, mo: false };   // tay_windows / tay_snapshot / tay_read: chỉ đọc
}
