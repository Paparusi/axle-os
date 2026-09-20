#!/usr/bin/env bash
# Lớp giao diện của Axle (docs/DESKTOP.md, nhịp D1): GNOME + gõ tiếng Việt + nhận diện Axle + bộ văn phòng.
# Cài THÊM lên máy đang chạy Axle Server, không cài lại máy; chụp bản hệ thống trước nên hỏng thì `axle undo`.
#   sudo axle desktop on
# Gõ tiếng Việt dùng IBus Unikey: GNOME 50 chỉ còn Wayland và chỉ nhận IBus, fcitx5 không ăn.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng sudo" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"          # …/core/desktop
ROOT="$(cd "$HERE/../.." && pwd)"              # …/  (thường là /opt/axle)
[ -f /etc/axle/version ] || { echo "Chưa có Axle Server trên máy này" >&2; exit 1; }
AXLE_USER="$(cat /etc/axle/owner 2>/dev/null || getent passwd 1000 | cut -d: -f1)"
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
. "$ROOT/core/lib/apt.sh"
apt_hold_timers

step "Chụp hệ thống trước khi thêm giao diện"
if command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
  snapper -c root create -t single -c number -d "trước khi cài Axle Desktop" >/dev/null || true
  echo "  xong (hỏng thì: sudo axle undo)"
else
  echo "  bỏ qua: máy không có snapper"
fi

step "GNOME"
aptg update -q
aptg install -yq ubuntu-desktop-minimal gnome-tweaks dconf-cli >/dev/null
echo "  $(dpkg-query -W -f='${Version}' gnome-shell 2>/dev/null)"

step "Gõ tiếng Việt (IBus Unikey) + phông chữ"
aptg install -yq ibus ibus-unikey fonts-noto-core language-pack-vi >/dev/null
echo "  ibus-unikey $(dpkg-query -W -f='${Version}' ibus-unikey 2>/dev/null) · gõ Telex, chuyển bộ gõ bằng Super+Space"

step "Bộ văn phòng"
aptg install -yq libreoffice-writer libreoffice-calc libreoffice-impress >/dev/null
echo "  LibreOffice $(dpkg-query -W -f='${Version}' libreoffice-writer 2>/dev/null | cut -d: -f2 | cut -d- -f1)"

step "Nhận diện Axle"
install -d /usr/share/axle
install -m 0644 "$ROOT/branding/wallpaper-dark.png" /usr/share/axle/wallpaper.png
install -m 0644 "$ROOT/branding/logo-320.png" /usr/share/axle/logo.png
# Mặc định cho mọi người dùng (họ vẫn đổi được): nền tối, màu nhấn Axle Blue, ảnh nền, bộ gõ tiếng Việt
install -d /etc/dconf/db/axle.d /etc/dconf/db/gdm.d
rm -f /etc/dconf/db/axle.d/00-axle
cat > /etc/dconf/db/axle.d/99-axle <<'EOF'
[org/gnome/desktop/background]
picture-uri='file:///usr/share/axle/wallpaper.png'
picture-uri-dark='file:///usr/share/axle/wallpaper.png'
picture-options='zoom'
primary-color='#0B0F14'

[org/gnome/desktop/screensaver]
picture-uri='file:///usr/share/axle/wallpaper.png'
primary-color='#0B0F14'

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
accent-color='blue'
clock-show-weekday=true

[org/gnome/desktop/input-sources]
sources=[('xkb', 'us'), ('ibus', 'Unikey')]
per-window=false

[org/gnome/shell]
favorite-apps=['firefox_firefox.desktop', 'org.gnome.Nautilus.desktop', 'org.gnome.Console.desktop', 'libreoffice-writer.desktop']
EOF
rm -f /etc/dconf/db/gdm.d/00-axle
cat > /etc/dconf/db/gdm.d/99-axle <<'EOF'
[org/gnome/login-screen]
logo='/usr/share/axle/logo.png'
banner-message-enable=true
banner-message-text='Axle OS — dựa trên Ubuntu'

[org/gnome/desktop/interface]
color-scheme='prefer-dark'
accent-color='blue'
EOF
grep -q '^system-db:axle' /etc/dconf/profile/user 2>/dev/null || printf '%s\n' 'user-db:user' 'system-db:axle' > /etc/dconf/profile/user
dconf update
echo "  ảnh nền, màu nhấn, logo màn đăng nhập"

# Màn khởi động: dùng bộ spinner của Ubuntu nhưng thay hình chìm bằng logo Axle
if [ -f /usr/share/plymouth/themes/spinner/spinner.plymouth ]; then
  rm -rf /usr/share/plymouth/themes/axle
  cp -a /usr/share/plymouth/themes/spinner /usr/share/plymouth/themes/axle
  cp /usr/share/axle/logo.png /usr/share/plymouth/themes/axle/watermark.png
  mv /usr/share/plymouth/themes/axle/spinner.plymouth /usr/share/plymouth/themes/axle/axle.plymouth
  sed -i -e 's|^Name=.*|Name=Axle|' -e 's|^Description=.*|Description=Axle OS|' \
    -e 's|themes/spinner|themes/axle|g' /usr/share/plymouth/themes/axle/axle.plymouth
  update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth \
    /usr/share/plymouth/themes/axle/axle.plymouth 200 >/dev/null
  update-alternatives --set default.plymouth /usr/share/plymouth/themes/axle/axle.plymouth >/dev/null
  update-initramfs -u >/dev/null 2>&1
  echo "  màn khởi động: logo Axle"
fi

step "Bật màn hình đăng nhập"
systemctl set-default graphical.target >/dev/null
systemctl enable gdm3 >/dev/null 2>&1 || systemctl enable gdm >/dev/null 2>&1 || true
echo "  bật từ lần khởi động sau (giữ nguyên phiên đang chạy)"

step "Xong — khởi động lại để vào giao diện: sudo reboot"
echo "  đăng nhập bằng tài khoản $AXLE_USER · gõ tiếng Việt: Super+Space"
echo "  tắt giao diện, quay lại chế độ máy chủ: sudo axle desktop off"
