// Công cụ "màn hình riêng của agent" (docs/DESKTOP.md, nhịp D2).
//
// Agent phụ chạy bằng user ag-<tên> và có MỘT màn hình X ảo của riêng nó (Xvfb, dịch vụ axle-display@<tên>).
// Chụp ảnh và bấm phím TRONG màn hình đó không cần chủ duyệt, vì đó là máy của chính agent — chủ vẫn xem trực
// tiếp và cắt được bất cứ lúc nào. Màn hình THẬT của chủ không đi lối này (phải qua portal, bậc 3 — nhịp D3).
//
// Không mở cửa chạy lệnh tuỳ ý: chỉ mở được app trong danh sách chủ cho phép (/etc/axle/screen-apps.json),
// tuyệt đối không có cửa sổ dòng lệnh — kẻo lách mất bước duyệt của run_command.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const APPS_FILE = process.env.AXLE_SCREEN_APPS || '/etc/axle/screen-apps.json';
// Ống tới dịch vụ màn hình: agent chỉ gửi TÊN app, chính dịch vụ mở (xem core/desktop/display-run.sh)
const LAUNCH = process.env.AXLE_SCREEN_LAUNCH || `${process.env.HOME || ''}/.axle/screen-launch`;
const MAX_IMAGE = 4 * 1024 * 1024;

// Màn hình của agent này: DISPLAY do dịch vụ đặt sẵn trong môi trường (drop-in của axle-mcp@<tên>).
export function display() {
  const d = process.env.DISPLAY;
  return /^:[0-9]{1,3}$/.test(d || '') ? d : null;
}

export function hasDisplay() {
  const d = display();
  return !!d && existsSync(`/tmp/.X11-unix/X${d.slice(1)}`);
}

function x(cmd, args, { timeout = 15_000, buffer = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: MAX_IMAGE + 1024, encoding: buffer ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd}: ${String(stderr || err.message).trim().slice(0, 300)}`));
      resolve(stdout);
    });
  });
}

function apps() {
  try { return JSON.parse(readFileSync(APPS_FILE, 'utf8')); } catch { return {}; }
}

// Phím cho xdotool: chỉ nhận tổ hợp lành (ctrl/alt/shift/super + tên phím X)
const KEY = /^([A-Za-z0-9_+]|ctrl|alt|shift|super|Return|Tab|Escape|BackSpace|Delete|Home|End|Page_Up|Page_Down|Up|Down|Left|Right|F[0-9]{1,2})+$/;

// Đăng ký vào máy chủ MCP. tool() là hàm bọc của tools.js (đã lo nhật ký + cắt chữ).
export function register(tool) {
  const d = display();
  const appList = Object.keys(apps()).join(', ') || '(chưa có app nào)';
  // ImageMagick 6 có /usr/bin/import, bản 7 gói trong `magick import`
  const shot = existsSync('/usr/bin/import')
    ? (args) => x('/usr/bin/import', args, { timeout: 20_000, buffer: true })
    : (args) => x('/usr/bin/magick', ['import', ...args], { timeout: 20_000, buffer: true });

  tool('screen_shot', {
    title: 'Screenshot of the agent screen',
    description: 'Take a PNG screenshot of this agent\'s OWN virtual screen (not the owner\'s screen). '
      + 'Use it to see what the apps you opened are showing.',
    inputSchema: { scale: z.number().min(10).max(100).default(100).describe('Scale the image down to this percent, to save tokens') },
    annotations: { readOnlyHint: true },
  }, async ({ scale }) => {
    const png = await shot(['-display', d, '-window', 'root', '-resize', `${scale}%`, 'png:-']);
    if (png.length > MAX_IMAGE) throw new Error(`ảnh quá lớn (${png.length} byte) — giảm scale`);
    const size = (await x('/usr/bin/xdotool', ['getdisplaygeometry'])).trim().replace(' ', 'x');
    const kt = png.length < 1024 ? `${png.length} byte` : `${Math.round(png.length / 1024)} KB`;
    return { image: png.toString('base64'), mimeType: 'image/png', text: `Màn hình ${size} của agent (${kt})` };
  });

  tool('screen_windows', {
    title: 'Windows on the agent screen',
    description: 'List the windows open on this agent\'s own screen: id, position, size, title.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const out = await x('/usr/bin/wmctrl', ['-l', '-G']).catch(() => '');
    return out.trim() || '(chưa có cửa sổ nào — dùng screen_open để mở app)';
  });

  tool('screen_open', {
    title: 'Open an app on the agent screen',
    description: `Open one of the apps the owner allowed on this agent's screen: ${appList}. `
      + 'Anything else needs run_command, which the owner must approve.',
    inputSchema: { app: z.string().min(1).max(40).describe('App name from the allowed list'),
      arg: z.string().max(4096).optional().describe('Optional file path to open with it') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ app, arg }) => {
    const list = apps();
    if (!list[app]) throw new Error(`"${app}" không nằm trong danh sách app được phép: ${Object.keys(list).join(', ') || '(trống)'}`);
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(app)) throw new Error('tên app không hợp lệ');
    if (arg && !/^[\w@%+=:,./~-]{1,4096}$/.test(arg)) throw new Error('đường dẫn có ký tự lạ');
    if (!existsSync(LAUNCH)) throw new Error('màn hình chưa chạy (chủ bật bằng: sudo axle agent screen <tên> on)');
    // Dịch vụ màn hình mở app, không phải tiến trình này. Ống không có người đọc thì ghi sẽ treo →
    // cắt sau 3 giây và báo rõ, đừng để cả lượt gọi của agent đứng hình.
    const stop = AbortSignal.timeout(3000);
    try { await writeFile(LAUNCH, `${app} ${arg || ''}\n`, { signal: stop }); }
    catch (e) { throw new Error(e.name === 'AbortError' || e.name === 'TimeoutError' ? 'dịch vụ màn hình không nhận (nó còn chạy không?)' : e.message); }
    return `Đã nhờ màn hình mở ${app}. Chờ vài giây rồi screen_shot để xem.`;
  });

  tool('screen_click', {
    title: 'Click on the agent screen',
    description: 'Move the mouse to x,y on the agent\'s own screen and click.',
    inputSchema: {
      x: z.number().int().min(0).max(8192), y: z.number().int().min(0).max(8192),
      button: z.enum(['left', 'middle', 'right']).default('left'),
      double: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false },
  }, async ({ x: px, y: py, button, double }) => {
    const n = { left: '1', middle: '2', right: '3' }[button];
    await x('/usr/bin/xdotool', ['mousemove', String(px), String(py), 'click', ...(double ? ['--repeat', '2'] : []), n]);
    return `Đã bấm ${button}${double ? ' (nháy đúp)' : ''} tại ${px},${py}`;
  });

  tool('screen_type', {
    title: 'Type text on the agent screen',
    description: 'Type text into the focused window of the agent\'s own screen.',
    inputSchema: { text: z.string().min(1).max(4000) },
    annotations: { readOnlyHint: false },
  }, async ({ text }) => {
    await x('/usr/bin/xdotool', ['type', '--clearmodifiers', '--delay', '12', '--', text], { timeout: 60_000 });
    return `Đã gõ ${text.length} ký tự`;
  });

  tool('screen_key', {
    title: 'Press keys on the agent screen',
    description: 'Press a key or key combination, e.g. "Return", "ctrl+s", "alt+Tab".',
    inputSchema: { keys: z.string().min(1).max(64).describe('xdotool key syntax: ctrl+s, Return, alt+F4') },
    annotations: { readOnlyHint: false },
  }, async ({ keys }) => {
    if (!KEY.test(keys)) throw new Error('tổ hợp phím không hợp lệ');
    await x('/usr/bin/xdotool', ['key', '--clearmodifiers', keys]);
    return `Đã bấm ${keys}`;
  });

  tool('screen_scroll', {
    title: 'Scroll on the agent screen',
    description: 'Scroll the mouse wheel on the agent\'s own screen (up or down, a number of notches).',
    inputSchema: { direction: z.enum(['up', 'down']), amount: z.number().int().min(1).max(20).default(3) },
    annotations: { readOnlyHint: false },
  }, async ({ direction, amount }) => {
    await x('/usr/bin/xdotool', ['click', '--repeat', String(amount), direction === 'up' ? '4' : '5']);
    return `Đã cuộn ${direction} ${amount} nấc`;
  });
}

// Tên mọi công cụ màn hình + có phải chỉ-đọc không (để CLI kiểm tên khi cấp quyền, kể cả trên máy chưa bật màn hình).
export const TOOL_NAMES = [['screen_shot', true], ['screen_windows', true], ['screen_open', false],
  ['screen_click', false], ['screen_type', false], ['screen_key', false], ['screen_scroll', false]];

// Danh sách app được phép, để CLI in ra cho chủ xem.
export async function allowedApps() {
  try { return JSON.parse(await readFile(APPS_FILE, 'utf8')); } catch { return {}; }
}
