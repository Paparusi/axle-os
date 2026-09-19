# Quyền của agent trong Axle — tiện nhất mà vẫn an toàn

Nghiên cứu 19/9/2026. Câu hỏi của Bi: agent bị nhốt trong hộp cát thì còn giúp được gì? Làm sao để agent
**làm được việc thật** mà máy vẫn an toàn?

---

## 1. Bài học từ các hệ thống khác

| # | Bài học | Nguồn | Ý nghĩa cho Axle |
|---|---|---|---|
| 1 | **Người duyệt mỏi thì duyệt bừa.** Người dùng bấm đồng ý ~93% lời hỏi; trong thử nghiệm, người chặn được 13,6% lệnh nguy hiểm, bộ lọc tự động chặn 89%. | Anthropic (auto mode của Claude Code) | Hỏi ít đi nhưng hỏi đúng chỗ. Hỏi nhiều = an toàn giả. |
| 2 | **Vạch ranh giới một lần, chạy tự do bên trong.** Hộp cát quyết định agent *làm được gì*; chính sách duyệt quyết định *khi nào phải hỏi* — hai lớp riêng. | Claude Code sandbox, Codex CLI (Landlock + seccomp trên Linux) | Giữ hộp cát, nhưng trong ranh giới thì không hỏi. |
| 3 | **Agent có tài khoản riêng + được cấp sẵn vài thư mục của người dùng**; ra ngoài các thư mục đó phải được cho phép. | Windows 11 Agent Workspace | Đúng hướng Axle đang đi, thiếu phần "cấp thư mục". |
| 4 | **Bộ ba chết người:** dữ liệu riêng + nội dung lạ (web, email, tin khách) + đường gửi ra ngoài. Đủ cả ba thì một đoạn chữ độc là rút được dữ liệu. | Simon Willison (lethal trifecta) | Cấm một agent có đủ ba thứ mà không có người duyệt. |
| 5 | **Luật Hai:** trong một phiên, agent chỉ được giữ tối đa 2 trong 3: [A] nhận dữ liệu lạ, [B] chạm dữ liệu riêng/hệ thống nhạy cảm, [C] đổi trạng thái hoặc gửi ra ngoài. | Meta (Agents Rule of Two, 31/10/2025) | Axle tự kiểm khi cấp quyền. |
| 6 | **Chọn là cấp:** người dùng chọn file nào thì app chỉ được đúng file đó. | Flatpak portal, iOS "chọn ảnh" | Cấp đúng thư mục/file, không cấp cả home. |
| 7 | **Quyền tạm và tự thu hồi:** "chỉ lần này"; quyền không dùng vài tháng tự mất. | Android 11+ | Quyền có hạn; lâu không dùng thì tự rút. |
| 8 | **Luật cứng theo tham số, không nhờ AI tự giác:** ví dụ chỉ cho gửi mail tới tên miền nội bộ. Tỉ lệ tấn công thành công giảm từ 70,3% xuống 3,9%. | Progent | Luật Axle kiểm ở máy, không nằm trong lời nhắc. |
| 9 | **Tách kế hoạch khỏi dữ liệu lạ:** kế hoạch lập từ yêu cầu của người dùng; dữ liệu lạ không được đổi kế hoạch. | CaMeL (Google DeepMind) | Duyệt một lần cho cả kế hoạch, không duyệt từng bước. |
| 10 | **Việc hệ trọng phải xác nhận; việc nhạy cảm phải có người xem;** agent dùng tài khoản mà không cầm mật khẩu. | ChatGPT agent/Atlas (watch mode, logged-out mode) | Vault "dùng mà không thấy" đã đúng; thêm chế độ xem khi cần. |
| 11 | **Nhãn công cụ (chỉ đọc / có phá) chỉ là gợi ý**, không phải phân quyền. | MCP spec, blog MCP 3/2026 | Axle phân quyền ở máy chủ, không tin nhãn. |

## 2. Chỗ hổng Axle đang có (phát hiện khi nghiên cứu)

1. **Agent phụ gần như vô dụng**: chỉ thấy home riêng, không đụng được việc của chủ.
2. **Trợ lý chính không có danh tính rõ**: ai có khoá SSH là có quyền chủ; không thu hồi riêng được; khoá mở cả shell.
3. **Đường rò dữ liệu qua `http_request`**: yêu cầu *không kèm khoá* thì gọi được mọi địa chỉ. Agent đọc được file riêng +
   nhận tin lạ + gọi mạng tự do = đủ bộ ba chết người. Khoá thì đã gắn tên miền, nhưng **dữ liệu** thì chưa.
4. **Duyệt từng lệnh** sẽ gây mỏi: làm việc thật phải bấm liên tục → bấm bừa.

## 3. Thiết kế đề xuất

### 3.1. Ba vai

| Vai | Là ai | Chạy bằng | Thấy gì |
|---|---|---|---|
| **Chủ** | Bi | `admin_1`, shell đầy đủ | Tất cả |
| **Trợ lý chính** (`--vai chinh`) | Cog, Claude của Bi | **Quyền của chủ** | Mọi thứ của chủ **trừ** vùng bí mật (vault, `.ssh`, `.config`…) |
| **Agent phụ** (`--vai phu`, mặc định) | Bot Conflux, agent bên ngoài | User riêng `ag-<tên>`, hộp cát | Home riêng + những gì được cấp |

- Danh tính trợ lý chính = **khoá SSH riêng chỉ mở được cổng MCP** (`command="axle mcp --as cog",restrict` trong
  `authorized_keys`), không mở được shell. Thu hồi: `sudo axle agent rm cog`. Nhật ký ghi `cog`, không tin tên tự khai.
- Bi vẫn SSH bằng khoá của mình như thường.

### 3.2. Cấp quyền kiểu điện thoại

```bash
axle agent grant conflux thu-muc ~/projects/conflux --doc        # chỉ đọc
axle agent grant conflux thu-muc ~/projects/conflux/data --ghi   # đọc + ghi
axle agent grant conflux mang api.conflux.vn                     # được gọi ra đúng tên miền này
axle agent grant conflux khoa GITHUB_TOKEN                       # (đã có: vault grant)
... --han 1h | 1d | luon                                         # quyền có hạn
```

- **Thư mục**: ACL cho user agent + gắn đúng thư mục đó vào hộp cát (`BindPaths`/`BindReadOnlyPaths`).
  Phần còn lại của home chủ vẫn vô hình.
- **Mạng ra ngoài** (mới, vá lỗ 3): mỗi agent có danh sách tên miền được gọi; `http_request` tới nơi khác → xin duyệt.
  Trợ lý chính: tên miền mới thì hỏi một lần, "nhớ luôn" được.
- **Tự rút quyền** không dùng 30 ngày (như Android).

### 3.3. Duyệt 4 bậc — ít bấm mà chắc

| Bậc | Ví dụ | Xử lý |
|---|---|---|
| 0 · Tự chạy | Đọc trong vùng được cấp, ghi `~/work`, gọi tên miền đã cho phép | Chạy, ghi nhật ký |
| 1 · Chạy + báo gom | Ghi vào thư mục được cấp quyền ghi, khởi động lại dịch vụ của chính agent | Chạy; cuối ngày gửi 1 tin tóm tắt |
| 2 · Hỏi một lần | Lệnh mới, tên miền mới, chạy lệnh bằng quyền chủ | Nút **✅ Lần này · ✅ 1 giờ · ✅ Luôn việc này · ❌** |
| 3 · Luôn hỏi | Quyền root, xoá hàng loạt, undo hệ thống, đổi quyền, cấp khoá | Chỉ **✅ Lần này / ❌**, không nhớ |

- "Luôn việc này" lưu thành **luật cụ thể** (ví dụ `npm test` trong `~/projects/conflux`), không phải "cho làm gì cũng được".
- **Duyệt kế hoạch**: agent gửi cả chuỗi bước, Bi duyệt một lần; bước nào lệch kế hoạch thì phải hỏi lại.
- Về sau: **bộ lọc tự động** (Claude hoặc model qua Conflux) xếp bậc cho lệnh shell mới — theo số liệu của Anthropic,
  bộ lọc bắt lệnh nguy hiểm tốt hơn người đang mỏi. Bậc 3 thì vẫn luôn là người quyết.

### 3.4. Luật Hai cài sẵn

Mỗi agent mang 3 cờ, Axle tự suy từ quyền được cấp:
**A** nhận dữ liệu lạ (tin khách, web, email) · **B** chạm dữ liệu riêng/khoá · **C** đổi trạng thái/gửi ra ngoài.

- Cấp quyền mà agent thành đủ **A+B+C** → Axle **từ chối**, trừ khi mọi hành động C của agent đó chuyển lên bậc 3.
- Ví dụ bot Conflux: A (tin khách) + C (trả lời, gọi API) → **không được B** (không cấp thư mục riêng; chỉ khoá gắn tên miền).
- Cog (trợ lý chính): B + C; khi đọc nội dung lạ (web, email) thì phiên đó tự hạ xuống không gửi ra ngoài được nếu không hỏi.

### 3.5. Quan sát và dừng khẩn cấp

- Bot Telegram: `/agents` xem agent nào đang làm gì; `/dung <agent>` dừng ngay (tắt máy chủ + treo mọi quyền tạm).
- Nhật ký đã có (MCP, lệnh shell, vault, duyệt).

## 4. Lộ trình

| Nhịp | Nội dung |
|---|---|
| 4a | Vai chính/phụ (khoá SSH chỉ mở MCP), `/dung` khẩn cấp |
| 4b | Cấp thư mục (ACL + gắn vào hộp cát) + **cấp mạng ra ngoài theo agent** (vá lỗ rò dữ liệu) |
| 4c | Duyệt 4 bậc, nút "1 giờ / luôn việc này", luật nhớ được, tin tóm tắt cuối ngày |
| 4d | Luật Hai khi cấp quyền; duyệt kế hoạch |
| 4e | Bộ lọc tự động xếp bậc (tuỳ chọn) |

Nhịp 4 cũ (office) lùi thành Nhịp 5, bản Desktop thành Nhịp 6.

## Nguồn

- Anthropic — [Claude Code auto mode](https://anthropic.com/engineering/claude-code-auto-mode) ·
  [How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude) ·
  [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- OpenAI — [Codex: approvals & security](https://developers.openai.com/codex/agent-approvals-security) ·
  [ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent) ·
  [Hardening Atlas against prompt injection](https://openai.com/index/hardening-atlas-against-prompt-injection/)
- Microsoft — [Windows 11: Agentic security](https://learn.microsoft.com/en-us/windows/security/book/operating-system-agentic-security) ·
  [Experimental agentic features](https://support.microsoft.com/en-us/windows/experimental-agentic-features-a25ede8a-e4c2-4841-85a8-44839191dfb3)
- Meta — [Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)
- Simon Willison — [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) ·
  [Progent: Privilege Control for LLM Agents](https://arxiv.org/abs/2504.11703)
- [Flatpak sandbox permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html) ·
  [XDG FileChooser portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.FileChooser.html)
- Android — [Permissions updates in Android 11](https://developer.android.com/about/versions/11/privacy/permissions) ·
  [Partial photo access](https://developer.android.com/about/versions/14/changes/partial-photo-video-access)
- MCP — [Tool annotations as risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
