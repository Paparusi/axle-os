# Kênh duyệt của Axle — khi agent chạy một mình, chủ ở chỗ khác

Nghiên cứu 19/9/2026. Câu hỏi của Bi: không dùng Telegram thì duyệt qua đâu? Hệ điều hành thông thường chưa gặp
bài toán này: hộp thoại xin quyền của Windows (UAC) hay Linux (polkit) đều giả định **người đang ngồi trước máy**.
Axle thì ngược lại: agent làm việc cả khi chủ đi vắng, máy chủ không có màn hình.

---

## 1. Những lĩnh vực đã gặp bài toán gần giống

| Lĩnh vực | Họ làm gì | Bài học cho Axle |
|---|---|---|
| **Hộp thoại xin quyền của hệ điều hành** — Windows UAC | Hiện trên "màn hình an toàn": chương trình đang xin quyền không vẽ đè, không tự bấm được | **Thứ xin quyền không bao giờ được chạm tới chỗ duyệt.** polkit của Linux không có lớp này: phần mềm độc đăng ký làm "agent xác thực" giả được |
| **Chuẩn CIBA** (OpenID) — Auth0 dùng cho AI agent | Tách "máy đang chạy việc" và "máy người dùng duyệt"; agent xin, người duyệt trên điện thoại; kèm mô tả giao dịch có cấu trúc (RAR) | Dịch vụ duyệt của Axle chính là một "máy chủ CIBA" thu nhỏ; về sau mở chuẩn này cho agent bên ngoài |
| **Cấp quyền đặc quyền tạm thời** — Teleport | Báo qua nhiều kênh cùng lúc (Slack, PagerDuty, Jira, email…); nhưng nhiều nơi bắt **bấm sang trang của Teleport** để quyết | **Báo ≠ duyệt.** Kênh nào cũng báo được; chỉ kênh đủ tin cậy mới được quyết |
| **Duyệt đăng nhập trên điện thoại** — vụ Uber 2022 | Kẻ gian dội thông báo tới khi nhân viên mỏi, bấm đồng ý. Microsoft bắt buộc **khớp số** từ 5/2023 | Chống dội: giới hạn số lần xin, khớp số cho việc hệ trọng, dội nhiều thì tự dừng agent |
| **Xác nhận giao dịch ngân hàng** — PSD2, Secure Payment Confirmation | Chữ ký gắn chặt với **đúng số tiền + đúng người nhận**; đổi một chi tiết là chữ ký vô hiệu ("thấy gì ký nấy") | Việc hệ trọng: passkey ký lên **mã băm của đúng việc đó**, không phải "đồng ý" chung chung |
| **Link một chạm trong email** | Bộ quét email (Defender, Proofpoint, Mimecast…) tự mở mọi link → "bấm hộ" người dùng | Email chỉ để báo; link dẫn tới trang phải bấm thêm (POST), không bao giờ duyệt bằng một lần mở link |
| **MCP — elicitation dạng URL** (chuẩn 11/2025) | Máy chủ MCP đưa người dùng tới một trang https cho việc nhạy cảm; client không được tự mở trước, phải hiện đủ URL | Agent dùng MCP (Claude Code…) có thể được Axle đưa link trang duyệt ngay trong cửa sổ của nó — mà agent vẫn không tự duyệt được |
| **Quyền riêng tư của kênh chat** | Tin nhắn bot Telegram **không mã hoá đầu cuối**; máy chủ Telegram đọc được | Kênh của bên thứ ba chỉ nên nhận **tóm tắt**; lệnh đầy đủ xem trên trang của máy |
| **Thông báo tự dựng** — ntfy | Máy chủ mã nguồn mở, app Android/iOS, **nút bấm trên thông báo** gọi thẳng HTTP | Kênh đẩy không cần tài khoản chat, dữ liệu không qua bên thứ ba |
| **Web Push trên iPhone** (iOS 16.4+) | Chỉ khi trang được "thêm vào màn hình chính"; khoá VAPID tự sinh, không cần tài khoản Apple Developer; nội dung mã hoá đầu cuối | Trang duyệt của Axle làm được thông báo đẩy cho cả iPhone lẫn Android, không phụ thuộc app chat |

## 2. Rủi ro riêng của kênh duyệt (chưa ai gom lại cho agent)

1. **Agent tự duyệt cho mình** — nếu đường duyệt chạm được từ phía agent (socket, tài khoản bot, khoá vault).
   Axle đã bắt được trường hợp này: trợ lý chính chạy bằng quyền chủ nên không được có đường quyết định nào qua socket thường.
2. **Agent giả làm tin nhắn duyệt** — agent cầm được token bot thì gửi được nút "Duyệt" giả, trỏ vào việc khác.
3. **Dội yêu cầu cho chủ mỏi** (như vụ Uber).
4. **Mô tả sai sự thật** — agent xin "dọn thư mục tạm" nhưng lệnh thật là `base64 -d | bash` → phải hiện **đúng lệnh** + cờ cảnh báo lệnh bị làm rối.
5. **Tráo việc sau khi duyệt** — Axle đã chốt nội dung lúc xin; bậc 3 cần thêm chữ ký gắn với đúng việc.
6. **Bị bấm hộ** — bộ quét email, bản xem trước link trong app chat.
7. **Lộ nội dung qua bên thứ ba** — lệnh, đường dẫn, tên khách hàng đi qua máy chủ Telegram/Zalo.
8. **Kênh sập** — điện thoại mất mạng, Telegram bị chặn → việc treo; mặc định phải là **từ chối** chứ không phải cho qua.
9. **Tài khoản chat bị chiếm** (SIM swap, lộ phiên) → kẻ gian duyệt lệnh root.

## 3. Thiết kế đề xuất

### 3.1. Tách ba vai: hàng chờ · kênh báo · nơi quyết

```
agent ──xin──▶ Hàng chờ duyệt (đã có: bậc, luật, nhớ) ──báo──▶ Telegram · Zalo · ntfy · Web Push · email
                        ▲                                             │
                        └──────────── quyết (theo mức tin cậy) ◀──────┘
```

**Mức tin cậy của nơi quyết:**

| Mức | Nơi quyết | Chứng minh là chủ |
|---|---|---|
| T1 | Nút trong Telegram / trả lời mã trong Zalo | Id tài khoản chat của chủ |
| T2 | Nút trên thông báo ntfy / trang web đã đăng nhập | Thiết bị đã ghép cặp + mạng riêng (Tailscale/mạng nhà) |
| T3 | Trang duyệt: **passkey ký lên mã băm của đúng việc** · hoặc `sudo axle duyet` tại máy | Vân tay / Face ID trên thiết bị của chủ · mật khẩu sudo |

**Luật:** bậc 2 cần T1 trở lên · **bậc 3 cần T3.** Việc root / xoá cả thư mục / undo không duyệt được bằng một cú bấm
trong app chat: tin nhắn chỉ đưa link tới trang duyệt, ở đó mày quét vân tay. Mất tài khoản chat thì kẻ gian vẫn không
chạy được lệnh root.

### 3.2. Các kênh

| Kênh | Báo | Quyết được | Riêng tư | Ghi chú |
|---|---|---|---|---|
| **Trang duyệt trên máy** (PWA, qua Tailscale/mạng nhà) | Web Push | Bậc 2 + **bậc 3** (passkey) | Dữ liệu không rời máy | **Mặc định cho mọi người.** Thêm vào màn hình chính để nhận thông báo (iPhone 16.4+, Android) |
| `sudo axle duyet` | — | Bậc 2 + bậc 3 | Tại chỗ | Đường cuối cùng khi mọi kênh sập |
| Telegram | ✓ | Bậc 2 | Chỉ gửi tóm tắt (mặc định) | Đã có |
| Zalo | ✓ | Bậc 2 (trả lời mã, bot Zalo không có nút) | Chỉ tóm tắt | Kênh quen thuộc nhất với người Việt |
| ntfy (tự dựng) | ✓ | Bậc 2 (nút trên thông báo) | Dữ liệu ở máy mình | Cho người không muốn dùng app chat |
| Email | ✓ | **Không** | Chỉ tóm tắt | Chỉ để báo; link dẫn tới trang duyệt |

### 3.3. Chống dội, chống giả, chống bấm hộ

- **Giới hạn:** mỗi agent tối đa N yêu cầu đang chờ; bị từ chối 5 lần trong 10 phút → **tự dừng agent** + báo chủ.
- **Khớp số cho bậc 3:** trang duyệt hiện 3 số, chủ chọn số đang hiện trong tin báo (chống bấm theo phản xạ).
- **Token kênh báo là khoá riêng của Axle:** các khoá `AXLE_*` trong vault **không bao giờ cấp được cho agent** →
  agent không thể gửi tin "Duyệt" giả qua bot của Axle.
- **Cờ lệnh bị làm rối:** `base64 -d`, `curl … | sh`, `eval`, chuỗi hex dài → tin duyệt ghi rõ "⚠️ lệnh bị làm rối".
- **Không duyệt bằng mở link:** mọi link duyệt dẫn tới trang có nút bấm (POST); không xử lý yêu cầu HEAD/GET.
- **Mặc định từ chối:** không có kênh nào nhận được → hết hạn = không chạy (đã có). Chưa cấu hình kênh nào → agent
  nhận ngay "máy chưa có kênh duyệt", không treo.

### 3.4. Riêng tư theo kênh

- Kênh của bên thứ ba (Telegram, Zalo, email): mặc định chỉ gửi **agent · bậc · một dòng tóm tắt · link trang duyệt**.
  Muốn gửi đầy đủ lệnh thì phải bật rõ ràng.
- Kênh tự dựng (trang duyệt, ntfy tự dựng, lệnh máy): đầy đủ.

### 3.5. Agent dùng MCP thấy yêu cầu ngay trong cửa sổ của mình

Với client MCP hỗ trợ elicitation dạng URL (chuẩn 11/2025), công cụ cần duyệt trả về đường link trang duyệt để client
hiện cho người đang ngồi đó — người vẫn phải quét passkey trên trang, agent không tự bấm được.

## 4. Lộ trình

| Nhịp | Nội dung |
|---|---|
| 4d | Tách hàng chờ / kênh báo / nơi quyết; mức tin cậy T1–T3; bậc 3 cần T3; khoá `AXLE_*` không cấp được; giới hạn + tự dừng khi dội; cờ lệnh bị làm rối; chế độ tóm tắt cho kênh bên thứ ba; **`sudo axle duyet`** |
| 4e | **Trang duyệt PWA** trên máy (Tailscale HTTPS): ghép passkey tại máy bằng mã một lần, duyệt bậc 3 bằng passkey ký mã băm việc, Web Push |
| 4f | Zalo (tóm tắt + mã trả lời), ntfy (nút trên thông báo), email (chỉ báo) |
| 4g | Luật Hai (Meta) khi cấp quyền; duyệt cả kế hoạch |
| 4h | Link duyệt trong client MCP (elicitation URL); bộ lọc tự động xếp bậc (tuỳ chọn) |

## Nguồn

- [Auth0 — Asynchronous Authorization (CIBA) cho AI agent](https://auth0.com/ai/docs/intro/asynchronous-authorization) ·
  [Curity — CIBA flow](https://curity.io/resources/learn/ciba-flow/)
- [MCP — Elicitation (URL mode)](https://modelcontextprotocol.io/specification/draft/client/elicitation) ·
  [SEP-1036](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1036) ·
  [WorkOS — MCP 2025-11-25](https://workos.com/blog/mcp-2025-11-25-spec-update)
- [MFA fatigue (Wikipedia)](https://en.wikipedia.org/wiki/Multi-factor_authentication_fatigue_attack) ·
  [The Register — Microsoft bắt buộc khớp số](https://www.theregister.com/2023/05/09/microsoft_authenticator_number_matching/)
- [Corbado — Dynamic linking với passkey (SPC)](https://www.corbado.com/blog/dynamic-linking-passkeys-spc) ·
  [PSD2 dynamic linking](https://cybersecurity.asee.io/blog/understanding-dynamic-linking-within-psd2/)
- [Supabase — magic link bị bộ quét email dùng mất](https://github.com/orgs/supabase/discussions/41618)
- [Teleport — Access Request plugins](https://goteleport.com/docs/identity-governance/access-requests/plugins/)
- [ntfy — gửi tin, nút hành động](https://docs.ntfy.sh/publish/) ·
  [pwa.io — Web Push trên iOS 16.4](https://pwa.io/articles/web-push-with-ios-safari-16-4-made-easy)
- [Telegram — mã hoá đầu cuối (bot không tham gia secret chat)](https://core.telegram.org/api/end-to-end)
- [Microsoft — UAC trên màn hình an toàn](https://learn.microsoft.com/en-us/archive/blogs/uac/user-account-control-prompts-on-the-secure-desktop) ·
  [polkit — agent xác thực giả](https://www.mail-archive.com/polkit-devel@lists.freedesktop.org/msg00605.html)
