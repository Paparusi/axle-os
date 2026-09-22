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
# AXLE_DESKTOP_REFRESH=1 (do `axle update` gọi khi máy đã có giao diện): CHỈ chép tệp và ghi mặc định, bỏ mọi bước
# tải gói (GNOME, văn phòng, snap, initramfs) — vài giây thay vì 10–25 phút, và không cần mạng.
LAM_MOI="${AXLE_DESKTOP_REFRESH:-}"
. "$ROOT/core/lib/apt.sh"
. "$ROOT/core/lib/brand.sh"
apt_hold_timers

# Kho gói/cửa hàng snap nấc một cái (408, đứt mạng) là hỏng cả lần cài → thử lại vài lần
apt_try() {
  local n=0
  until aptg install -yq "$@" >/dev/null; do
    n=$((n + 1))
    [ "$n" -ge 3 ] && return 1
    echo "  kho gói lỗi tạm — thử lại lần $n sau 20 giây"
    sleep 20
    aptg update -q >/dev/null || true
  done
}

step "Chụp hệ thống trước khi thêm giao diện"
if [ -n "$LAM_MOI" ]; then
  echo "  bỏ qua (làm mới từ axle update — provision đã chụp)"
elif command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
  snapper -c root create -t single -c number -d "trước khi cài Axle Desktop" >/dev/null || true
  echo "  xong (hỏng thì: sudo axle undo)"
else
  echo "  bỏ qua: máy không có snapper"
fi

if [ -z "$LAM_MOI" ]; then
step "GNOME"
# Lần trước cài dở (mạng đứt, cửa hàng snap lỗi) thì dpkg còn gói chưa cấu hình xong → dọn trước
dpkg --configure -a >/dev/null 2>&1 || true
aptg update -q
# "firefox-" = KHÔNG kéo gói firefox (nó chỉ là gói vỏ gọi snap): cửa hàng snap lỗi một cái là chết cả
# lần cài giao diện. Trình duyệt cài riêng ở bước sau, hỏng thì cũng không sao.
apt_try ubuntu-desktop-minimal firefox- gnome-tweaks dconf-cli || { echo "✗ không cài được GNOME (kho gói lỗi)" >&2; exit 1; }
echo "  $(dpkg-query -W -f='${Version}' gnome-shell 2>/dev/null)"

step "Gõ tiếng Việt (IBus Unikey) + phông chữ"
aptg install -yq ibus ibus-unikey fonts-noto-core language-pack-vi fonts-inter >/dev/null
echo "  ibus-unikey $(dpkg-query -W -f='${Version}' ibus-unikey 2>/dev/null) · gõ Telex, chuyển bộ gõ bằng Super+Space"
fi

step "Cổng chia sẻ màn hình (để agent xin xem màn hình của chủ — docs/DESKTOP.md D3)"
# Tay cho mọi ứng dụng (axle tay, D8): đọc cây trợ năng cần gir1.2-atspi-2.0 — gói nhỏ, lúc làm mới cũng cài nếu thiếu
dpkg -s gir1.2-atspi-2.0 >/dev/null 2>&1 || apt_try gir1.2-atspi-2.0 || echo "  (chưa cài được gir1.2-atspi-2.0 — axle tay chưa dùng được)"
# Đồ thị liên kết Bộ não trên Bàn vẽ bằng cairo → cần cầu nối python3-gi-cairo (gói nhỏ, làm mới cũng cài nếu thiếu)
dpkg -s python3-gi-cairo >/dev/null 2>&1 || apt_try python3-gi-cairo || echo "  (chưa cài được python3-gi-cairo — Bàn không vẽ được đồ thị liên kết)"
[ -n "$LAM_MOI" ] || apt_try xdg-desktop-portal-gnome python3-gi gir1.2-gst-plugins-base-1.0 gstreamer1.0-pipewire gstreamer1.0-plugins-good \
  || echo "  (chưa cài được, thử lại sau: sudo apt install python3-gi gstreamer1.0-pipewire)"
install -m 0644 "$ROOT/core/desktop/portal/axle-portal.service" /etc/systemd/user/axle-portal.service
systemctl --global enable axle-portal.service >/dev/null 2>&1 || true
systemctl daemon-reload
echo "  chụp thử: axle screen chup (GNOME sẽ hỏi chọn màn hình)"
echo "  cho agent xem màn hình: sudo axle agent grant <tên> man-hinh --han 30m"

step "Trình duyệt"
BROWSER_APP=""
if [ -f /var/lib/snapd/desktop/applications/firefox_firefox.desktop ]; then
  BROWSER_APP=firefox_firefox.desktop; echo "  Firefox (snap) đã có"
# Máy VP 22/9 cài xong không có trình duyệt nào (snap lỗi lúc cài) và làm mới cũng không cài lại → cả LÀM MỚI
# cũng thử, nhưng có hạn giờ để một lần `axle update` không treo vì cửa hàng snap.
elif timeout 300 snap install firefox >/dev/null 2>&1 || timeout 300 snap install firefox >/dev/null 2>&1; then
  BROWSER_APP=firefox_firefox.desktop; echo "  Firefox (snap)"
else
  echo "  cửa hàng snap đang lỗi — CHƯA có trình duyệt. Cài sau: sudo snap install firefox"
fi

step "Bộ văn phòng"
[ -n "$LAM_MOI" ] || apt_try libreoffice-writer libreoffice-calc libreoffice-impress || echo "  (chưa cài được bộ văn phòng, cài lại sau: sudo apt install libreoffice-writer)"
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

step "Cửa sổ Axle (bật/tắt mọi thứ không cần dòng lệnh)"
# Tới trước hôm nay mọi sức mạnh của Axle đều nằm sau `sudo axle …`; người cài xong mà không ai chỉ thì
# chỉ thấy một bản Ubuntu đổi màu. Cửa sổ này đưa tính năng đã có ra khỏi terminal: xem tình trạng máy,
# ghép điện thoại bằng mã QR hiện ngay trên màn hình, bật/tắt đăng nhập bằng điện thoại và gõ lệnh từ app.
install -m 0755 "$HERE/axle-gui.py" /usr/local/bin/axle-gui
cat > /usr/share/applications/vn.axleos.Axle.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Axle
Comment=Tình trạng máy, ghép điện thoại, bật tắt tính năng
Exec=/usr/local/bin/axle-gui
Icon=axle
Terminal=false
Categories=System;Settings;
StartupWMClass=vn.axleos.Axle
EOF
chmod 0644 /usr/share/applications/vn.axleos.Axle.desktop
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

# Bàn Axle làm MẶT TIỀN (21/9): đăng nhập xong là vào Bàn — máy đang làm gì, có gì cần mình, bảo Axle làm —
# chứ không rơi vào một màn hình nền trống như Ubuntu. Ubuntu-desktop vẫn ở ngay dưới ("Chế độ tay" thu Bàn
# xuống), Super+B gọi Bàn về. Autostart hệ thống: mọi tài khoản đều có; ai không muốn thì tắt trong Tweaks.
cat > /etc/xdg/autostart/vn.axleos.Ban.desktop <<'DESK'
[Desktop Entry]
Type=Application
Name=Bàn Axle
Comment=Mặt tiền Axle: việc đang làm, việc cần bạn, bảo Axle làm
Exec=/usr/local/bin/axle-gui --ban
Icon=axle
Terminal=false
OnlyShowIn=GNOME;
X-GNOME-Autostart-Phase=Applications
X-GNOME-Autostart-Delay=2
DESK
chmod 0644 /etc/xdg/autostart/vn.axleos.Ban.desktop
echo "  Bàn Axle mở to ngay sau khi đăng nhập · Super+B gọi về · trình đơn ứng dụng: \"Axle\""

step "Bộ ứng dụng văn phòng"
# Máy làm việc thật thì ngày nào cũng cần: mở PDF (vận đơn, hoá đơn), xem ảnh, quét giấy tờ, giải nén,
# thêm máy in. Ubuntu bản tối giản không kèm mấy thứ này. Tên gói trên 26.04: papers thay evince,
# loupe thay eog, 7zip thay p7zip-full.
[ -n "$LAM_MOI" ] || apt_try papers loupe simple-scan file-roller 7zip gnome-text-editor system-config-printer fonts-noto-core \
  || apt_try evince eog simple-scan file-roller gnome-text-editor system-config-printer fonts-noto-core \
  || echo "  (một số gói không cài được — máy vẫn chạy)"
echo "  PDF, ảnh, máy quét, nén, máy in, soạn thảo nhanh"

# Chromium: mở web app thành CỬA SỔ RIÊNG (--app=) chứ không phải tab lẫn trong trình duyệt, và cũng là
# thứ agent điều khiển được. Để NGOÀI đường găng: kho snap lỗi 408 một cái là hỏng cả lần cài (bài học D4).
if ! command -v chromium >/dev/null 2>&1 && [ ! -x /snap/bin/chromium ]; then
  timeout 300 snap install chromium >/dev/null 2>&1 && echo "  chromium (cho web app dạng cửa sổ riêng)" \
    || echo "  ! chưa cài được chromium — chạy lại sau: sudo snap install chromium"
fi

# Hai thứ văn phòng Việt Nam ngày nào cũng mở mà Linux không có bản cài: Zalo và hộp thư.
# Zalo có bản gói lại do người ngoài làm — KHÔNG dùng, không rõ nguồn. Đường sạch là chạy bản web trong
# cửa sổ riêng. Chỉ tạo nếu chưa có, để người dùng xoá rồi thì lần cài sau không tự mọc lại.
if command -v chromium >/dev/null 2>&1 || [ -x /snap/bin/chromium ]; then
  for w in "zalo|https://chat.zalo.me|Zalo|internet-chat" "gmail|https://mail.google.com|Gmail|internet-mail"; do
    IFS='|' read -r wten wurl whien wicon <<<"$w"
    # `[ … ] && continue` mà điều kiện sai là trả về 1 → set -e giết cả script. Luôn dùng if cho tường minh.
    if [ ! -f "/usr/share/applications/axle-web-$wten.desktop" ]; then
      if bash "$HERE/webapp.sh" them "$wten" "$wurl" "$whien" --icon "$wicon" >/dev/null 2>&1; then
        echo "  $whien (bản web, cửa sổ riêng)"
      fi
    fi
  done
fi

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
# Chỉ ghim app CÓ THẬT trên máy (thiếu trình duyệt hay bộ văn phòng thì bỏ, đừng ghim icon rỗng)
FAVS=""
for a in vn.axleos.Axle.desktop "$BROWSER_APP" axle-web-zalo.desktop axle-web-gmail.desktop org.gnome.Nautilus.desktop "$TERM_APP" \
         libreoffice-calc.desktop libreoffice-writer.desktop org.gnome.Papers.desktop org.gnome.Evince.desktop; do
  [ -n "$a" ] || continue
  [ -f "/usr/share/applications/$a" ] || [ -f "/var/lib/snapd/desktop/applications/$a" ] || continue
  FAVS="$FAVS${FAVS:+, }'$a'"
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
# Mọi ứng dụng (kể cả Chromium, LibreOffice) tự mô tả mình qua AT-SPI — axle tay mới đọc và bấm được (D8).
# (heredoc này không bọc nháy vì cần FAVS: KHÔNG viết dấu huyền hay dollar-ngoặc trong comment — bash sẽ chạy nó)
toolkit-accessibility=true
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
favorite-apps=[$FAVS]

# Super+B: gọi Bàn Axle về (đang mở thì đưa lên trước; chưa mở thì mở to)
[org/gnome/settings-daemon/plugins/media-keys]
custom-keybindings=['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/axle-ban/']

[org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/axle-ban]
name='Bàn Axle'
command='/usr/local/bin/axle-gui --ban'
binding='<Super>b'
EOF
rm -f /etc/dconf/db/gdm.d/00-axle
# Máy VP 22/9: với profile Axle, màn đăng nhập chỉ còn nền + đồng hồ, không có hộp đăng nhập (máy nhà cùng cấu hình
# thì có). Chưa rõ vì sao → có lối thoát: `sudo touch /etc/axle/no-gdm-branding` (hoặc còn bản lưu
# /root/gdm-profile.bak do người dùng tự gỡ) thì KHÔNG đè profile của GDM nữa, màn đăng nhập về nguyên bản Ubuntu.
if [ -e /etc/axle/no-gdm-branding ] || [ -e /root/gdm-profile.bak ]; then
  echo "  màn đăng nhập: giữ nguyên bản Ubuntu (có /etc/axle/no-gdm-branding hoặc /root/gdm-profile.bak)"
  rm -f /etc/dconf/profile/gdm
else
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

# Màn đăng nhập KHÔNG bao giờ được chạy bộ gõ tiếng Việt: mật khẩu không có dấu, mà Telex biến
# "a"+"r" thành "ả", "w" thành "ư"… → gõ đúng vẫn bị từ chối, không ai hiểu vì sao (gặp thật 20/9).
[org/gnome/desktop/input-sources]
sources=[('xkb', 'us')]
EOF
# Debian/Ubuntu KHÔNG cho màn đăng nhập đọc /etc/dconf/db/gdm: profile của họ (/usr/share/dconf/profile/gdm)
# chỉ có user-db + file-db greeter-dconf-defaults → mọi thứ mình ghi ở trên bị bỏ qua, màn đăng nhập vẫn
# nguyên logo Ubuntu. Đặt profile riêng ở /etc (đè /usr/share) và chèn system-db:gdm lên trước file-db.
{ printf '%s\n' 'user-db:user' 'system-db:gdm'
  for f in /var/lib/gdm3/greeter-dconf-defaults /var/lib/gdm/greeter-dconf-defaults; do
    [ -f "$f" ] && printf 'file-db:%s\n' "$f"
  done
} > /etc/dconf/profile/gdm
# logo phải là tệp thật: khoá logo trỏ vào tệp không có thì hộp đăng nhập của gnome-shell có thể không dựng được
[ -s /usr/share/axle/logo.png ] || sed -i '/^logo=/d' /etc/dconf/db/gdm.d/99-axle
fi
grep -q '^system-db:axle' /etc/dconf/profile/user 2>/dev/null || printf '%s\n' 'user-db:user' 'system-db:axle' > /etc/dconf/profile/user
dconf update

# Bi chốt: tắt cửa sổ "Software Updater" của Ubuntu (nó nhảy lên che màn hình và đứng trên dock).
# CHỈ tắt phần nhắc — unattended-upgrades vẫn tự cài bản vá bảo mật như cũ.
# apport: cửa sổ "Authentication Required — collect system information for this problem report" nhảy lên
# ĐÒI MẬT KHẨU để gửi báo cáo sự cố về Canonical. Máy của Axle thì không, tắt hẳn.
sed -i 's/^enabled=.*/enabled=0/' /etc/default/apport 2>/dev/null || true
systemctl disable --now apport.service >/dev/null 2>&1 || true

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
# (update-initramfs mất 20–40 giây → lúc làm mới chỉ làm nếu chưa có bộ Axle)
if [ -f /usr/share/plymouth/themes/spinner/spinner.plymouth ] && { [ -z "$LAM_MOI" ] || [ ! -f /usr/share/plymouth/themes/axle/axle.plymouth ]; }; then
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

# Plymouth chỉ vẽ logo khi nhân được bảo "quiet splash". Bản cài tự động của Ubuntu để
# GRUB_CMDLINE_LINUX_DEFAULT rỗng → máy khởi động ra một màn chữ trắng lổn nhổn, chủ máy tưởng hỏng.
# Chỉ thêm ở bản có giao diện; bản máy chủ giữ nguyên chữ cho dễ soi lỗi.
G=/etc/default/grub
if [ -f "$G" ]; then
  cu="$(sed -n 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"$/\1/p' "$G" | head -1)"
  moi="$cu"
  for o in quiet splash; do
    case " $moi " in *" $o "*) ;; *) moi="${moi:+$moi }$o" ;; esac
  done
  if [ "$moi" != "$cu" ]; then
    if grep -q '^GRUB_CMDLINE_LINUX_DEFAULT=' "$G"; then
      sed -i "s|^GRUB_CMDLINE_LINUX_DEFAULT=.*|GRUB_CMDLINE_LINUX_DEFAULT=\"$moi\"|" "$G"
    else
      printf 'GRUB_CMDLINE_LINUX_DEFAULT="%s"\n' "$moi" >> "$G"
    fi
    update-grub >/dev/null 2>&1 || true
    echo "  khởi động im lặng + hiện logo thay vì chữ trắng"
  fi
fi

step "Một bộ quản lý mạng thôi"
# Bản Server cài từ ISO dùng systemd-networkd; cài thêm lớp giao diện thì GNOME kéo NetworkManager vào.
# Để cả hai cùng chạy là tranh route/DNS, và mỗi lần khởi động phải chờ HAI dịch vụ "wait-online"
# (đo trên máy văn phòng 20/9: 6,7s + 4,5s). Giao diện thì để NetworkManager cầm, tắt hẳn networkd.
if systemctl is-enabled --quiet NetworkManager 2>/dev/null; then
  for f in /etc/netplan/*.yaml; do
    [ -f "$f" ] || continue
    grep -q 'renderer:.*NetworkManager' "$f" || sed -i 's/^\(\s*\)version: 2/\1version: 2\n\1renderer: NetworkManager/' "$f"
  done
  chmod 0600 /etc/netplan/*.yaml 2>/dev/null || true
  netplan generate >/dev/null 2>&1 || true
  systemctl disable --now systemd-networkd-wait-online.service >/dev/null 2>&1 || true
  systemctl disable --now systemd-networkd.service systemd-networkd.socket >/dev/null 2>&1 || true
  echo "  NetworkManager cầm mạng, tắt systemd-networkd (đỡ ~11 giây mỗi lần khởi động)"
fi

step "Bật màn hình đăng nhập"
systemctl set-default graphical.target >/dev/null
systemctl enable gdm3 >/dev/null 2>&1 || systemctl enable gdm >/dev/null 2>&1 || true

# Màn đăng nhập chỉ đọc dconf MỘT LẦN lúc nó bật. Chạy `axle desktop on` trên máy đã có giao diện thì
# màn đăng nhập vẫn là đồ cũ cho tới khi khởi động lại — người dùng tưởng cài hỏng. Không ai đang đăng nhập
# thì nạp lại luôn cho thấy ngay; có người đang dùng thì TUYỆT ĐỐI không đụng, chỉ nhắc.
co_nguoi_dang_dung_man_hinh() {
  local s cls typ
  for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    cls="$(loginctl show-session "$s" -p Class --value 2>/dev/null || true)"
    typ="$(loginctl show-session "$s" -p Type --value 2>/dev/null || true)"
    [ "$cls" = user ] && { [ "$typ" = wayland ] || [ "$typ" = x11 ]; } && return 0
  done
  return 1
}
if systemctl is-active --quiet gdm3 2>/dev/null || systemctl is-active --quiet gdm 2>/dev/null; then
  if co_nguoi_dang_dung_man_hinh; then
    echo "  có người đang đăng nhập → màn hình đăng nhập đổi sau khi khởi động lại"
  else
    systemctl restart gdm3 >/dev/null 2>&1 || systemctl restart gdm >/dev/null 2>&1 || true
    echo "  màn hình đăng nhập: nạp lại ngay (không ai đang đăng nhập)"
  fi
else
  echo "  bật từ lần khởi động sau (giữ nguyên phiên đang chạy)"
fi

if [ -n "$LAM_MOI" ]; then
  step "Lớp giao diện đã làm mới theo bản này"
  echo "  Bàn Axle mới hiện từ lần đăng nhập sau (đang mở thì đóng rồi bấm Super+B)"
  exit 0
fi
step "Xong — khởi động lại để vào giao diện: sudo reboot"
echo "  đăng nhập bằng tài khoản $AXLE_USER · gõ tiếng Việt: Super+Space"
echo "  tắt giao diện, quay lại chế độ máy chủ: sudo axle desktop off"
