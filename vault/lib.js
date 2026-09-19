// Luật của vault, tách thành hàm thuần để thử không cần máy (npm test).
// Chỗ giữ chỗ: {{secret.TEN_KHOA}} — được đặt trong đường dẫn/query, header, body. KHÔNG được ở phần tên miền.

export const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PH_RE = /\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}/g;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Tên các khoá được nhắc trong một chuỗi.
export function namesIn(s) {
  return [...String(s ?? '').matchAll(PH_RE)].map((m) => m[1]);
}

// "api.github.com" khớp đúng; ".github.com" khớp mọi tên miền con (không khớp github.com).
export function hostAllowed(host, allowed) {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const x = a.toLowerCase();
    return x.startsWith('.') ? h.endsWith(x) && h.length > x.length : h === x;
  });
}

// Kiểm và điền khoá vào một yêu cầu. Trả về { url, headers, body, used }.
// secrets: { TEN: { value, hosts: [...] } }
export function prepare(req, secrets) {
  const { method = 'GET', url, headers = {}, body } = req;
  if (typeof url !== 'string') throw new Error('Thiếu url');
  const authority = url.match(/^[a-z]+:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (namesIn(authority).length) throw new Error('Không được đặt khoá trong tên miền');

  const used = new Set([...namesIn(url), ...Object.values(headers).flatMap(namesIn), ...namesIn(body)]);
  for (const n of used) {
    if (!NAME_RE.test(n)) throw new Error(`Tên khoá không hợp lệ: ${n}`);
    if (!secrets[n]) throw new Error(`Không có khoá ${n}`);
  }

  const fill = (s) => String(s).replace(PH_RE, (_, n) => secrets[n].value);
  const target = new URL(fill(url));
  const loop = LOOPBACK.has(target.hostname);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loop)) {
    throw new Error('Chỉ cho https (http chỉ với localhost)');
  }
  for (const n of used) {
    if (!hostAllowed(target.hostname, secrets[n].hosts ?? [])) {
      throw new Error(`Khoá ${n} không được gửi tới ${target.hostname} (chỉ: ${(secrets[n].hosts ?? []).join(', ') || 'không nơi nào'})`);
    }
  }
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) throw new Error(`Method không hỗ trợ: ${method}`);

  const outHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/[\r\n]/.test(k) || /[\r\n]/.test(String(v))) throw new Error('Header không được xuống dòng');
    outHeaders[k] = fill(v);
  }
  return { method, url: target.toString(), headers: outHeaders, body: body == null ? undefined : fill(body), used: [...used] };
}

// Xoá mọi giá trị khoá (kể cả dạng URL-encode) khỏi chữ trả về cho agent.
export function redact(text, secrets) {
  let out = String(text ?? '');
  for (const [n, { value }] of Object.entries(secrets)) {
    if (!value || value.length < 4) continue;
    for (const v of new Set([value, encodeURIComponent(value)])) out = out.split(v).join(`[ĐÃ ẨN:${n}]`);
  }
  return out;
}
