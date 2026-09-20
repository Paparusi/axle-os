// Thử số liệu tình trạng máy gửi cho app (tab Máy): node approve/test-machine-state.mjs
// Chạy được trên máy thường, không cần bộ duyệt. Kiểm hai chuyện: số có nghĩa, và KHÔNG lọt gì nhạy cảm.
import { machineState } from './machine-state.js';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const t0 = Date.now();
const s = await machineState();
const ms = Date.now() - t0;

ok(ms < 6000, `đo xong trong ${ms}ms (không được chẹn vòng nhận tin)`);
ok(typeof s.host === 'string' && s.host.length > 0, `tên máy: ${s.host}`);
ok(typeof s.os === 'string' && s.os.length > 1, `hệ điều hành: ${s.os}`);
ok(Number.isInteger(s.uptimeSec) && s.uptimeSec > 0, `chạy liên tục ${Math.round(s.uptimeSec / 3600)} giờ`);
ok(typeof s.load1 === 'number' && s.load1 >= 0, `tải ${s.load1}`);

for (const [k, o] of [['ổ đĩa', s.disk], ['RAM', s.ram]]) {
  ok(o.totalGb > 0 && o.usedGb >= 0 && o.usedGb <= o.totalGb, `${k}: ${o.usedGb}/${o.totalGb} GB hợp lý`);
  ok(Number.isInteger(o.pct) && o.pct >= 0 && o.pct <= 100, `${k}: ${o.pct}% trong khoảng 0-100`);
}

ok(Array.isArray(s.failed) && s.failed.length <= 5, `dịch vụ hỏng: ${s.failed.length ? s.failed.join(', ') : 'không có'} (cắt tối đa 5)`);
ok(Number.isInteger(s.agents.total) && Number.isInteger(s.agents.suspended), 'đếm agent ra số nguyên');
ok(s.snapshot === null || Number.isInteger(s.snapshot.number), 'ảnh hệ thống: null hoặc có số');
ok(typeof s.desktop === 'boolean' && typeof s.loginPhone === 'boolean', 'cờ giao diện / đăng nhập điện thoại là true-false');

// Gói đi qua hộp niêm phong của trạm — phải nhỏ, và tuyệt đối không có gì nhạy cảm
const raw = JSON.stringify(s);
ok(raw.length < 2048, `gói ${raw.length} byte (dưới 2KB)`);
const cam = [/\/home\/[a-z]/i, /token/i, /secret/i, /password/i, /ssh-(rsa|ed25519)/i, /\bBEGIN [A-Z ]*PRIVATE/];
const lot = cam.filter((re) => re.test(raw));
ok(lot.length === 0, lot.length ? `LỌT thứ nhạy cảm: ${lot}` : 'không lọt đường dẫn nhà, khoá, hay mật khẩu nào');

console.log(fail ? `✗ ${fail} mục hỏng` : '✓ tình trạng máy cho app: đạt');
process.exit(fail ? 1 : 0);
