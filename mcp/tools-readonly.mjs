// In danh sách công cụ MCP CHỈ ĐỌC của Axle, dạng `mcp__axle__tên,…` — để `axle claude` cho Claude dùng thẳng, không hỏi.
// Lấy từ annotations.readOnlyHint lúc đăng ký (mcp/tools.js) chứ không viết tay: thêm tool mới là tự vào danh sách.
// Bỏ ra ngoài mấy thứ "đọc" mà nhạy: tên khoá trong vault, chụp màn hình chủ / màn hình agent — vẫn phải xin.
//   node mcp/tools-readonly.mjs
import { toolInfo } from './tools.js';

const NHAY = new Set(['vault_list', 'owner_screen_shot', 'screen_shot']);
const ten = toolInfo().filter((t) => t.readOnly && !NHAY.has(t.name)).map((t) => `mcp__axle__${t.name}`).sort();
process.stdout.write(`${ten.join(',')}\n`);
