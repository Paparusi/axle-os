#!/usr/bin/env bash
# Màn hình riêng của agent (docs/DESKTOP.md, nhịp D2) — bật/tắt/xem.
#
#   sudo axle agent screen <tên> on [--kich-thuoc 1440x900] [--trinh-duyet]
#   sudo axle agent screen <tên> off
#        axle agent screen <tên> status
#   sudo axle agent screen <tên> anh          # chụp màn hình của agent cho chủ xem
#   sudo axle agent screen <tên> xem | ngung-xem   # chiếu trực tiếp (VNC 127.0.0.1, tự tắt sau 30 phút)
#
# Agent phụ nhìn và bấm TRONG màn hình này (công cụ screen_*), không cần duyệt vì đó là máy của chính nó.
# Màn hình THẬT của chủ không đi lối này — phải qua portal, bậc 3 (nhịp D3).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLIENTS=/etc/axle/mcp-clients.json
DISPLAYS=/etc/axle/displays.json
APPS=/etc/axle/screen-apps.json
SHOTS=/var/lib/axle/screens
# Bật màn hình riêng là cấp kèm cả bộ đọc web theo BẢNG PHẦN TỬ: agent mở web app trên màn hình của nó thì
# phải đọc được trang, chứ không chỉ bấm mò theo toạ độ.
SCREEN_TOOLS='["screen_shot","screen_windows","screen_open","screen_click","screen_type","screen_key","screen_scroll","web_snapshot","web_click","web_type","web_key","web_scroll","web_text"]'

NAME="${1:-}"; ACTION="${2:-status}"; shift 2 2>/dev/null || true
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,20}$ ]] || { echo "axle agent screen <tên> on|off|status|anh|xem|ngung-xem" >&2; exit 2; }
USER_="ag-$NAME"
need_root() { [ "$(id -u)" = 0 ] || { echo "Cần sudo: sudo axle agent screen $NAME $ACTION" >&2; exit 1; }; }
agent_json() { jq -r --arg n "$NAME" "$1" "$CLIENTS" 2>/dev/null || echo ""; }
dnum() { jq -r --arg n "$NAME" '.[$n].display // empty' "$DISPLAYS" 2>/dev/null || true; }

case "$ACTION" in
  on)
    need_root
    GEOM=1440x900; BROWSER=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --kich-thuoc) GEOM="${2:?}"; shift 2 ;;
        --trinh-duyet) BROWSER=1; shift ;;
        *) echo "Không hiểu: $1" >&2; exit 2 ;;
      esac
    done
    [[ "$GEOM" =~ ^[0-9]{3,4}x[0-9]{3,4}$ ]] || { echo "--kich-thuoc dạng 1440x900" >&2; exit 2; }
    [ "$(agent_json '.[$n].role // ""')" = phu ] || { echo "Chỉ agent phụ mới có màn hình riêng (agent $NAME không phải)" >&2; exit 1; }
    id "$USER_" >/dev/null 2>&1 || { echo "Không có user $USER_" >&2; exit 1; }

    # Gói cần cho một màn hình X ảo + chụp ảnh + bấm phím
    miss=()
    for p in xvfb xauth xdotool wmctrl openbox imagemagick x11-xserver-utils; do
      # gói đã gỡ vẫn còn trong sổ dpkg → phải soi trạng thái, không chỉ tên
      [ "$(dpkg-query -W -f='${Status}' "$p" 2>/dev/null)" = "install ok installed" ] || miss+=("$p")
    done
    if [ ${#miss[@]} -gt 0 ]; then
      echo "→ Cài ${miss[*]} (lần đầu, vài phút)"
      . "$ROOT/core/lib/apt.sh"; apt_hold_timers
      aptg update -q >/dev/null; aptg install -yq "${miss[@]}" >/dev/null
    fi

    # Số màn hình: chọn số trống trong 90..119, giữ nguyên nếu agent đã có
    [ -f "$DISPLAYS" ] || echo '{}' > "$DISPLAYS"
    NUM="$(dnum)"
    if [ -z "$NUM" ]; then
      used="$(jq -r '[.[].display] | join(" ")' "$DISPLAYS")"
      for n in $(seq 90 119); do
        grep -qw "$n" <<<"$used" || [ -e "/tmp/.X11-unix/X$n" ] || { NUM="$n"; break; }
      done
      [ -n "$NUM" ] || { echo "Hết số màn hình trống" >&2; exit 1; }
    fi
    tmp="$(mktemp)"
    jq --arg n "$NAME" --argjson d "$NUM" --arg g "$GEOM" --arg u "$USER_" \
      '.[$n] = {display: $d, geometry: $g, user: $u, since: (now | todate)}' "$DISPLAYS" > "$tmp"
    install -m 0644 "$tmp" "$DISPLAYS"; rm -f "$tmp"

    # App agent được mở trong màn hình của nó. KHÔNG bao giờ có cửa sổ dòng lệnh: chạy lệnh phải qua
    # run_command để chủ duyệt. Trình duyệt chỉ thêm khi chủ nói rõ (--trinh-duyet): agent thấy internet.
    if [ ! -f "$APPS" ]; then
      json='{}'
      pick() {   # $1 = tên agent gọi, còn lại = ứng viên, lấy cái đầu tiên có thật trên máy
        local key="$1"; shift
        local c
        for c in "$@"; do
          [ -x "$c" ] && { json="$(jq --arg k "$key" --arg v "$c" '.[$k] = $v' <<<"$json")"; return 0; }
        done
        return 0   # máy chủ không có app đồ hoạ nào là chuyện thường — đừng để set -e giết script
      }
      pick soanthao /usr/bin/gnome-text-editor /usr/bin/gedit
      pick tepdulieu /usr/bin/nautilus /usr/bin/nemo /usr/bin/thunar
      pick vanban /usr/bin/libreoffice
      pick anh /usr/bin/loupe /usr/bin/eog
      printf '%s\n' "$json" > "$APPS"
      chmod 0644 "$APPS"
    fi
    if [ "$BROWSER" = 1 ]; then
      for b in /usr/bin/firefox /usr/bin/chromium /usr/bin/epiphany-browser; do
        [ -x "$b" ] && { tmp="$(mktemp)"; jq --arg b "$b" '.trinhduyet = $b' "$APPS" > "$tmp"; install -m 0644 "$tmp" "$APPS"; rm -f "$tmp"; break; }
      done
    fi

    install -d -m 0755 "$SHOTS"
    install -m 0644 "$ROOT/core/desktop/axle-display@.service" /etc/systemd/system/axle-display@.service
    # /tmp xoá sạch mỗi lần khởi động → phải có sẵn thư mục socket X trước khi máy chủ MCP gắn nó vào
    printf '%s\n' 'd /tmp/.X11-unix 1777 root root -' > /etc/tmpfiles.d/axle-x11.conf
    systemd-tmpfiles --create /etc/tmpfiles.d/axle-x11.conf >/dev/null 2>&1 || install -d -m 1777 /tmp/.X11-unix

    # Máy chủ MCP của agent: biết màn hình của mình + thấy socket X (đang bị PrivateTmp che)
    dir="/etc/systemd/system/axle-mcp@$NAME.service.d"
    install -d "$dir"
    cat > "$dir/50-display.conf" <<EOF
[Unit]
After=axle-display@$NAME.service

[Service]
Environment=DISPLAY=:$NUM
Environment=XAUTHORITY=/home/$USER_/.Xauthority
Environment=AXLE_SCREEN_LAUNCH=/home/$USER_/.axle/screen-launch
# PrivateTmp=yes giấu mất /tmp/.X11-unix → gắn lại đúng thư mục socket X của máy ("-": thiếu thì bỏ qua,
# đừng để máy chủ MCP chết chỉ vì màn hình chưa lên)
BindPaths=-/tmp/.X11-unix
EOF
    # Công cụ màn hình vào đúng token của agent này
    tmp="$(mktemp)"
    jq --arg n "$NAME" --argjson s "$SCREEN_TOOLS" '.[$n].tools = ((.[$n].tools // []) + $s | unique)' "$CLIENTS" > "$tmp"
    install -o root -g axle-gw -m 0640 "$tmp" "$CLIENTS"; rm -f "$tmp"

    systemctl daemon-reload
    systemctl enable --now "axle-display@$NAME.service" >/dev/null
    systemctl is-active --quiet "axle-mcp@$NAME.service" && systemctl restart "axle-mcp@$NAME.service" || true
    sleep 1
    systemctl is-active --quiet "axle-display@$NAME.service" \
      || { echo "✗ màn hình không lên — xem: journalctl -u axle-display@$NAME -n 30" >&2; exit 1; }
    echo "Agent $NAME có màn hình riêng :$NUM ($GEOM)"
    echo "  app được mở: $(jq -r 'keys | join(", ")' "$APPS")"
    echo "  công cụ mới của agent: screen_shot, screen_windows, screen_open, screen_click, screen_type, screen_key, screen_scroll"
    echo "  xem agent đang làm gì: sudo axle agent screen $NAME anh (ảnh) · xem (chiếu trực tiếp)"
    echo "  tắt: sudo axle agent screen $NAME off" ;;

  off)
    need_root
    systemctl stop "axle-vnc@$NAME.service" 2>/dev/null || true; rm -f "/run/axle-vnc/$NAME"
    systemctl disable --now "axle-display@$NAME.service" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/axle-mcp@$NAME.service.d/50-display.conf"
    rmdir "/etc/systemd/system/axle-mcp@$NAME.service.d" 2>/dev/null || true
    [ -f "$DISPLAYS" ] && { tmp="$(mktemp)"; jq --arg n "$NAME" 'del(.[$n])' "$DISPLAYS" > "$tmp"; install -m 0644 "$tmp" "$DISPLAYS"; rm -f "$tmp"; }
    if [ -f "$CLIENTS" ]; then
      tmp="$(mktemp)"
      jq --arg n "$NAME" --argjson s "$SCREEN_TOOLS" '.[$n].tools = ((.[$n].tools // []) - $s)' "$CLIENTS" > "$tmp"
      install -o root -g axle-gw -m 0640 "$tmp" "$CLIENTS"; rm -f "$tmp"
    fi
    systemctl daemon-reload
    systemctl is-active --quiet "axle-mcp@$NAME.service" && systemctl restart "axle-mcp@$NAME.service" || true
    echo "Đã tắt màn hình riêng của agent $NAME (công cụ screen_* cũng thu hồi)" ;;

  status)
    NUM="$(dnum)"
    [ -n "$NUM" ] || { echo "Agent $NAME chưa có màn hình riêng (sudo axle agent screen $NAME on)"; exit 0; }
    echo "Màn hình :$NUM · $(jq -r --arg n "$NAME" '.[$n].geometry' "$DISPLAYS") · $(systemctl is-active "axle-display@$NAME.service")"
    echo "app được mở: $(jq -r 'keys | join(", ")' "$APPS" 2>/dev/null || echo '-')"
    if [ "$(id -u)" = 0 ] && [ -r "/home/$USER_/.Xauthority" ]; then
      wins="$(DISPLAY=":$NUM" XAUTHORITY="/home/$USER_/.Xauthority" wmctrl -l 2>/dev/null | wc -l)"
      echo "cửa sổ đang mở: $wins"
    fi ;;

  xem)   # chủ xem TRỰC TIẾP màn hình của agent (VNC chỉ mở ở 127.0.0.1, có mật khẩu, tự tắt sau 30 phút)
    need_root
    NUM="$(dnum)"; [ -n "$NUM" ] || { echo "Agent $NAME chưa có màn hình riêng" >&2; exit 1; }
    [ "$(dpkg-query -W -f='${Status}' x11vnc 2>/dev/null)" = "install ok installed" ] || {
      echo "→ Cài x11vnc"; . "$ROOT/core/lib/apt.sh"; apt_hold_timers; aptg install -yq x11vnc >/dev/null; }
    PORT=$((5900 + NUM - 90))
    PW="$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 12)"
    install -d -m 0700 /run/axle-vnc
    x11vnc -storepasswd "$PW" "/run/axle-vnc/$NAME" >/dev/null 2>&1
    systemctl stop "axle-vnc@$NAME.service" 2>/dev/null || true
    systemd-run --unit="axle-vnc@$NAME" --description="Chủ xem màn hình agent $NAME" --collect \
      /usr/bin/x11vnc -display ":$NUM" -auth "/home/$USER_/.Xauthority" -rfbauth "/run/axle-vnc/$NAME" \
      -rfbport "$PORT" -localhost -shared -forever -timeout 1800 -noxdamage -quiet >/dev/null
    echo "Đang chiếu màn hình agent $NAME tại 127.0.0.1:$PORT (tự tắt sau 30 phút)"
    echo "  tại máy này: xem bằng trình VNC bất kỳ → vnc://127.0.0.1:$PORT"
    echo "  từ máy khác: ssh -L $PORT:127.0.0.1:$PORT $(cat /etc/axle/owner 2>/dev/null || echo admin_1)@$(hostname) rồi mở vnc://127.0.0.1:$PORT"
    echo "  mật khẩu (dùng một lần này): $PW"
    echo "  ngừng chiếu: sudo axle agent screen $NAME ngung-xem" ;;

  ngung-xem)
    need_root
    systemctl stop "axle-vnc@$NAME.service" 2>/dev/null || true
    rm -f "/run/axle-vnc/$NAME"
    echo "Đã ngừng chiếu màn hình agent $NAME" ;;

  anh)
    need_root
    NUM="$(dnum)"; [ -n "$NUM" ] || { echo "Agent $NAME chưa có màn hình riêng" >&2; exit 1; }
    install -d -m 0755 "$SHOTS"
    out="$SHOTS/$NAME-$(date +%Y%m%d-%H%M%S).png"
    DISPLAY=":$NUM" XAUTHORITY="/home/$USER_/.Xauthority" import -window root "$out"
    chmod 0644 "$out"
    echo "$out" ;;

  *) echo "axle agent screen <tên> on|off|status|anh|xem|ngung-xem" >&2; exit 2 ;;
esac
