# App Axle — giao thức duyệt từ điện thoại (v1)

Mục tiêu: nhiều người dùng, máy Axle nằm sau modem, điện thoại ở đâu cũng duyệt được — **mà trạm chuyển tiếp
không đọc được, không giả được, không tự duyệt được.** Mô hình giống Duo / Microsoft Authenticator, dựa trên ý của
chuẩn CIBA (xem docs/KENH-DUYET.md).

```
máy Axle ──(gọi ra)──▶ TRẠM CHUYỂN TIẾP ◀──(gọi ra)── app Axle trên điện thoại
             hộp thư mã hoá đầu cuối; trạm chỉ thấy ai gửi cho ai, bao nhiêu byte, lúc nào
```

## Khoá

| Bên | Khoá | Dùng để |
|---|---|---|
| Máy | Ed25519 (`me`) | Ký mọi tin gửi đi + xác thực với trạm |
| Máy | X25519 (`mx`) | Nhận tin mã hoá |
| Điện thoại | Ed25519 (`de`), trong kho an toàn của máy | Ký tin thường + xác thực với trạm |
| Điện thoại | X25519 (`dx`) | Nhận tin mã hoá |
| Điện thoại | **P-256 trong chip bảo mật** (`ds`), mỗi lần ký phải **vân tay/Face ID** | Ký **quyết định duyệt** và lệnh dừng khẩn cấp |

`id` của mỗi bên = base64url(sha256(khoá Ed25519)) cắt 32 ký tự — tự chứng minh, trạm không cấp phát được.

## Hộp mã hoá (`seal` / `open`)

Người gửi tạo cặp X25519 dùng một lần `eph`; `k = HKDF-SHA256(X25519(eph, người_nhận.x), salt = eph.pub ‖ người_nhận.x,
info = "axle-box-v1")`; nội dung = ChaCha20-Poly1305(k, nonce 12 byte ngẫu nhiên). Bên trong là
`{ from, msg, sig }` với `sig` = Ed25519 của người gửi trên `from ‖ JSON(msg)` — trạm không chèn được tin giả.

## Ghép cặp

1. `sudo axle app pair` → máy tạo mã ngẫu nhiên 128 bit, gửi trạm **băm** của mã (trạm không biết mã) → in QR:
   `axle1:` + base64url(JSON `{ r: url trạm, m: id máy, e: me, x: mx, c: mã, n: tên máy }`).
2. App quét QR → gửi tới trạm `POST /v1/pair { m, code, box }`, `box` gửi cho máy chứa
   `{ type: "pair", code, name, de, dx, ds }`. Trạm chỉ chuyển nếu băm của mã khớp và còn hạn (10 phút), rồi xoá.
3. Máy mở hộp, kiểm mã → tính **mã đối chiếu 6 số** = sha256(`mx ‖ dx ‖ mã`) → số. Máy in mã đó, app cũng hiện mã đó;
   chủ thấy **khớp** mới gõ `yes` tại máy (chống trạm tráo khoá).
4. Máy lưu điện thoại và cho phép nó gửi vào hộp thư của máy; điện thoại cũng tự cho phép máy.

## Tin nhắn

| Chiều | `msg.type` | Nội dung |
|---|---|---|
| máy → app | `request` | `id`, `hash`, `tier`, `agent`, `action`, `text` (mô tả đầy đủ), `buttons`, `expires` |
| máy → app | `update` | `id`, `state` (đã quyết ở kênh khác / hết hạn / xong) |
| app → máy | `decision` | `id`, `hash`, `decision` (`a` lần này · `h` 1 giờ · `l` luôn · `r` từ chối), `ts`, **`dsig`** |
| app → máy | `stop` / `start` | `agent`, `ts`, **`dsig`** (dừng khẩn cấp / mở lại) |
| app → máy | `query` | `what` (`status` · `so`) — hỏi, chỉ đọc, không cần chữ ký duyệt |
| máy → app | `state` | `what`, `data` — trả lời câu hỏi trên. `so` (từ 0.1.121): `host`, `homNay` {chu_duyet, tu_duyet, tu_choi, het_han}, `agents`, `so` [~40 việc: id, luc, agent, action, viec (một dòng, KHÔNG có lệnh đầy đủ), tu_duyet, quyet_dinh a/h/l/r, via, ket_qua, exitCode] — cùng nội dung bộ duyệt công bố cho Bàn, bỏ pending, cắt cho vừa hộp (`approve/mota.js banChoApp`, thử `approve/test-mota.mjs`) |
| app → máy | `task` | `task`, `ts`, **`dsig`** — việc nhanh trong danh sách đóng của máy |
| máy → app | `task-result` | `task`, `ok`, `text` |
| app → máy | `shell` | `cmd`, `ts`, **`dsig`** — gõ lệnh; máy mặc định TẮT đường này |
| máy → app | `shell-result` | `ok`, `code`, `user`, `text` (cắt 1500 ký tự) |
| app → máy | `hoi` | `cau`, `tiep`, `phien` (UUID cuộc: máy `--session-id` lần đầu, `--resume` các lần sau), `ts`, **`dsig`** — hỏi Axle (chat, D11): máy chạy `axle claude --dong` bằng tài khoản chủ; ký băm câu hỏi (`hoiString`), mỗi mốc giờ một lần; mặc định BẬT (`sudo axle app hoi off` để tắt) |
| máy → app | `hoi-chunk` | `text` — chữ chảy về (gộp 0,7 giây một lần, ≤3000 ký tự/khúc, tổng ≤60.000) |
| máy → app | `hoi-result` | `ok`, `code`, `text` (gợi ý khi hỏng: chưa đăng nhập Claude, quá giờ…) |
| app → máy | `task` = `hoi-dung` | dừng câu đang trả lời của chính điện thoại đó (ký như việc nhanh); máy trả `task-result` + `hoi-result` "Đã dừng theo yêu cầu" |

`hash` = sha256 của JSON chuẩn hoá `{ id, action, params, client, nonce }` — **đúng việc đã chốt lúc xin**.
`taskString` = `axle-task-v1|<id máy>|<tên việc>|<ts>`. Mỗi `(việc, ts)` máy chỉ làm **một lần** (chặn phát lại
trong cửa sổ 10 phút). Danh sách việc nằm ở phía MÁY và không nhận tham số — app chỉ gọi được tên:

| Tên việc | Máy làm gì |
|---|---|
| `khoa-man-hinh` | `loginctl lock-sessions` |
| `chup-anh` | `axle snapshot "từ điện thoại"` |
| `cap-nhat` | `axle update` (chạy tách qua `systemd-run`, vì bản mới khởi động lại chính bộ duyệt) |
| `khoi-dong-lai` | trả lời cho app trước, 2 giây sau `systemctl reboot` |

Không bao giờ nhận chuỗi lệnh từ điện thoại: mất điện thoại (mà mở khoá được) thì kẻ lấy được chừng ấy nút,
không phải cả cái máy.

`shellString` = `axle-shell-v1|<id máy>|<base64url(sha256(lệnh))>|<ts>`; `hoiString` = `axle-hoi-v1|<id máy>|<base64url(sha256(câu hỏi))>|<ts>` — ký **băm của nội dung lệnh**, nên
chữ ký chỉ đúng với đúng chuỗi lệnh đó; nối thêm một chữ vào lệnh là chữ ký hỏng.

Gõ lệnh **mặc định TẮT** (`sudo axle app terminal on [--root]`, tắt: `off`). Bật rồi thì:
chạy bằng **tài khoản chủ**, không phải root, trừ khi chủ tự bật `--root`; hạn 60 giây; kết quả cắt còn
1500 ký tự cho lọt hộp 64KB; mọi lệnh vào `axle approve log` và `axle cmdlog`.

Đây là chỗ DUY NHẤT trong kênh app cho điện thoại gửi nội dung tuỳ ý sang máy — mấy đường còn lại chỉ gửi
được tên việc. Vì vậy nó tách riêng, mặc định tắt, và không bật kèm theo bất cứ bước cài đặt nào.

`state` gói tình trạng máy (ổ, RAM, uptime, tải, agent, ảnh hệ thống, dịch vụ hỏng) — 408 byte, có bài thử
`approve/test-machine-state.mjs` chặn lọt đường dẫn nhà / khoá / mật khẩu ra trạm chuyển tiếp.

`dsig` = ECDSA P-256 (khoá trong chip, vân tay) trên chuỗi
`axle-approve-v1|<id máy>|<id yêu cầu>|<hash>|<decision>|<ts>`. Máy chỉ làm theo khi: điện thoại đã ghép cặp,
chữ ký đúng, `hash` khớp đúng yêu cầu đang chờ, `ts` trong 10 phút. Duyệt qua app đạt **mức tin cậy T3** →
duyệt được cả bậc 3.

## Trạm chuyển tiếp (`relay/`)

HTTP, không dùng thư viện ngoài. Mỗi lời gọi ký Ed25519 trên `METHOD ‖ path ‖ ts ‖ sha256(body)`
(header `x-axle-id`, `x-axle-pub`, `x-axle-ts`, `x-axle-sig`).

| Lời gọi | Việc |
|---|---|
| `POST /v1/pairing` (máy) | Mở chỗ ghép cặp: `{ codeHash, expires }` |
| `POST /v1/pair` (app, **không cần id cũ**) | Gửi hộp ghép cặp kèm `code`; trạm kiểm băm, chuyển cho máy, xoá chỗ |
| `POST /v1/link` (mỗi bên) | "Cho phép peer gửi vào hộp thư **của tôi**" — không ai mở được hộp thư của người khác |
| `POST /v1/send` | Gửi hộp cho bên đã liên kết |
| `GET /v1/inbox?after=<n>&wait=<giây>` | Nhận hộp (chờ dài tối đa 25 giây); tin `≤ after` coi như đã nhận, bị xoá |
| `POST /v1/push-token` (app) | Đăng ký thông báo đẩy (A4) |

Giới hạn: hộp ≤ 64 KB, tối đa 500 tin chờ mỗi bên, tin sống 7 ngày, 120 lời gọi/phút mỗi id.
Trạm sập → chỉ mất kênh app; Telegram / `sudo axle duyet` vẫn dùng được; yêu cầu hết hạn thì không chạy.
