// Tay cho MỌI ứng dụng trên desktop của chủ — qua CÂY TRỢ NĂNG (AT-SPI), cùng ý với web.js nhưng cho cả máy:
// LibreOffice, hộp thoại in, chọn tệp, Cài đặt, cửa sổ Axle… Không chụp ảnh, không bấm mò toạ độ, và KHÔNG tiêm
// phím/chuột lên màn hình chủ (docs/DESKTOP.md mục 3): chỉ hành động mà ứng dụng tự khai qua trợ năng
// (click / press / activate, đặt chữ vào ô nhập). Phần tử không nhận hành động thì máy nói thẳng.
//
// Chỉ có trong ngữ cảnh của CHỦ (trợ lý chính chạy bằng tài khoản chủ, có bus phiên đăng nhập): agent phụ
// trong hộp cát có màn hình X riêng chưa có bus trợ năng → không đăng ký, để sau.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { z } from 'zod';

const LOI = '/opt/axle/core/desktop/tay.py';
const SO = z.number().int().min(1).max(400).describe('Số thứ tự trong bảng tay_snapshot vừa chụp');

export function coTay() {
  if (!existsSync(LOI)) return false;
  let user = '';
  try { user = userInfo().username; } catch { /* không rõ */ }
  if (user.startsWith('ag-')) return false;                       // hộp cát agent phụ: chưa có bus trợ năng
  return !!process.env.DBUS_SESSION_BUS_ADDRESS || existsSync(`/run/user/${process.getuid()}/bus`);
}

function chay(args, timeout = 40_000) {
  return new Promise((ok, hong) => {
    execFile('/usr/bin/python3', [LOI, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, out, er) => {
        const ra = `${out || ''}${er || ''}`.trim();
        if (err && !ra) return hong(new Error(err.message));
        if (ra.startsWith('✗')) return hong(new Error(ra.slice(1).trim()));
        ok(ra || '(không có gì)');
      });
  });
}

export function registerTay(tool) {
  tool('tay_windows', {
    title: 'List open desktop windows',
    description: 'Windows currently open on the owner desktop (app · title · pid), focused one first. '
      + 'Use the number with tay_snapshot to read a specific window. Windows of Axle web apps (class axle-web-<name>: '
      + 'Zalo, Gmail…) are Chromium pages — read and act on them with web_text / web_snapshot (app: "<name>"), not tay_*.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => chay(['cuaso']));

  tool('tay_snapshot', {
    title: 'Read a desktop window as a numbered element table',
    description: 'Accessibility tree of the focused window (or window N): role, name, current text, state and '
      + 'whether it accepts an action. Act on rows with tay_click / tay_type / tay_read by their number. '
      + 'Re-read after every action — numbers are only valid for the latest snapshot. Big windows: use loc to filter. '
      + 'Page content of Axle web apps (Zalo, Gmail…) is not in this tree — use web_text / web_snapshot for those.',
    inputSchema: { cuaso: z.number().int().min(1).optional().describe('Số cửa sổ từ tay_windows; bỏ trống = cửa sổ đang có tiêu điểm'),
      loc: z.string().max(100).optional().describe('Chỉ hiện phần tử có chữ này'),
      sau: z.number().int().min(1).max(60).optional().describe('Độ sâu cây tối đa (mặc định 30)') },
    annotations: { readOnlyHint: true },
  }, async ({ cuaso, loc, sau }) => chay(['chup', ...(cuaso ? ['--cuaso', String(cuaso)] : []),
    ...(loc ? ['--loc', loc] : []), ...(sau ? ['--sau', String(sau)] : [])]));

  tool('tay_click', {
    title: 'Activate an element by its number',
    description: 'Run the element\'s own accessibility action (click / press / activate / toggle). Verifies the '
      + 'element is still the same role and name as in the snapshot; FAILS LOUDLY otherwise. No pointer events.',
    inputSchema: { so: SO },
    annotations: { readOnlyHint: false },
  }, async ({ so }) => chay(['bam', String(so)]));

  tool('tay_type', {
    title: 'Set the text of an input by its number',
    description: 'Replace the content of a text field (entry, spreadsheet cell, document) and read it back to verify. '
      + 'Only for elements the snapshot shows as ô chữ / ô số / văn bản.',
    inputSchema: { so: SO, chu: z.string().max(4000) },
    annotations: { readOnlyHint: false },
  }, async ({ so, chu }) => chay(['go', String(so), chu]));

  tool('tay_read', {
    title: 'Read the full text or value of an element',
    description: 'Full text of one element from the latest tay_snapshot. For Axle web apps (Zalo, Gmail…) use web_text.',
    inputSchema: { so: SO },
    annotations: { readOnlyHint: true },
  }, async ({ so }) => chay(['doc', String(so)]));

  tool('tay_open', {
    title: 'Open a desktop application',
    description: 'Launch an app by its .desktop id (vn.axleos.Axle, libreoffice-calc, org.gnome.Nautilus, '
      + 'axle-web-zalo…) and wait for its window, then take tay_snapshot.',
    inputSchema: { app: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/) },
    annotations: { readOnlyHint: false },
  }, async ({ app }) => chay(['mo', app], 30_000));
}

export const TAY_TOOLS = ['tay_windows', 'tay_snapshot', 'tay_click', 'tay_type', 'tay_read', 'tay_open'];
