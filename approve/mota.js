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
