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
. "$ROOT/core/lib/brand.sh"
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
aptg install -yq ibus ibus-unikey fonts-noto-core language-pack-vi fonts-inter >/dev/null
echo "  ibus-unikey $(dpkg-query -W -f='${Version}' ibus-unikey 2>/dev/null) · gõ Telex, chuyển bộ gõ bằng Super+Space"

step "Bộ văn phòng"
aptg install -yq libreoffice-writer libreoffice-calc libreoffice-impress >/dev/null
echo "  LibreOffice $(dpkg-query -W -f='${Version}' libreoffice-writer 2>/dev/null | cut -d: -f2 | cut -d- -f1)"

step "Nhận diện Axle"
install -d /usr/share/axle
install -m 0644 "$ROOT/branding/wallpaper-dark.png" /usr/share/axle/wallpaper.png
install -m 0644 "$ROOT/branding/logo-320.png" /usr/share/axle/logo.png
# Biểu tượng hệ điều hành (màn "Giới thiệu", cửa sổ hệ thống) — LOGO=axle trong /etc/os-release trỏ về đây
for s in 48 64 128 256; do
  [ -f "$ROOT/branding/icons/axle-$s.png" ] &&
    install -Dm0644 "$ROOT/branding/icons/axle-$s.png" "/usr/share/icons/hicolor/${s}x${s}/apps/axle.png"
done
gtk-update-icon-cache -qf /usr/share/icons/hicolor 2>/dev/null || true

brand_os_release   # tên hệ điều hành: "Axle OS ... (dựa trên Ubuntu ...)", giữ ID=ubuntu

# Nút "Hiện ứng dụng" ở thanh dock lấy icon theo chế độ phiên (`view-app-grid-ubuntu-symbolic` = logo Ubuntu).
# Đổi sang lưới chấm trung tính của Yaru — không mượn nhãn hiệu Ubuntu làm nhận diện Axle.
UBGRID=/usr/share/icons/Yaru/scalable/actions/view-app-grid-ubuntu-symbolic.svg
PLAIN=/usr/share/icons/Yaru/scalable/actions/view-app-grid-symbolic.svg
if [ -f "$PLAIN" ] && [ "$(dpkg-divert --truename "$UBGRID")" = "$UBGRID" ]; then
  dpkg-divert --quiet --local --rename --divert "$UBGRID.ubuntu" --add "$UBGRID"   # nâng cấp gói không ghi đè
fi
[ -f "$PLAIN" ] && [ -f "$UBGRID.ubuntu" ] && install -m 0644 "$PLAIN" "$UBGRID"
gtk-update-icon-cache -qf /usr/share/icons/Yaru 2>/dev/null || true

# Cửa sổ dòng lệnh: 26.04 thay GNOME Console bằng Ptyxis → chọn cái thật sự có trên máy
TERM_APP=org.gnome.Ptyxis.desktop
for c in org.gnome.Ptyxis.desktop org.gnome.Console.desktop org.gnome.Terminal.desktop; do
  [ -f "/usr/share/applications/$c" ] && { TERM_APP="$c"; break; }
done

# Mặc định cho mọi người dùng (họ vẫn đổi được): nền tối, màu nhấn Axle Blue, ảnh nền, bộ gõ tiếng Việt
install -d /etc/dconf/db/axle.d /etc/dconf/db/gdm.d
rm -f /etc/dconf/db/axle.d/00-axle
cat > /etc/dconf/db/axle.d/99-axle <<EOF
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
icon-theme='Yaru-blue-dark'
clock-show-weekday=true
font-name='Inter 11'
document-font-name='Inter 11'
enable-hot-corners=true

# Nút cửa sổ nằm BÊN TRÁI như máy Mac (trước dấu ':' là bên trái)
[org/gnome/desktop/wm/preferences]
button-layout='close,minimize,maximize:'

# Thanh ứng dụng: dưới đáy, co lại giữa màn hình, tự ẩn khi cửa sổ chạm tới — kiểu Dock của Mac
[org/gnome/shell/extensions/dash-to-dock]
dock-position='BOTTOM'
extend-height=false
dock-fixed=false
intellihide=true
intellihide-mode='FOCUS_APPLICATION_WINDOWS'
autohide=true
show-apps-at-top=false
show-mounts=false
show-trash=false
custom-theme-shrink=true
dash-max-icon-size=48
transparency-mode='DYNAMIC'
running-indicator-style='DOTS'
click-action='minimize-or-previews'

# Màn hình nền để trống như Mac (Home/Thùng rác nằm trong Files và trên dock)
[org/gnome/shell/extensions/ding]
show-home=false
show-trash=false

[org/gnome/mutter]
dynamic-workspaces=true
edge-tiling=true

[org/gnome/desktop/input-sources]
sources=[('xkb', 'us'), ('ibus', 'Unikey')]
per-window=false

[org/gnome/shell]
favorite-apps=['firefox_firefox.desktop', 'org.gnome.Nautilus.desktop', '$TERM_APP', 'libreoffice-writer.desktop']
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
icon-theme='Yaru-blue-dark'

# Màn đăng nhập cũng lấy ảnh nền Axle (không thì lúc chưa vẽ xong vẫn là ảnh nền Ubuntu)
[org/gnome/desktop/background]
picture-uri='file:///usr/share/axle/wallpaper.png'
picture-uri-dark='file:///usr/share/axle/wallpaper.png'
picture-options='zoom'
primary-color='#0B0F14'

# Màn đăng nhập không cần thanh ứng dụng ("@as []" = mảng chuỗi rỗng; viết "[]" trơn thì dconf không đoán được kiểu)
[org/gnome/shell]
favorite-apps=@as []
EOF
# Debian/Ubuntu KHÔNG cho màn đăng nhập đọc /etc/dconf/db/gdm: profile của họ (/usr/share/dconf/profile/gdm)
# chỉ có user-db + file-db greeter-dconf-defaults → mọi thứ mình ghi ở trên bị bỏ qua, màn đăng nhập vẫn
# nguyên logo Ubuntu. Đặt profile riêng ở /etc (đè /usr/share) và chèn system-db:gdm lên trước file-db.
{ printf '%s\n' 'user-db:user' 'system-db:gdm'
  for f in /var/lib/gdm3/greeter-dconf-defaults /var/lib/gdm/greeter-dconf-defaults; do
    [ -f "$f" ] && printf 'file-db:%s\n' "$f"
  done
} > /etc/dconf/profile/gdm
grep -q '^system-db:axle' /etc/dconf/profile/user 2>/dev/null || printf '%s\n' 'user-db:user' 'system-db:axle' > /etc/dconf/profile/user
dconf update

# Bi chốt: tắt cửa sổ "Software Updater" của Ubuntu (nó nhảy lên che màn hình và đứng trên dock).
# CHỈ tắt phần nhắc — unattended-upgrades vẫn tự cài bản vá bảo mật như cũ.
UN=/etc/xdg/autostart/update-notifier.desktop
if [ -f "$UN" ] && [ "$(dpkg-divert --truename "$UN")" = "$UN" ]; then
  dpkg-divert --quiet --local --rename --divert "$UN.ubuntu" --add "$UN"
fi
if [ -f "$UN.ubuntu" ]; then
  { cat "$UN.ubuntu"; printf '%s\n' 'Hidden=true' 'X-GNOME-Autostart-enabled=false'; } > "$UN"
  chmod 0644 "$UN"
fi

# Lần đăng nhập đầu, Ubuntu bật "gnome-initial-setup --upgrade-user" phủ kín màn hình làm việc bằng cửa sổ chào
# mừng của Ubuntu (người dùng tưởng máy vẫn là Ubuntu). Tắt cho mọi tài khoản.
systemctl --global mask gnome-initial-setup-first-login.service gnome-initial-setup-upgrade-login.service >/dev/null 2>&1 || true

echo "  ảnh nền, màu nhấn, logo màn đăng nhập, tên hệ điều hành, biểu tượng"

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
