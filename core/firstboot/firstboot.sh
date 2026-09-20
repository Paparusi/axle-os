#!/usr/bin/env bash
# Lần khởi động đầu sau khi cài bằng ISO Axle: cài Axle từ gói có chữ ký nằm sẵn trong ISO (kiểm chữ ký như mọi lần
# cài), trỏ `axle update` về nơi phát hành chính thức, nối trạm của Axle Cloud nếu ISO có ghi. Hỏng (vd chưa có mạng
# để cài gói hệ thống) → lần khởi động sau tự thử lại.
set -uo pipefail
D=/opt/axle-installer
ISSUE=/etc/issue.d/50-axle.issue
mkdir -p /etc/issue.d
echo "Axle: thiết lập lần đầu — cài Axle từ gói trong ISO…"
if ! bash "$D/install.sh" --from "$D"; then
  printf '%s\n' 'Axle chưa thiết lập xong (thiếu mạng?) — sẽ tự thử lại lần khởi động sau. Chi tiết: journalctl -u axle-firstboot' '' > "$ISSUE"
  exit 1
fi
# Cập nhật về sau lấy từ nơi phát hành chính thức (thư mục trong ISO sắp bị xoá)
if [ -s "$D/release-url" ]; then cat "$D/release-url" > /etc/axle/release-source; fi
if [ -s "$D/relay-url" ]; then axle app setup --relay "$(cat "$D/relay-url")" </dev/null || true; fi
printf '%s\n' "Axle Server sẵn sàng. Ghép điện thoại: sudo axle app pair · Xem lệnh: axle · Duyệt tại máy: sudo axle duyet" '' > "$ISSUE"
systemctl disable axle-firstboot.service
rm -rf "$D"
echo "✓ Axle Server đã sẵn sàng"
