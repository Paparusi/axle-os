// Công cụ cho agent ĐỌC và THAO TÁC một web app mà nó tự mở trên màn hình riêng — theo BẢNG PHẦN TỬ
// ĐÁNH SỐ thay vì bấm mò theo toạ độ.
//
// Vì sao: trước đây agent chỉ có screen_click(x, y) — nhìn ảnh rồi đoán chỗ bấm; sai thì không ai biết,
// mà mỗi bước phải gửi một tấm ảnh. Giờ agent hỏi "trang này có gì", nhận về cây trợ năng
// (button "Đăng nhập", combobox "Mã vận đơn"), rồi thao tác theo VAI TRÒ + TÊN. Không bịa được selector,
// không cần mô hình thị giác, không tấm ảnh nào rời máy.
//
// Lõi chạy trên Playwright (playwright-core, bám vào Chromium đang chạy qua CDP — không tải trình duyệt).
// Bản đầu tự viết tay CDP + tự đánh số phần tử; bỏ vì Playwright kiểm "bấm có trúng không" trước khi bấm
// và NÉM LỖI khi trượt, còn bản tự chế thì trượt trong im lặng.
//
// Đường đi: web app do `axle webapp` dựng chạy Chromium với --remote-debugging-port=0 → Chromium tự chọn
// một cổng RỖI và ghi số vào <hồ sơ>/DevToolsActivePort. Không dùng cổng cố định vì CDP KHÔNG có xác
// thực: ai đoán trúng số cổng là chiếm được trình duyệt đó. Số cổng được che bằng THƯ MỤC hồ sơ 0700
// (tệp DevToolsActivePort tự nó là 0644). Đây là rào cản chứ không phải khoá — cổng loopback vẫn không
// xác thực, nên đừng mở web app chứa thứ nhạy cảm trên máy có người lạ dùng chung.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const LOI = '/opt/axle/core/web/domtable.mjs';
// Hồ sơ web app: Chromium bản snap ghi ở ~/snap/<snap>/common/axle-web/<tên> (bị giam, không ghi được thư mục ẩn trong
// nhà); bản .deb ở ~/.local/share/axle-web/<tên> (core/desktop/webapp.sh ho_so). Chỗ nào có DevToolsActivePort (app
// đang mở) thì lấy chỗ đó.
export const HO_SO = (ten) => {
  const nha = process.env.HOME || '';
  const cho = [path.join(nha, 'snap/chromium/common/axle-web', ten), path.join(nha, '.local/share/axle-web', ten)];
  return cho.find((d) => existsSync(path.join(d, 'DevToolsActivePort'))) || cho.find((d) => existsSync(d)) || cho[0];
};
const TEN = z.string().regex(/^[a-z][a-z0-9-]{1,20}$/).describe('Tên web app (như trong axle webapp)');
const VAI_TRO = z.enum(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem',
  'option', 'searchbox', 'switch', 'heading', 'listitem', 'cell'])
  .describe('Vai trò như trong cây trợ năng của web_snapshot');

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
    description: 'Accessibility tree of an open Axle web app: roles, names and current values '
      + '(button "Log in", combobox "Waybill": ABC123). Act on it with web_click / web_type using the '
      + 'role and the name you see here. Re-read after every action.',
    inputSchema: { app: TEN },
    annotations: { readOnlyHint: true },
  }, async ({ app }) => chay(app, ['chup']));

  tool('web_click', {
    title: 'Click an element by its number',
    description: 'Click the visible element with this role and name. Waits for it to be actionable and '
      + 'FAILS LOUDLY if it is not — it never silently misses. If several elements match, the error lists '
      + 'them so you can pick one with "thu".',
    inputSchema: { app: TEN, vai: VAI_TRO, ten: z.string().max(200).describe('Tên hiện trên phần tử'),
      thu: z.number().int().min(0).optional().describe('Chỉ dùng khi máy báo có nhiều thứ trùng tên') },
    annotations: { readOnlyHint: false },
  }, async ({ app, vai, ten, thu }) => chay(app, ['bam', vai, ten, ...(thu === undefined ? [] : ['--thu', String(thu)])]));

  tool('web_type', {
    title: 'Type text into a field by its number',
    description: 'Fill the field with this role and name. Follow with web_key("Enter") if the form '
      + 'submits on Enter rather than through a button.',
    inputSchema: { app: TEN, vai: VAI_TRO, ten: z.string().max(200), chu: z.string().max(2000) },
    annotations: { readOnlyHint: false },
  }, async ({ app, vai, ten, chu }) => chay(app, ['go', vai, ten, chu]));

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
