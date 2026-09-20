#!/usr/bin/env bash
# Màn hình X ảo RIÊNG của một agent (docs/DESKTOP.md, nhịp D2). Chạy bằng chính user ag-<tên>
# qua dịch vụ axle-display@<tên>. Agent nhìn và bấm trong màn hình này, không đụng màn hình của chủ.
#   display-run.sh <tên agent>
#
# App do CHÍNH dịch vụ này mở (agent chỉ gửi TÊN app qua ống ~/.axle/screen-launch), vì hai lẽ:
#   1. app sống trong cgroup của màn hình, không chết theo máy chủ MCP và không bị bóp bởi hạn mức của nó;
#   2. danh sách app được phép do đây kiểm, agent không chen được lệnh tuỳ ý — muốn chạy lệnh phải qua
#      run_command để chủ duyệt.
set -euo pipefail

NAME="${1:?thiếu tên agent}"
CFG=/etc/axle/displays.json
APPS=/etc/axle/screen-apps.json
NUM="$(jq -r --arg n "$NAME" '.[$n].display // empty' "$CFG" 2>/dev/null || true)"
[ -n "$NUM" ] || { echo "Chưa cấp màn hình cho agent $NAME (sudo axle agent screen $NAME on)" >&2; exit 78; }
GEOM="$(jq -r --arg n "$NAME" '.[$n].geometry // "1440x900"' "$CFG")"
[[ "$GEOM" =~ ^[0-9]{3,4}x[0-9]{3,4}$ ]] || GEOM=1440x900

export DISPLAY=":$NUM"
export XAUTHORITY="$HOME/.Xauthority"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
FIFO="$HOME/.axle/screen-launch"
umask 077

# Vé vào màn hình: chỉ ai đọc được .Xauthority của agent mới nối được (root đọc được để chủ xem/chụp).
: > "$XAUTHORITY"
xauth -q add "$DISPLAY" MIT-MAGIC-COOKIE-1 "$(openssl rand -hex 16)"

pids=()
stop() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap stop EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 "${GEOM}x24" -auth "$XAUTHORITY" -nolisten tcp -dpi 96 &
pids+=($!)
for _ in $(seq 1 50); do [ -S "/tmp/.X11-unix/X$NUM" ] && break; sleep 0.2; done
[ -S "/tmp/.X11-unix/X$NUM" ] || { echo "Xvfb không lên" >&2; exit 1; }
xdotool getdisplaygeometry >/dev/null   # chắc chắn nối được bằng cookie vừa tạo

# Trình quản lý cửa sổ: có nó thì app mới có khung, phóng to, chuyển focus được
if command -v openbox >/dev/null; then openbox & pids+=($!)
elif command -v xfwm4 >/dev/null; then xfwm4 & pids+=($!)
fi
# Nền xám để ảnh chụp dễ nhìn (không có thì màn hình là lưới đen trắng của X)
command -v xsetroot >/dev/null && xsetroot -solid '#1B2430' || true

# Ống nhận yêu cầu mở app. Mở sẵn hai chiều để agent ghi vào không bao giờ bị kẹt chờ người đọc.
mkdir -p "$(dirname "$FIFO")"
rm -f "$FIFO"; mkfifo -m 0600 "$FIFO"
exec {fd}<> "$FIFO"
(
  while IFS=' ' read -r key arg <&$fd; do
    [[ "$key" =~ ^[a-z][a-z0-9-]{0,39}$ ]] || continue
    cmd="$(jq -r --arg k "$key" '.[$k] // empty' "$APPS" 2>/dev/null || true)"
    [ -n "$cmd" ] || { echo "từ chối mở '$key': không nằm trong danh sách app được phép"; continue; }
    [ -z "$arg" ] || [[ "$arg" =~ ^[[:alnum:]@%+=:,./~_-]{1,4096}$ ]] || { echo "từ chối tham số lạ"; continue; }
    echo "mở $key${arg:+ $arg}"
    setsid $cmd ${arg:+"$arg"} >/dev/null 2>&1 &
  done
) & pids+=($!)

echo "Màn hình $DISPLAY ($GEOM) của agent $NAME đã sẵn sàng"
wait -n "${pids[@]}"   # Xvfb hay WM chết thì dịch vụ chết theo để systemd dựng lại
