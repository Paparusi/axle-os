# Nhận diện Axle OS

Do Bi thiết kế (19/9/2026). Claude chỉ tích hợp, không vẽ lại.

| File | Là gì | Dùng cho |
|---|---|---|
| `axle-mark.png` | Logo chữ A, **nền trong suốt** (RGBA 1254×1254) | Màn khởi động (Plymouth), GRUB, biểu tượng, favicon |
| `axle-wordmark-dark.png` | Logo + chữ "Axle OS" + khẩu hiệu, nền đen | Màn đăng nhập, trang giới thiệu |
| `brand-board.png` | Bảng nhận diện: màu, font, màn khởi động/đăng nhập/desktop mẫu | Tham chiếu khi dựng bản Desktop |
| `palette.json` | Màu + font + khẩu hiệu dạng mã | Mọi chỗ cần màu (terminal, Plymouth, web) |

**Màu:** Axle Blue `#3B82F6` · Cyan `#06B6D4` · Deep Dark `#0B0F14` · Graphite `#1A1F2B` · Slate `#2A3344` · Light `#E5E7EB`
**Font:** Inter · **Khẩu hiệu:** *Your OS. Your Intelligence.*

Axle Server không có màn hình → nhận diện ở dạng chữ (màn đăng nhập tại máy, lời chào SSH).
Axle Desktop dùng đủ: Plymouth, GRUB, màn đăng nhập, hình nền.
