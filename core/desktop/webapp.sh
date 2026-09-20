#!/usr/bin/env bash
# Biến một địa chỉ web thành APP THẬT trên máy: có cửa sổ riêng, có icon, ghim được vào dock.
#   sudo axle webapp them <tên> <địa chỉ> ["Tên hiện"] [--icon /đường/dẫn.png]
#   sudo axle webapp bo <tên>
#   axle webapp            — liệt kê
#
# Vì sao nằm trong Axle chứ không để người dùng tự tạo shortcut: mỗi web app tạo ra ĐỒNG THỜI hai thứ
#   1. một mục trong trình đơn ứng dụng — cho người dùng
#   2. một mục trong danh sách trắng /etc/axle/screen-apps.json — cho agent mở trên màn hình riêng của nó
# Nhờ vậy việc chuyển dần từ người sang agent không phải dựng hệ thống thứ hai: cùng một app, cùng một tên.
set -euo pipefail

APPS=/etc/axle/screen-apps.json
BINDIR=/usr/local/bin
DESKDIR=/usr/share/applications
OWNER="$(cat /etc/axle/owner 2>/dev/null || getent passwd 1000 | cut -d: -f1)"

can_root() { [ "$(id -u)" = 0 ] || { echo "Cần sudo: sudo axle webapp $*" >&2; exit 1; }; }
trinh_duyet() {
  local c
  for c in /snap/bin/chromium /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

lietke() {
  local co=0
  for f in "$BINDIR"/axle-web-*; do
    [ -e "$f" ] || continue
    co=1
    local ten="${f##*/axle-web-}"
    printf '  %-16s %s\n' "$ten" "$(sed -n 's/.*--app=\([^ ]*\).*/\1/p' "$f" | head -1)"
  done
  [ "$co" = 1 ] || echo "  (chưa có web app nào — thêm: sudo axle webapp them cargo https://… )"
}

them() {
  local ten="${1:-}" url="${2:-}" hien="${3:-}" icon="applications-internet"
  shift 3 2>/dev/null || shift $#
  while [ $# -gt 0 ]; do
    case "$1" in
      --icon) icon="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done
  [[ "$ten" =~ ^[a-z][a-z0-9-]{1,20}$ ]] || { echo "Tên chỉ gồm chữ thường, số, gạch ngang (2-21 ký tự)" >&2; exit 2; }
  [[ "$url" =~ ^https?://[A-Za-z0-9._~:/?#@!$\&\'\(\)*+,\;=%-]+$ ]] || { echo "Địa chỉ phải bắt đầu bằng http:// hoặc https://" >&2; exit 2; }
  local td; td="$(trinh_duyet)" || { echo "Chưa có Chromium — cài: sudo snap install chromium" >&2; exit 1; }
  [ -n "$hien" ] || hien="$ten"

  # Bọc thành một tệp chạy được: danh sách trắng của agent chỉ trỏ tới tệp này, không nhận URL tuỳ ý.
  # Mỗi app một hồ sơ riêng → đăng nhập Cargo không đá đăng nhập PGX, và agent không dùng chung phiên với chủ.
  cat > "$BINDIR/axle-web-$ten" <<EOF
#!/bin/sh
# Sinh bởi: axle webapp them $ten $url
exec "$td" --app=$url --user-data-dir="\$HOME/.local/share/axle-web/$ten" --class=axle-web-$ten "\$@"
EOF
  chmod 0755 "$BINDIR/axle-web-$ten"

  cat > "$DESKDIR/axle-web-$ten.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$hien
Comment=$url
Exec=$BINDIR/axle-web-$ten
Icon=$icon
Terminal=false
Categories=Network;Office;
StartupWMClass=axle-web-$ten
EOF
  chmod 0644 "$DESKDIR/axle-web-$ten.desktop"
  update-desktop-database "$DESKDIR" >/dev/null 2>&1 || true

  # Cùng cái tên đó cho agent: `screen_open` với key "$ten" mở đúng app này trên màn hình riêng của nó
  install -d /etc/axle
  [ -f "$APPS" ] || echo '{}' > "$APPS"
  local tmp; tmp="$(mktemp)"
  jq --arg k "$ten" --arg v "$BINDIR/axle-web-$ten" '.[$k] = $v' "$APPS" > "$tmp" && mv "$tmp" "$APPS"
  chmod 0644 "$APPS"

  echo "✓ $hien"
  echo "  app cho người dùng: có trong trình đơn ứng dụng (ghim: sudo axle webapp ghim $ten)"
  echo "  app cho agent:      screen_open '$ten'"
}

bo() {
  local ten="${1:-}"
  [[ "$ten" =~ ^[a-z][a-z0-9-]{1,20}$ ]] || { echo "Thiếu tên" >&2; exit 2; }
  rm -f "$BINDIR/axle-web-$ten" "$DESKDIR/axle-web-$ten.desktop"
  if [ -f "$APPS" ]; then
    local tmp; tmp="$(mktemp)"
    jq --arg k "$ten" 'del(.[$k])' "$APPS" > "$tmp" && mv "$tmp" "$APPS"
    chmod 0644 "$APPS"
  fi
  update-desktop-database "$DESKDIR" >/dev/null 2>&1 || true
  echo "Đã bỏ $ten (hồ sơ đăng nhập vẫn còn ở ~/.local/share/axle-web/$ten — xoá tay nếu muốn)"
}

ghim() {
  local ten="${1:-}" d="axle-web-${1:-}.desktop"
  [ -f "$DESKDIR/$d" ] || { echo "Chưa có web app '$ten'" >&2; exit 1; }
  # Ghim cho CHỦ MÁY qua phiên đồ hoạ của họ; đây là lựa chọn của người dùng nên không đụng mặc định hệ thống
  local uid; uid="$(id -u "$OWNER")"
  sudo -u "$OWNER" env "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus" bash -c "
    cur=\$(gsettings get org.gnome.shell favorite-apps)
    case \"\$cur\" in *'$d'*) echo '  (đã ghim từ trước)'; exit 0 ;; esac
    gsettings set org.gnome.shell favorite-apps \"\${cur%]}, '$d']\"
    echo '  đã ghim vào dock'
  " 2>/dev/null || echo "  (chưa ghim được — cần chủ máy đang đăng nhập giao diện; hoặc bấm chuột phải vào app → Pin to Dash)"
}

case "${1:-list}" in
  them)  can_root them; shift; them "$@" ;;
  bo)    can_root bo; shift; bo "$@" ;;
  ghim)  can_root ghim; shift; ghim "$@" ;;
  list)  lietke ;;
  *)     echo "sudo axle webapp them <tên> <địa chỉ> [\"Tên hiện\"] [--icon tệp.png] | bo <tên> | ghim <tên> · axle webapp" >&2; exit 2 ;;
esac
