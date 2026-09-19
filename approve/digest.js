// Tin tóm tắt (mỗi tối + /tomtat): agent nào làm gì, bao nhiêu việc chủ duyệt / tự duyệt / từ chối,
// mạng ra ngoài qua vault. Một tin gom thay cho nhiều tin lẻ (bậc 1 trong docs/QUYEN-AGENT.md).
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n') : [])
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

function journalAudit(sinceMs) {
  const r = spawnSync('journalctl', ['-u', 'axle-mcp@*', '-o', 'cat', '--no-pager', '--since', `@${Math.floor(sinceMs / 1000)}`], { encoding: 'utf8' });
  return String(r.stdout || '').split('\n').filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function buildDigest({ sinceMs, owner, host, approvalsLog, vaultLog, rules }) {
  const after = (e) => Date.parse(e.ts) >= sinceMs;
  const ap = jsonl(approvalsLog).filter(after);
  const n = (st) => ap.filter((e) => e.state === st).length;
  const auto = n('auto');

  const calls = [...jsonl(`/home/${owner}/.local/state/axle/audit.jsonl`), ...journalAudit(sinceMs)]
    .filter((e) => after(e) && e.tool && e.tool !== 'http_auth');
  const byClient = new Map();
  for (const e of calls) {
    const c = e.client || '?';
    const m = byClient.get(c) ?? new Map();
    m.set(e.tool, (m.get(e.tool) ?? 0) + 1);
    byClient.set(c, m);
  }
  const agentLines = [...byClient].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 8).map(([c, m]) => {
    const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, k]) => `${t} ${k}`).join(', ');
    return `· ${c} — ${sum(m)} lần gọi (${top})`;
  });

  const v = jsonl(vaultLog).filter(after);
  const vOk = v.filter((e) => e.status != null).length;
  const vNo = v.filter((e) => e.refused || e.error).length;

  return [
    `📋 Tóm tắt Axle ${host} (từ ${new Date(sinceMs).toLocaleString('vi-VN', { hour12: false })})`,
    agentLines.length ? `Agent:\n${agentLines.join('\n')}` : 'Agent: không có hoạt động',
    `Duyệt: ${n('running') - auto} chủ duyệt · ${auto} tự duyệt theo luật/phiên · ${n('rejected')} từ chối · ${n('expired')} hết hạn`,
    `Mạng qua vault: ${vOk} lần gọi ra ngoài · ${vNo} bị chặn`,
    `Đang nhớ: ${rules.rules.length} luật "luôn" · ${rules.sessions.length} phiên 1 giờ (xem /luat)`,
  ].join('\n');
}
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
