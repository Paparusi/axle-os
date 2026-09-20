# Axle OS

**Hệ điều hành cho AI agent**, dựa trên Ubuntu 26.04 LTS. Agent làm việc thật trên máy của bạn; việc gì có thể
phá thì phải được bạn duyệt, và quyết định được ký bằng chip bảo mật trên điện thoại của bạn.

*An operating system for AI agents, based on Ubuntu 26.04 LTS. Agents do real work on your machine; anything
destructive needs your approval, signed by the secure chip in your phone. Server edition today, Desktop next.*

## Axle làm gì

- **Cổng MCP cho mọi agent**: Claude, OpenAI, agent tự viết… nối vào máy qua một cổng (stdio qua SSH, hoặc HTTP
  có token). Mỗi agent phụ là một tài khoản Linux riêng trong hộp cát; trợ lý chính dùng khoá SSH chỉ mở được MCP.
- **Duyệt 4 bậc**: chạy lệnh, khởi động lại dịch vụ, xoá, quay bản chụp phải được chủ duyệt — "lần này", "1 giờ",
  "luôn việc này"; lệnh root, xoá cả thư mục, quay hệ thống (bậc 3) luôn hỏi lại.
- **Duyệt ở đâu cũng được**: app Axle trên iPhone (mã hoá đầu cuối, quyết định ký bằng khoá trong Secure Enclave +
  Face ID, thông báo đẩy), bot Telegram của riêng bạn, hoặc ngay tại máy: `sudo axle duyet`.
- **Vault**: agent dùng khoá API mà không bao giờ thấy giá trị — `{{secret.TEN}}` được thay ở tầng mạng và chỉ gửi
  tới đúng máy chủ đã cho phép; phản hồi có lọt khoá cũng bị che.
- **Dừng khẩn cấp** một agent hay tất cả, **cấp quyền có hạn** (thư mục, mạng), **nhật ký lệnh agent không xoá được**
  (auditd), **bản chụp btrfs + `axle undo`**.
- **Lớp giao diện** (`sudo axle desktop on`): GNOME + gõ tiếng Việt + nhận diện Axle, cài thêm lên máy đang chạy
  Server, hỏng thì `axle undo`. Kèm **màn hình riêng cho agent** (`sudo axle agent screen <tên> on`): agent nhìn
  và bấm trong màn hình ảo của chính nó — không thấy màn hình của bạn, không có cửa sổ dòng lệnh, chỉ mở được app
  bạn cho phép; bạn xem lại bằng ảnh chụp hoặc chiếu trực tiếp.

## Cài bằng ISO (dễ nhất)

Tải ISO: **https://pub-849ee4c26f7749fa9139b27185298865.r2.dev/iso/axle-server-0.1.52.iso** (2,8 GB) ·
bản kê có chữ ký: [`latest-iso.json`](https://pub-849ee4c26f7749fa9139b27185298865.r2.dev/iso/latest-iso.json)
+ [`.sig`](https://pub-849ee4c26f7749fa9139b27185298865.r2.dev/iso/latest-iso.json.sig)

Ghi ra USB (Rufus, balenaEtcher, `dd`) → khởi động máy từ USB → chọn **"Cài Axle Server — XOÁ SẠCH ổ lớn nhất trong
máy"** → nhập tên, tên máy, mật khẩu. Máy **không tự chọn** mục nào: cắm nhầm máy thì không mất gì.

> ⚠️ Mục cài sẽ **xoá sạch ổ đĩa lớn nhất** trong máy. Rút hết ổ ngoài trước khi cài.

Cài xong, lần khởi động đầu máy tự cài Axle (5–15 phút, cần mạng) rồi báo ở màn đăng nhập.

## Cài lên máy Ubuntu có sẵn

Trên Ubuntu Server 26.04 với ổ hệ thống **btrfs** (máy thật hoặc máy ảo):

```bash
curl -fsSL https://github.com/Paparusi/axle-os/releases/latest/download/install.sh -o install.sh
sudo bash install.sh --from https://github.com/Paparusi/axle-os/releases/latest/download
```

Trình cài kiểm chữ ký Ed25519 của bản phát hành trước khi cài (khoá công khai: `core/release-key.pub.pem`) —
chữ ký sai là dừng, không cài gì. Cập nhật: `sudo axle update` (chụp hệ thống trước, không hạ cấp).
ISO cài sẵn Axle: sắp có.

Sau khi cài: `axle` (xem lệnh), `sudo axle agent add <tên>` (thêm agent), `sudo axle app pair` (ghép điện thoại),
`sudo axle approve setup --owner <id Telegram>` (duyệt qua Telegram).

## Bảo mật — tin vào điều gì

- Máy chỉ làm theo quyết định có chữ ký P-256 của điện thoại **đã ghép bằng mã QR + mã đối chiếu 6 số tại máy**,
  trên đúng mã băm của việc đang chờ. Trạm chuyển tiếp chỉ chở hộp đã mã hoá: không đọc được, không giả được,
  không duyệt thay được. Giao thức: [docs/APP-DUYET.md](docs/APP-DUYET.md).
- Mô hình quyền agent: [docs/QUYEN-AGENT.md](docs/QUYEN-AGENT.md). Kênh duyệt và mức tin cậy: [docs/KENH-DUYET.md](docs/KENH-DUYET.md).

## Mã nguồn mở và Axle Cloud

Hệ điều hành (repo này) là mã nguồn mở, giấy phép **Apache-2.0**. **Axle Cloud** — trạm chuyển tiếp, app điện
thoại, thông báo đẩy — là dịch vụ riêng và không bắt buộc: không dùng Cloud thì duyệt qua Telegram hoặc tại máy.

## Phát triển

```bash
cd mcp && npm ci && npm test        # luật vùng file, cổng MCP, vault, duyệt 4 bậc, giao thức
build/test-provision.sh             # máy ảo sạch từ đầu tới cuối (~20 phút)
build/test-release.sh               # đường phát hành: cài, chặn bản giả, cập nhật, chặn hạ cấp
```
