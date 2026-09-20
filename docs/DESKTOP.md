# Axle Desktop — thiết kế

Mục tiêu: máy để ngồi làm việc hằng ngày, và là chỗ **agent nhìn được màn hình và tự thao tác** — nhưng chủ máy
luôn thấy agent đang làm gì và cắt được bất cứ lúc nào.

## Nền

Axle Desktop = **Axle Server + lớp giao diện**, không phải hệ điều hành khác. Máy đang chạy Server nâng lên Desktop
bằng một lệnh (`sudo axle desktop on`), chụp bản btrfs trước nên hỏng thì `axle undo`. Mọi thứ của Server giữ nguyên:
cổng MCP, duyệt 4 bậc, vault, nhật ký lệnh, dừng khẩn cấp.

Đo trên Ubuntu 26.04 (máy thật axle-office, 20/9/2026):

| Gói | Bản trong kho chính thức | Ghi chú |
|---|---|---|
| `ubuntu-desktop-minimal` | 1.570.3 | GNOME 50 |
| `gnome-shell` / `gdm3` | 50.1 | **Chỉ còn Wayland** — `gnome-session-xsession` KHÔNG còn trong kho |
| `fcitx5` + `fcitx5-bamboo` | 5.1.19 + 1.0.9 | gõ tiếng Việt, không cần kho ngoài |
| `gnome-remote-desktop` | 50.2 | máy chủ RDP + chia sẻ màn hình |
| `xdg-desktop-portal-gnome`, `pipewire` | 50.0, 1.6.2 | cổng xin phép + luồng hình |
| `libreoffice-writer` | 26.2 | văn phòng tại chỗ |
| `kde-plasma-desktop`, `xfce4` | 5:166, 4.20.1 | phương án dự phòng (còn chạy X11) |
| `ydotool` | 1.0.4 | tiêm phím/chuột ở tầng nhân |

GNOME 50 bỏ hẳn phiên X11 → mọi cách "chụp màn hình + giả lập chuột" kiểu cũ (xdotool, scrot) **không dùng được**
trên màn hình thật. Đây là điều quyết định thiết kế bên dưới.

## Agent nhìn và điều khiển màn hình

Ba đường, Axle dùng cả ba nhưng cho việc khác nhau:

### 1. Màn hình RIÊNG của agent (mặc định)

Agent phụ có sẵn tài khoản riêng trong hộp cát; Desktop thêm cho nó **một phiên đồ hoạ riêng không gắn màn hình
thật** (GNOME headless hoặc XFCE trên Xvfb). Agent mở trình duyệt, soạn tài liệu, thao tác thoải mái trong đó.

- Agent **không thấy** màn hình của chủ: cửa sổ ngân hàng, tin nhắn, mật khẩu của chủ nằm ngoài tầm với.
- Chủ xem được: cửa sổ "Màn hình của agent" (chiếu luồng PipeWire / RDP tại chỗ), xem trực tiếp và giành lại quyền.
- Chụp màn hình và bấm phím trong phiên này không cần xin phép ai, vì đó là máy của chính agent → agent làm được
  việc thật mà không chạm vào đời sống riêng của chủ.

### 2. Màn hình THẬT của chủ — chỉ khi chủ cho phép từng lần

Dùng **xdg-desktop-portal** (`RemoteDesktop` + `ScreenCast`): GNOME hiện hộp thoại xin phép của hệ thống, chủ chọn
màn hình/cửa sổ được chia sẻ. Axle coi đây là **bậc 3**: phải duyệt trên điện thoại (Face ID), cấp có hạn giờ
(`axle agent grant <tên> man-hinh --han 30m`), hiện thanh "agent đang xem màn hình" và `axle agent stop` cắt ngay.

Không dùng D-Bus riêng của Mutter (`org.gnome.Mutter.RemoteDesktop`) để lách hộp thoại xin phép: lách được một lần
là mất luôn thứ khiến người ta dám cài Axle.

### 3. Tiêm phím/chuột ở tầng nhân (`ydotool`/uinput)

Không qua compositor nên không xin phép được và **không** chụp được màn hình. Chỉ cho phép **trong màn hình riêng
của agent** (mục 1) khi cần gõ vào phần mềm không nhận sự kiện của portal. Không bao giờ bật trên màn hình chủ.

## Nhận diện (dùng bộ của Bi trong `branding/`)

Màn khởi động (Plymouth) logo Axle · GDM nền tối + logo · hình nền · màu nhấn Axle Blue `#3B82F6` · thanh dock.
Ghi rõ "dựa trên Ubuntu" ở màn giới thiệu; không dùng logo Ubuntu làm nhận diện của Axle.

## Nhịp làm

- **D1** Lớp Desktop: `sudo axle desktop on` — GNOME + gõ tiếng Việt (fcitx5-bamboo, Telex) + nhận diện + LibreOffice.
  Thử trên máy ảo: cài xong chụp màn hình thật bằng QEMU để nhìn tận mắt.
- **D2** Màn hình riêng của agent: phiên đồ hoạ cho agent phụ + công cụ MCP `screen_shot`, `screen_click`,
  `screen_type` (chạy trong phiên của chính agent) + cửa sổ "Màn hình của agent" cho chủ xem.
- **D3** Chia sẻ màn hình thật qua portal: quyền bậc 3 có hạn giờ, thanh báo đang chia sẻ, thu hồi và dừng khẩn cấp.
- **D4** ISO Desktop công khai + tăng tốc phần cứng (driver GPU, Wi-Fi), đo RAM thật (máy 5 GB chạy GNOME có đủ không).
