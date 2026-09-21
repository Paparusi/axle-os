#!/usr/bin/env node
// Đọc và thao tác một trang web qua CÂY TRỢ NĂNG (vai trò + tên), bám vào Chromium đang chạy.
//
//   node domtable.mjs <url|attach> chup                    — cây trợ năng của trang
//   node domtable.mjs … bam <vai trò> "<tên>" [--thu N]     — bấm, vd: bam button "Đăng nhập"
//   node domtable.mjs … go  <vai trò> "<tên>" "<chữ>"      — gõ vào ô
//   node domtable.mjs … chon <vai trò> "<tên>" "<giá trị>" — chọn trong danh sách
//   node domtable.mjs … phim Enter                         — gõ phím
//   node domtable.mjs … cuon len|xuong · chu · dcho <url> · cho <giây> · cho-chu "<chữ>"
//   node domtable.mjs … lam 'go combobox "Tìm" "abc"' 'phim Enter' 'chup'   — cả kịch bản, MỘT tiến trình
//   … hoặc bỏ trống đối số thì đọc từng dòng từ stdin
//
// LỊCH SỬ, để người sau khỏi đi lại đường cũ: bản đầu tự viết tay CDP rồi tự dựng "bảng phần tử đánh số"
// (học từ browser-use/jev-ultrafast). Chạy được, nhưng vấp đúng hai chỗ mà một thư viện chín đã giải từ lâu:
//   * bấm trượt mà IM LẶNG — trang có hai nút cùng tên "Search", bấm nhầm cái bị che, không ai biết;
//   * phải `sleep` đoán xem trang tải xong chưa.
// Playwright giải cả hai: `getByRole` định vị theo NGỮ NGHĨA, và trước khi thao tác nó kiểm phần tử có hiện,
// có đứng yên, có nhận được sự kiện không — không trúng thì NÉM LỖI chứ không im lặng.
// Nên bỏ hẳn bản tự chế. Giữ lại đúng một thứ của thiết kế cũ: cách tìm cổng gỡ lỗi ngẫu nhiên.
//
// Không tải trình duyệt nào: `connectOverCDP` bám vào Chromium ĐANG CHẠY (web app do `axle webapp` mở,
// hoặc một bản tự mở). Vì vậy chỉ cần `playwright-core`, không cần gói `playwright` đầy đủ.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
function napPlaywright() {
  for (const p of ['playwright-core', '/opt/axle/mcp/node_modules/playwright-core',
    `${process.env.HOME}/openclaw/node_modules/playwright-core`]) {
    try { return require_(p); } catch { /* thử chỗ kế */ }
  }
  throw new Error('Thiếu playwright-core. Cài: npm i playwright-core (không cần tải trình duyệt)');
}

// Cổng CDP: đặt thẳng bằng AXLE_CDP_PORT, hoặc AXLE_CDP_PROFILE trỏ vào hồ sơ Chromium (đọc số cổng trong
// DevToolsActivePort — web app của Axle mở bằng --remote-debugging-port=0), hoặc tự dò.
//
// TỰ DÒ THÌ ƯU TIÊN TRÌNH DUYỆT THẬT, không lấy bản headless. Đây là chỗ quan trọng nhất và cũng là chỗ
// bản đầu làm sai: mở một Chromium trắng, không hồ sơ, không đăng nhập → trang nào chặn bot là chặn ngay
// (DuckDuckGo không trả một kết quả nào), và mọi trang cần đăng nhập đều vô dụng. Trình duyệt THẬT của chủ
// có sẵn phiên đăng nhập, cookie, và trông như người dùng thật.
async function timCongTuDo() {
  for (const cong of [9444, 9222, 9333]) {
    const v = await fetch(`http://127.0.0.1:${cong}/json/version`).then((r) => r.json()).catch(() => null);
    if (!v) continue;
    if (!/Headless/i.test(`${v.Browser || ''}${v['User-Agent'] || ''}`)) return { cong, ten: v.Browser, that: true };
  }
  for (const cong of [9333, 9444, 9222]) {
    const v = await fetch(`http://127.0.0.1:${cong}/json/version`).then((r) => r.json()).catch(() => null);
    if (v) return { cong, ten: v.Browser, that: false };
  }
  return null;
}

function timCong() {
  if (process.env.AXLE_CDP_PORT) return Number(process.env.AXLE_CDP_PORT);
  const hs = process.env.AXLE_CDP_PROFILE;
  if (hs) {
    try {
      const n = Number(readFileSync(`${hs}/DevToolsActivePort`, 'utf8').split('\n')[0].trim());
      if (n > 0) return n;
    } catch { throw new Error(`không đọc được cổng gỡ lỗi ở ${hs}/DevToolsActivePort — app đã mở chưa?`); }
  }
  return null;   // để main() tự dò
}

// ƯU TIÊN Chromium ĐẦY ĐỦ: bản chrome-headless-shell thiếu cờ của trình duyệt thật (vd `--app=`), thử bằng
// nó là thử sai thứ — web app của Axle chạy Chromium đầy đủ.
function timChromium() {
  if (process.env.AXLE_CHROME) return process.env.AXLE_CHROME;
  const san = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => existsSync(p));
  if (san) return san;
  try {
    const goc = `${process.env.HOME}/.cache/ms-playwright`;
    const ban = readdirSync(goc).filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of ban) {
      for (const t of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        if (existsSync(`${goc}/${b}/${t}`)) return `${goc}/${b}/${t}`;
      }
    }
  } catch { /* không có cache thì thôi */ }
  return null;
}

async function moTrinhDuyet(url, cong) {
  const bin = timChromium();
  if (!bin) throw new Error('Không thấy Chromium trên máy');
  const p = spawn(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,1000', `--remote-debugging-port=${cong}`, '--lang=vi-VN', url || 'about:blank'],
  { stdio: 'ignore', detached: true });
  p.unref();
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${cong}/json/version`).then(() => true).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('trình duyệt không mở được');
}

const TAB_LUU = `${process.env.HOME}/.cache/axle-web-tab.json`;

async function idCuaTab(ctx, page) {
  try {
    const s = await ctx.newCDPSession(page);
    const { targetInfo } = await s.send('Target.getTargetInfo');
    await s.detach().catch(() => {});
    return targetInfo.targetId;
  } catch { return null; }
}

// Tìm lại đúng tab của mình; chưa có thì mở tab mới và nhớ id lại.
async function timTab(ctx, dich) {
  let luu = null;
  try { luu = JSON.parse(readFileSync(TAB_LUU, 'utf8')).targetId; } catch { /* lần đầu */ }
  if (luu) {
    for (const p of ctx.pages()) {
      if (await idCuaTab(ctx, p) === luu) return p;
    }
  }
  const p = await ctx.newPage();
  const id = await idCuaTab(ctx, p);
  try { writeFileSync(TAB_LUU, JSON.stringify({ targetId: id }), { mode: 0o600 }); } catch { /* không nhớ được thì thôi */ }
  if (dich !== 'attach') await p.goto(dich, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  return p;
}

const VAI = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem', 'option',
  'searchbox', 'switch', 'heading', 'listitem', 'img', 'cell'];

async function main() {
  const [dich, lenh = 'chup', ...doi] = process.argv.slice(2);
  if (!dich) {
    console.error('node domtable.mjs <url|attach> chup|bam|go|chon|phim|cuon|chu|dcho [đối số…]');
    process.exit(2);
  }
  let cong = timCong();
  let nhan = '';
  if (!cong) {
    const tim_ = await timCongTuDo();
    if (!tim_) {
      if (dich === 'attach') throw new Error('Không thấy trình duyệt nào đang mở cổng gỡ lỗi (9444/9222/9333)');
      cong = 9333;
      await moTrinhDuyet(dich, cong);
    } else {
      cong = tim_.cong;
      nhan = `${tim_.ten}${tim_.that ? '' : ' (headless)'} · cổng ${cong}`;
    }
  } else if (dich !== 'attach' && !(await fetch(`http://127.0.0.1:${cong}/json/version`).then(() => true).catch(() => false))) {
    await moTrinhDuyet(dich, cong);
  }

  const { chromium } = napPlaywright();
  const br = await chromium.connectOverCDP(`http://127.0.0.1:${cong}`);
  try {
    const ctx = br.contexts()[0];
    if (!ctx) throw new Error('trình duyệt chưa mở cửa sổ nào');
    // TAB RIÊNG, nhớ lại giữa các lần gọi. KHÔNG chiếm tab người dùng đang xem — bản đầu lấy bừa pages()[0]
    // nên có thể điều khiển ngay tab chủ máy đang làm việc. Nhớ bằng targetId của DevTools.
    const page = await timTab(ctx, dich);
    if (nhan) process.stderr.write(`(bám vào ${nhan})\n`);

    // Định vị theo NGỮ NGHĨA. Playwright tự chờ phần tử hiện + đứng yên + nhận được sự kiện rồi mới thao
    // tác; không trúng thì ném lỗi — khác hẳn bấm theo toạ độ, trượt mà vẫn báo thành công.
    // Chỉ lấy thứ ĐANG HIỆN, và KHÔNG đoán khi mơ hồ: nhiều phần tử cùng khớp thì kể hết ra cho người gọi
    // chọn, chứ `.first()` bừa là bấm nhầm cái bị che — đúng lỗi của bản tự chế trước đây.
    const tim = async (vai, ten, thu) => {
      if (!VAI.includes(vai)) throw new Error(`vai trò lạ '${vai}' — dùng: ${VAI.join(', ')}`);
      const loc = page.getByRole(vai, { name: ten, exact: false }).filter({ visible: true });
      const n = await loc.count();
      if (n === 0) throw new Error(`không thấy ${vai} nào đang hiện có tên giống "${ten}"`);
      if (n === 1) return loc.first();
      if (Number.isInteger(thu) && thu >= 0 && thu < n) return loc.nth(thu);
      const ke = [];
      for (let i = 0; i < Math.min(n, 8); i++) {
        const t = (await loc.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        const h = await loc.nth(i).boundingBox().catch(() => null);
        ke.push(`    ${i}: ${t.slice(0, 40) || '(không chữ)'}${h ? `  ở (${Math.round(h.x)},${Math.round(h.y)})` : ''}`);
      }
      throw new Error(`có ${n} ${vai} khớp "${ten}" — nói tên rõ hơn, hoặc thêm số thứ tự ở cuối:\n${ke.join('\n')}`);
    };

    const lamMot = async (lenh, doi) => {
    const soThu2 = () => { const i = doi.indexOf('--thu'); return i < 0 ? undefined : Number(doi[i + 1]); };
    switch (lenh) {
      case 'chup': {
        const cay = await page.locator('body').ariaSnapshot();
        console.log(`${await page.title()}\n${page.url()}\n`);
        console.log(cay.length > 12_000 ? `${cay.slice(0, 12_000)}\n… (cắt bớt)` : cay);
        break;
      }
      case 'bam':
        await (await tim(doi[0], doi[1], soThu2())).click({ timeout: 15_000 });
        console.log(`đã bấm ${doi[0]} "${doi[1]}"`);
        break;
      case 'go': {
        const o = await tim(doi[0], doi[1], soThu2());
        await o.fill(doi.slice(2).filter((x, i, a) => x !== '--thu' && a[i - 1] !== '--thu').join(' '), { timeout: 15_000 });
        console.log(`đã gõ vào ${doi[0]} "${doi[1]}"`);
        break;
      }
      case 'chon':
        await (await tim(doi[0], doi[1], soThu2())).selectOption(doi.slice(2).join(' '), { timeout: 15_000 });
        console.log(`đã chọn "${doi.slice(2).join(' ')}"`);
        break;
      case 'phim':
        await page.keyboard.press(doi[0] || 'Enter');
        console.log(`đã bấm phím ${doi[0] || 'Enter'}`);
        break;
      case 'cuon':
        await page.mouse.wheel(0, doi[0] === 'len' ? -600 : 600);
        console.log(`đã cuộn ${doi[0] === 'len' ? 'lên' : 'xuống'}`);
        break;
      case 'dcho':
        await page.goto(doi[0], { waitUntil: 'domcontentloaded', timeout: 30_000 });
        console.log(`đã tới ${page.url()}`);
        break;
      case 'chu': {
        const t = await page.locator('body').innerText();
        console.log(t.replace(/\n{3,}/g, '\n\n').slice(0, 6000));
        break;
      }
      case 'cho':
        await page.waitForTimeout(Math.min(Number(doi[0] || 1) * 1000, 30_000));
        console.log(`đã chờ ${doi[0] || 1} giây`);
        break;
      case 'cho-chu':
        // Chờ CHỮ hiện ra, đừng đoán số giây — đoán thì lúc được lúc không
        await page.getByText(doi.join(' '), { exact: false }).first().waitFor({ timeout: 30_000 });
        console.log(`đã thấy "${doi.join(' ')}"`);
        break;
      default:
        throw new Error(`không hiểu lệnh ${lenh}`);
    }
    };

    if (lenh === 'lam') {
      // Cả kịch bản trong MỘT tiến trình: chạy 10 bước bằng 10 lần gọi là trả 10 lần khởi động Node +
      // nạp Playwright (đo thật: 136ms mỗi lần). Các bước lấy từ đối số, hoặc từ stdin nếu không có.
      let buoc = doi.filter((d) => d.trim());
      if (!buoc.length) {
        const vao = await new Promise((ok) => {
          let t = ''; process.stdin.setEncoding('utf8');
          process.stdin.on('data', (c) => { t += c; }); process.stdin.on('end', () => ok(t));
        });
        buoc = vao.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      }
      for (const b of buoc) {
        // tách theo khoảng trắng nhưng giữ nguyên phần trong nháy kép
        const ph = (b.match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"|"$/g, ''));
        process.stdout.write(`→ ${b}\n  `);
        await lamMot(ph[0], ph.slice(1));
      }
    } else {
      await lamMot(lenh, doi);
    }
  } finally {
    await br.close().catch(() => {});   // chỉ ngắt kết nối CDP, KHÔNG tắt trình duyệt của người dùng
  }
}

// In ĐỦ thông điệp lỗi: chỗ mơ hồ liệt kê các lựa chọn ở những dòng sau, cắt đi là vứt mất phần hữu ích
// nhất. Riêng lỗi dài của Playwright (có kèm cả "call log") thì cắt bớt đuôi cho đỡ ngộp.
main().catch((e) => {
  const m = String(e.message || e);
  const i = m.indexOf('Call log:');
  console.error(`✗ ${(i > 0 ? m.slice(0, i) : m).trim()}`);
  process.exit(1);
});
