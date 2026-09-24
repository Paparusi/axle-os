// Máy tự báo (24/9): mỗi 5 phút bộ duyệt tự khám mạng, ổ đĩa, dịch vụ hỏng, bản Axle mới — CHỈ khi trạng thái đổi mới
// thành "sự cố" để báo lên điện thoại (trạm đẩy thông báo "Máy có chuyện cần xem") và hiện trên Bàn.
// danhGia() là hàm thuần (trạng thái cũ + số đo → sự cố + trạng thái mới) — approve/test-may-bao.mjs thử mọi tình huống.
// Mất mạng thì không gửi được gì ra ngoài → nhớ lúc bắt đầu, CÓ MẠNG LẠI mới báo "mất từ … tới …, lúc đó: <lý do>".
import { spawn } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';

const PHUT = 60_000;
export const CHU_KY = 5 * PHUT;
// Bỏ qua: dịch vụ "chờ có mạng lúc khởi động" (máy lên lúc chưa có mạng — sự cố mạng đã báo riêng) và lượt tự cập nhật
// của Ubuntu (apt-daily*: bị chính `axle update` dừng giữa chừng hay mất mạng thì "failed", lượt sau tự chạy lại — 24/9
// lần khám đầu trên máy thật báo đúng cái này, chủ máy không có gì để làm với nó)
export const BO_QUA_DV = /(-wait-online|^apt-daily(-upgrade)?)\.service$/;

const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function thoiLuong(phut) {
  if (phut < 60) return `${phut} phút`;
  if (phut < 1440) return `${Math.floor(phut / 60)} giờ${phut % 60 ? ` ${phut % 60} phút` : ''}`;
  return `${Math.floor(phut / 1440)} ngày${Math.floor((phut % 1440) / 60) ? ` ${Math.floor((phut % 1440) / 60)} giờ` : ''}`;
}
export function soSanhBan(a, b) {   // "0.1.160" so với "0.1.154" → >0 nếu a mới hơn
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

/** Bỏ khỏi lịch sử những sự cố "dịch vụ hỏng" mà mọi dịch vụ trong đó nay đã nằm trong danh sách bỏ qua (24/9: lần khám
 *  đầu báo apt-daily bị chính axle update dừng — sửa luật rồi thì dòng đó cũng không nên còn nằm trên Bàn/app). */
export function locSuKien(ds = []) {
  return ds.filter((s) => {
    if (s?.loai !== 'dich_vu') return true;
    const ten = String(s.noi_dung || '').split('. Xem lỗi')[0].split(',').map((x) => x.trim()).filter(Boolean);
    return !(ten.length && ten.every((x) => BO_QUA_DV.test(x)));
  });
}

/** Trạng thái cũ + số đo → { su_kien: [{id, loai, tieu_de, noi_dung, luc}], moi }. Số đo nào null thì giữ nguyên phần đó. */
export function danhGia(cu = {}, dd = {}, now = Date.now()) {
  const moi = { ...cu };
  const su_kien = [];
  const them = (loai, tieu_de, noi_dung) => su_kien.push({ id: `${loai}-${now.toString(36)}-${su_kien.length}`, loai, tieu_de, noi_dung, luc: new Date(now).toISOString() });

  if (dd.mang) {
    const m = dd.mang;
    const c = cu.mang || {};
    // Không ra được ngoài (hỏng hẳn, hoặc tới được Internet mà không tới được trạm) → không gửi được, đợi có lại mới báo
    const hong = m.muc === 'loi' || (m.muc === 'canh_bao' && m.buoc_hong === 'tram');
    if (hong) {
      moi.mang = c.hong ? { ...c } : { hong: true, tu: now, tieu_de: m.tieu_de };
    } else {
      if (c.hong) {
        them('mang', `Máy vừa có mạng lại sau ${thoiLuong(Math.max(1, Math.round((now - c.tu) / PHUT)))}`,
          `Mất từ ${hhmm(c.tu)} tới ${hhmm(now)}. Lúc đó: ${c.tieu_de}.`);
      }
      if (m.muc === 'canh_bao') {        // có Internet nhưng Tailscale có chuyện: để 10 phút cho nó tự lành rồi mới báo
        if (!c.canh_bao) moi.mang = { canh_bao: true, tu: now, da_bao: false };
        else if (!c.da_bao && now - c.tu >= 10 * PHUT) { them('mang', m.tieu_de, m.giai_thich || ''); moi.mang = { ...c, da_bao: true }; }
        else moi.mang = { ...c };
      } else {
        moi.mang = {};
      }
    }
  }

  if (dd.dia) {
    const { dung, con_gb: con } = dd.dia;
    if (dung >= 90 && !cu.dia_bao) {
      them('dia', `Ổ đĩa gần đầy: ${dung}%`, `Còn ${con} GB trống. Dọn bớt, hoặc bảo Axle: "dọn ổ đĩa".`);
      moi.dia_bao = true;
    } else if (dung < 85) {
      moi.dia_bao = false;     // dọn xong thì lần sau đầy lại vẫn báo
    }
  }

  if (Array.isArray(dd.dv_hong)) {
    const hien = dd.dv_hong.filter((x) => !BO_QUA_DV.test(x)).sort();
    const daBiet = new Set(cu.dv || []);
    const moiHong = hien.filter((x) => !daBiet.has(x));
    if (moiHong.length) {
      them('dich_vu', moiHong.length === 1 ? `Dịch vụ hỏng: ${moiHong[0]}` : `${moiHong.length} dịch vụ hỏng`,
        `${moiHong.join(', ')}. Xem lỗi: systemctl status ${moiHong[0]}`);
    }
    moi.dv = hien;               // dịch vụ lành lại thì rời danh sách → hỏng lại vẫn báo
  }

  const b = dd.ban;
  if (b?.moi_nhat && b.dang_chay && soSanhBan(b.moi_nhat, b.dang_chay) > 0 && cu.ban_da_bao !== b.moi_nhat) {
    them('cap_nhat', `Có Axle bản mới ${b.moi_nhat}`, `Máy đang chạy ${b.dang_chay}. Cập nhật: Bàn → Máy → Cập nhật, hoặc sudo axle update.`);
    moi.ban_da_bao = b.moi_nhat;
  }
  return { su_kien, moi };
}

function chayLenh(cmd, args, ms) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { resolve({ code: 127, out: '' }); return; }
    p.stdout.on('data', (d) => { if (out.length < 262144) out += d; });
    const hen = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('error', () => { clearTimeout(hen); resolve({ code: 127, out }); });
    p.on('close', (code) => { clearTimeout(hen); resolve({ code, out }); });
  });
}

/** Đo máy thật (bất đồng bộ, không chặn bộ duyệt). kiemBan: hỏi nơi phát hành xem có bản mới không (vài giờ một lần). */
export async function doDac({ kiemBan = false, kiemMang = process.env.AXLE_KIEM_MANG || '/opt/axle/core/lib/kiem-mang.py' } = {}) {
  const dd = {};
  const r = await chayLenh('python3', [kiemMang, '--json'], 45_000);
  try {
    const j = JSON.parse(r.out.split('\n').find((l) => l.startsWith('{')) || '');
    dd.mang = { muc: j.muc, tieu_de: j.tieu_de, giai_thich: j.giai_thich, buoc_hong: (j.buoc || []).find((x) => x.trang_thai === 'loi')?.id || null };
  } catch { dd.mang = null; }
  try {
    const s = statfsSync('/');
    const dung = s.blocks - s.bfree;
    dd.dia = { dung: Math.round((100 * dung) / (dung + s.bavail)), con_gb: Math.round((s.bavail * s.bsize) / 1e9) };
  } catch { dd.dia = null; }
  const f = await chayLenh('systemctl', ['--failed', '--no-legend', '--plain'], 15_000);
  dd.dv_hong = f.code === 0 ? f.out.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((x) => x && x.includes('.')) : null;
  if (kiemBan) {
    try {
      const src = readFileSync('/etc/axle/release-source', 'utf8').trim().replace(/\/$/, '');
      const dang = readFileSync('/etc/axle/version', 'utf8').trim().split(/\s+/)[0];
      if (/^https:\/\//.test(src)) {
        const res = await fetch(`${src}/latest.json`, { signal: AbortSignal.timeout(15_000) });
        const v = res.ok ? (await res.json()).version : null;
        if (v) dd.ban = { dang_chay: dang, moi_nhat: String(v) };
      }
    } catch { /* không hỏi được thì thôi, lần sau hỏi lại */ }
  }
  return dd;
}
