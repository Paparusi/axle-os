// Công cụ cho agent ĐỌC và THAO TÁC một web app mà nó tự mở trên màn hình riêng — theo BẢNG PHẦN TỬ
// ĐÁNH SỐ thay vì bấm mò theo toạ độ.
//
// Vì sao (xem memory reference-jev-element-table): trước đây agent chỉ có screen_click(x, y) — nhìn ảnh
// rồi đoán chỗ bấm. Sai thì không ai biết, mà mỗi bước phải gửi một tấm ảnh. Giờ agent hỏi "trang này có
// gì", nhận về "1: nút Tìm · 2: ô Mã vận đơn", rồi bấm theo SỐ. Không bịa được selector, không cần mô
// hình thị giác, và không tấm ảnh nào rời máy.
//
// Đường đi: web app do `axle webapp` dựng chạy Chromium với --remote-debugging-port=0 → Chromium tự chọn
// một cổng RỖI và ghi số vào <hồ sơ>/DevToolsActivePort. Không dùng cổng cố định vì CDP KHÔNG có xác
// thực: ai đoán trúng số cổng là chiếm được trình duyệt đó. Số cổng được che bằng THƯ MỤC hồ sơ 0700
// (tệp DevToolsActivePort tự nó là 0644). Đây là rào cản chứ không phải khoá — cổng loopback vẫn không
// xác thực, nên đừng mở web app chứa thứ nhạy cảm trên máy có người lạ dùng chung.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';

const LOI = '/opt/axle/core/web/domtable.mjs';
const HO_SO = (ten) => `${process.env.HOME || ''}/.local/share/axle-web/${ten}`;
const TEN = z.string().regex(/^[a-z][a-z0-9-]{1,20}$/).describe('Tên web app (như trong axle webapp)');

export function coWeb() {
  return existsSync(LOI);
}

function chay(ten, args, timeout = 45_000) {
  const hs = HO_SO(ten);
  if (!existsSync(`${hs}/DevToolsActivePort`)) {
    return Promise.reject(new Error(`App '${ten}' chưa mở. Mở trước bằng screen_open('${ten}') rồi đợi vài giây.`));
  }
  return new Promise((ok, hong) => {
    execFile(process.execPath, [LOI, 'attach', ...args],
      { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, AXLE_CDP_PROFILE: hs } },
      (err, out, er) => {
        const ra = `${out || ''}${er || ''}`.trim();
        if (err && !ra) return hong(new Error(err.message));
        if (ra.startsWith('✗')) return hong(new Error(ra.slice(1).trim()));
        ok(ra);
      });
  });
}

export function registerWeb(tool) {
  tool('web_snapshot', {
    title: 'Read a web app as a numbered element table',
    description: 'List every clickable/typable control of an open Axle web app as a numbered table '
      + '(includes shadow DOM and same-origin iframes). Use the numbers with web_click / web_type. '
      + 'Re-read after every action: the numbers are only valid for the page you just read.',
    inputSchema: { app: TEN },
    annotations: { readOnlyHint: true },
  }, async ({ app }) => chay(app, ['chup']));

  tool('web_click', {
    title: 'Click an element by its number',
    description: 'Click the element with this number from the LAST web_snapshot of this app. '
      + 'Dispatches a real mouse event. Take a new snapshot afterwards — the page may have changed.',
    inputSchema: { app: TEN, so: z.number().int().min(0).describe('Số phần tử trong bảng vừa đọc') },
    annotations: { readOnlyHint: false },
  }, async ({ app, so }) => chay(app, ['bam', String(so)]));

  tool('web_type', {
    title: 'Type text into a field by its number',
    description: 'Clear the field with this number and type text into it. Follow with web_key("Enter") '
      + 'if the form submits on Enter rather than through a button.',
    inputSchema: { app: TEN, so: z.number().int().min(0), chu: z.string().max(2000) },
    annotations: { readOnlyHint: false },
  }, async ({ app, so, chu }) => chay(app, ['go', String(so), chu]));

  tool('web_key', {
    title: 'Press a key',
    description: 'Press Enter, Tab, Escape or an arrow key in the app.',
    inputSchema: { app: TEN, phim: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']) },
    annotations: { readOnlyHint: false },
  }, async ({ app, phim }) => chay(app, ['phim', phim]));

  tool('web_scroll', {
    title: 'Scroll the page',
    inputSchema: { app: TEN, huong: z.enum(['len', 'xuong']) },
    annotations: { readOnlyHint: false },
  }, async ({ app, huong }) => chay(app, ['cuon', huong]));

  tool('web_text', {
    title: 'Read the visible text of the page',
    description: 'Plain visible text, for reading results rather than acting on them.',
    inputSchema: { app: TEN },
    annotations: { readOnlyHint: true },
  }, async ({ app }) => chay(app, ['chu']));
}

export const WEB_TOOLS = ['web_snapshot', 'web_click', 'web_type', 'web_key', 'web_scroll', 'web_text'];
