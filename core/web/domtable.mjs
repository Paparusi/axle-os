#!/usr/bin/env node
// Đọc một trang web thành BẢNG PHẦN TỬ ĐÁNH SỐ, và thao tác theo số đó.
//
//   node domtable.mjs <url|attach> chup            — in bảng phần tử
//   node domtable.mjs … bam <số>                   — bấm phần tử số mấy
//   node domtable.mjs … go <số> "chữ"              — gõ chữ vào ô số mấy
//   node domtable.mjs … chon <số> "giá trị"        — chọn trong danh sách
//   node domtable.mjs … phim Enter                 — gõ phím (Enter/Tab/Escape/mũi tên)
//   node domtable.mjs … cuon len|xuong             — cuộn
//   node domtable.mjs … chu                        — chữ đang hiện trên trang
//
// Vì sao làm thế này (học từ browser-use/jev-ultrafast, MIT, 9/2026 — xem memory
// reference-jev-element-table): agent "nhìn ảnh rồi đoán chỗ bấm" vừa chậm vừa sai. Đưa cho nó một bảng
// "1: nút Tìm · 2: ô Mã vận đơn" thì nó chỉ chọn SỐ — không bịa được selector, không cần mô hình thị giác,
// và rẻ hơn hẳn vì không gửi ảnh.
//
// Khác jev ở hai chỗ có chủ ý:
//   * ĐỌC CẢ shadow DOM và iframe cùng nguồn — jev bỏ qua, mà cổng VN cũ hay nằm đúng trong đó.
//   * Không phụ thuộc dịch vụ suy luận đóng nào. Dữ liệu trang KHÔNG rời máy.
//
// Không cần cài gì: dùng chrome-headless-shell có sẵn + WebSocket sẵn trong Node 22.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = process.env.AXLE_CHROME || [
  '/home/admin_1/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
  '/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
const PORT = Number(process.env.AXLE_CDP_PORT || 9333);

// ---------------------------------------------------------------- CDP tối giản
async function noiCDP() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((x) => x.json()).catch(() => null);
  const trang = r?.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!trang) throw new Error(`Không thấy trang nào ở cổng ${PORT} — mở trình duyệt với --remote-debugging-port=${PORT}`);
  const ws = new WebSocket(trang.webSocketDebuggerUrl);
  await new Promise((ok, hong) => { ws.onopen = ok; ws.onerror = () => hong(new Error('không nối được CDP')); });
  let id = 0;
  const chocho = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && chocho.has(m.id)) {
      const { ok, hong } = chocho.get(m.id); chocho.delete(m.id);
      m.error ? hong(new Error(m.error.message)) : ok(m.result);
    }
  };
  const goi = (method, params = {}) => new Promise((ok, hong) => {
    const n = ++id; chocho.set(n, { ok, hong });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (chocho.delete(n)) hong(new Error(`${method} quá giờ`)); }, 30_000);
  });
  return { goi, dong: () => ws.close() };
}

async function moTrinhDuyet(url) {
  if (!CHROME) throw new Error('Không thấy Chromium/chrome-headless-shell trên máy');
  const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,1000', `--remote-debugging-port=${PORT}`, '--lang=vi-VN', url || 'about:blank'],
  { stdio: 'ignore', detached: true });
  p.unref();
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true).catch(() => false);
    if (ok) return p;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('trình duyệt không mở được');
}

// ------------------------------------------------------- Mã chạy TRONG trang
// Trả về bảng phần tử + lưu chính các phần tử đó vào window để thao tác theo số.
const JS_CHUP = `(() => {
  const ra = [];
  const els = [];
  const TEN_THE = { a: 'liên kết', button: 'nút', input: 'ô', textarea: 'ô nhiều dòng', select: 'danh sách' };
  const VAI = new Set(['button','link','checkbox','radio','tab','menuitem','switch','textbox','combobox','option','searchbox']);

  const hien = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return null;
    return r;
  };
  const cat = (s, n = 90) => { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const ten = (e) => cat(
    e.getAttribute('aria-label')
    || (e.getAttribute('aria-labelledby') && (e.getRootNode().getElementById?.(e.getAttribute('aria-labelledby'))?.innerText))
    || (e.labels && e.labels[0] && e.labels[0].innerText)
    || e.placeholder || e.title || e.alt || e.value || e.innerText || e.name || '');

  const dangQuanTam = (e) => {
    const t = e.tagName.toLowerCase();
    if (['a','button','select','textarea'].includes(t)) return true;
    if (t === 'input') return !['hidden'].includes((e.type || '').toLowerCase());
    if (VAI.has((e.getAttribute('role') || '').toLowerCase())) return true;
    if (e.hasAttribute('onclick') || e.hasAttribute('contenteditable')) return true;
    if (e.tabIndex >= 0 && t !== 'body') return true;
    return false;
  };

  // Đi cả shadow DOM và iframe CÙNG NGUỒN — jev bỏ qua hai chỗ này, mà cổng cũ hay nằm đúng đó
  const di = (goc, trong = '') => {
    let ds;
    try { ds = goc.querySelectorAll('*'); } catch { return; }
    for (const e of ds) {
      if (e.shadowRoot) di(e.shadowRoot, trong + '↳shadow ');
      if (e.tagName === 'IFRAME') {
        try { if (e.contentDocument) di(e.contentDocument, trong + '↳khung '); } catch { /* khác nguồn, bỏ */ }
      }
      if (!dangQuanTam(e)) continue;
      const r = hien(e);
      if (!r) continue;
      const i = els.length;
      els.push(e);
      const t = e.tagName.toLowerCase();
      const loai = TEN_THE[t] || (e.getAttribute('role') || t);
      const trangThai = [];
      if (e.disabled) trangThai.push('mờ');
      if (e.checked) trangThai.push('đã chọn');
      if (t === 'input' && e.type) trangThai.push(e.type);
      if (e.value && t !== 'button') trangThai.push('đang là: ' + cat(e.value, 40));
      ra.push({ so: i, loai: trong + loai, ten: ten(e), ...(trangThai.length ? { trang_thai: trangThai.join(', ') } : {}),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        ngoai_man: r.top < 0 || r.bottom > innerHeight ? true : undefined });
    }
  };
  di(document);
  window.__axleEls = els;
  return JSON.stringify({ tieu_de: document.title, dia_chi: location.href, so_phan_tu: ra.length, phan_tu: ra });
})()`;

// ----------------------------------------------------------------- thao tác
async function danhGia(cdp, bieu_thuc) {
  const r = await cdp.goi('Runtime.evaluate', { expression: bieu_thuc, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'lỗi trong trang');
  return r.result.value;
}

const JS_THEO_SO = (so, than) => `(() => {
  const e = (window.__axleEls || [])[${so}];
  if (!e) return JSON.stringify({ loi: 'chưa có bảng phần tử, hoặc không có số ${so} — chụp lại' });
  ${than}
})()`;

async function main() {
  const [dich, lenh = 'chup', ...doi] = process.argv.slice(2);
  if (!dich) {
    console.error('node domtable.mjs <url|attach> chup|bam|go|chon|cuon|chu [đối số…]');
    process.exit(2);
  }
  if (dich !== 'attach') await moTrinhDuyet(dich);
  const cdp = await noiCDP();
  try {
    if (dich !== 'attach') {
      // LUÔN điều hướng, đừng trông chờ lúc mở trình duyệt: nếu máy đã có sẵn một phiên chạy từ trước thì
      // lệnh spawn không chiếm được cổng, và ta bám nhầm vào trang about:blank của phiên cũ.
      const dangO = await danhGia(cdp, 'location.href').catch(() => '');
      if (dangO !== dich) {
        await cdp.goi('Page.enable').catch(() => {});
        await cdp.goi('Page.navigate', { url: dich });
      }
      // Chờ trang lặng đi thay vì đoán số giây — đoán thì lúc được lúc không
      for (let i = 0; i < 60; i++) {
        const xong = await danhGia(cdp, 'document.readyState === "complete" && location.href !== "about:blank"')
          .catch(() => false);
        if (xong) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const chup = async () => JSON.parse(await danhGia(cdp, JS_CHUP));

    switch (lenh) {
      case 'chup': {
        const b = await chup();
        console.log(`${b.tieu_de}\n${b.dia_chi}\n${b.so_phan_tu} thứ thao tác được:\n`);
        for (const p of b.phan_tu) {
          console.log(`  ${String(p.so).padStart(3)}  ${p.loai.padEnd(14)} ${p.ten}` +
            (p.trang_thai ? `   [${p.trang_thai}]` : '') + (p.ngoai_man ? '  (ngoài màn)' : ''));
        }
        break;
      }
      case 'bam': {
        // KHÔNG chụp lại ở đây. Chụp lại là đánh số lại, số người gọi vừa nhìn thấy có thể trỏ sang phần tử
        // khác → bấm nhầm mà không ai biết. Hợp đồng: số nhìn thấy = số bấm. Bảng cũ mất thì báo lỗi.
        const r = await danhGia(cdp, JS_THEO_SO(doi[0], `
          e.scrollIntoView({ block: 'center' });
          const b = e.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), ten: (e.innerText || e.value || '').trim().slice(0, 60) });`));
        const o = JSON.parse(r);
        if (o.loi) throw new Error(o.loi);
        // Bấm bằng chuột thật qua CDP, không gọi e.click(): trang nào nghe sự kiện chuột mới ăn
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.goi('Input.dispatchMouseEvent', { type, x: o.x, y: o.y, button: 'left', clickCount: 1 });
        }
        console.log(`đã bấm ${doi[0]}: ${o.ten}`);
        break;
      }
      case 'go': {
        const r = await danhGia(cdp, JS_THEO_SO(doi[0], `
          e.scrollIntoView({ block: 'center' }); e.focus();
          if ('value' in e) { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }
          return JSON.stringify({ ok: true });`));
        if (JSON.parse(r).loi) throw new Error(JSON.parse(r).loi);
        await cdp.goi('Input.insertText', { text: doi.slice(1).join(' ') });
        console.log(`đã gõ vào ${doi[0]}`);
        break;
      }
      case 'chon': {
        const r = await danhGia(cdp, JS_THEO_SO(doi[0], `
          e.value = ${JSON.stringify(doi.slice(1).join(' '))};
          e.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({ ok: true, dang_la: e.value });`));
        console.log(r);
        break;
      }
      case 'cuon': {
        const d = doi[0] === 'len' ? -600 : 600;
        await danhGia(cdp, `scrollBy(0, ${d}); 1`);
        console.log(`đã cuộn ${doi[0] === 'len' ? 'lên' : 'xuống'}`);
        break;
      }
      case 'phim': {
        // Nhiều ô tìm kiếm chỉ gửi khi bấm Enter, không có nút nào bấm được
        const ten = (doi[0] || 'Enter');
        const ma = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[ten];
        if (!ma) throw new Error('phím: Enter | Tab | Escape | ArrowDown | ArrowUp');
        for (const type of ['keyDown', 'keyUp']) {
          await cdp.goi('Input.dispatchKeyEvent', { type, key: ten, code: ten, windowsVirtualKeyCode: ma,
            nativeVirtualKeyCode: ma, ...(ten === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
        }
        console.log(`đã bấm phím ${ten}`);
        break;
      }
      case 'chu': {
        const t = await danhGia(cdp, 'document.body.innerText.replace(/\\n{3,}/g, "\\n\\n").slice(0, 6000)');
        console.log(t);
        break;
      }
      default:
        throw new Error(`không hiểu lệnh ${lenh}`);
    }
  } finally {
    cdp.dong();
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
