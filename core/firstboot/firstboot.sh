#!/usr/bin/env bash
# Lần khởi động đầu sau khi cài bằng ISO Axle: cài Axle từ gói có chữ ký nằm sẵn trong ISO (kiểm chữ ký như mọi lần
# cài), trỏ `axle update` về nơi phát hành chính thức, nối trạm của Axle Cloud nếu ISO có ghi. Hỏng (vd chưa có mạng
# để cài gói hệ thống) → lần khởi động sau tự thử lại.
set -uo pipefail
D=/opt/axle-installer
ISSUE=/etc/issue.d/50-axle.issue
mkdir -p /etc/issue.d
echo "Axle: thiết lập lần đầu — cài Axle từ gói trong ISO…"
# Máy không có IPv4 (chỉ IPv6 do router tự phát) thì github.com không tới được → cài hỏng. Gặp trên máy VP 22/9:
# file mạng của trình cài thiếu dhcp4 vì lúc cài chưa có DHCP. Card dây đang UP mà không có IPv4 thì bật DHCPv4.
if ! ip -4 -o addr show scope global 2>/dev/null | grep -Eqv ' (docker|tailscale|br-|veth)'; then
  for nic in $(ip -o link show up 2>/dev/null | awk -F': ' '$2 ~ /^(en|eth)/ {print $2}'); do
    if ! grep -rqs 'dhcp4: *true' /etc/netplan/; then
      echo "→ $nic không có IPv4 và cấu hình mạng không xin DHCP — bật dhcp4"
      netplan set "ethernets.$nic.dhcp4=true" && netplan apply || true
    fi
  done
  for _ in $(seq 1 20); do ip -4 -o addr show scope global | grep -Eqv ' (docker|tailscale|br-|veth)' && break; sleep 1; done
fi
if ! bash "$D/install.sh" --from "$D"; then
  printf '%s\n' 'Axle chưa thiết lập xong (thiếu mạng?) — sẽ tự thử lại lần khởi động sau. Chi tiết: journalctl -u axle-firstboot' '' > "$ISSUE"
  exit 1
fi
# Cập nhật về sau lấy từ nơi phát hành chính thức (thư mục trong ISO sắp bị xoá)
if [ -s "$D/release-url" ]; then cat "$D/release-url" > /etc/axle/release-source; fi
if [ -s "$D/relay-url" ]; then axle app setup --relay "$(cat "$D/relay-url")" </dev/null || true; fi
EDITION="$(cat /etc/axle/edition 2>/dev/null || echo server)"
if [ "$EDITION" = desktop ]; then
  printf '%s\n' 'Axle đang cài lớp giao diện (10–25 phút, cần mạng) — tiến độ: journalctl -fu axle-firstboot' '' > "$ISSUE"
  echo "→ Cài lớp giao diện (axle desktop on)"
  if axle desktop on </dev/null; then
    printf '%s\n' 'Axle Desktop sẵn sàng — máy sẽ khởi động lại vào màn hình đăng nhập.' '' > "$ISSUE"
    systemctl disable axle-firstboot.service
    rm -rf "$D"
    echo "✓ Axle Desktop đã sẵn sàng — khởi động lại"
    systemctl reboot
    exit 0
  fi
  # Cài giao diện hỏng thì vẫn còn một máy chủ Axle chạy được; lần khởi động sau tự thử lại
  printf '%s\n' 'Axle Server sẵn sàng, nhưng CHƯA cài xong giao diện — sẽ thử lại lần khởi động sau (journalctl -u axle-firstboot).' '' > "$ISSUE"
  echo "✗ chưa cài được lớp giao diện — giữ axle-firstboot để thử lại"
  exit 1
fi
printf '%s\n' "Axle Server sẵn sàng. Ghép điện thoại: sudo axle app pair · Xem lệnh: axle · Duyệt tại máy: sudo axle duyet" '' > "$ISSUE"
systemctl disable axle-firstboot.service
rm -rf "$D"
echo "✓ Axle Server đã sẵn sàng"
