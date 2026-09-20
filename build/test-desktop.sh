#!/usr/bin/env bash
# Thử lớp giao diện trên máy ảo SẠCH: provision Axle Server → `axle desktop on` → khởi động lại → kiểm + CHỤP MÀN HÌNH
# thật của máy ảo (qua monitor của QEMU) để nhìn tận mắt màn đăng nhập.
#   AXLE_PASSWORD='...' build/test-desktop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD}"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"; OVMF="$Q/usr/share/OVMF"
BASE="$ROOT/work/vm"; PORT=2227
[ -f "$BASE/disk.qcow2" ] || { echo "Chưa có máy ảo gốc — chạy build/test-vm.sh trước" >&2; exit 1; }

W="$ROOT/work/deskvm"; rm -rf "$W"; mkdir -p "$W"
"$IMG" create -f qcow2 -b "$BASE/disk.qcow2" -F qcow2 "$W/disk.qcow2" >/dev/null
cp "$BASE/vars.fd" "$W/vars.fd"
boot() {   # $1 = tệp log serial
  "$QEMU" -L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu" \
    -enable-kvm -cpu host -m 3584 -smp 2 -display none -vga std \
    -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd" \
    -drive "if=pflash,format=raw,file=$W/vars.fd" \
    -drive "file=$W/disk.qcow2,if=virtio,format=qcow2" \
    -netdev user,id=n0,hostfwd=tcp::$PORT-:22 -device virtio-net-pci,netdev=n0 \
    -monitor "unix:$W/mon.sock,server,nowait" -serial "file:$1" & PID=$!
}
SSHO=(-i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=5 -o LogLevel=ERROR)
vm() { ssh "${SSHO[@]}" admin_1@localhost "$@"; }
sudo_vm() { printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c '$1 </dev/null'"; }
wait_ssh() { for _ in $(seq 1 60); do vm true 2>/dev/null && return 0; sleep 5; done; return 1; }
shot() {   # $1 = tên ảnh — chụp màn hình máy ảo qua monitor
  python3 - "$W/mon.sock" "$W/$1.ppm" <<'PY'
import socket, sys, time
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); time.sleep(0.4); s.recv(65536)
s.sendall(f"screendump {sys.argv[2]}\n".encode()); time.sleep(1.5); s.close()
PY
  python3 -c "from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2])" "$W/$1.ppm" "$W/$1.png" 2>/dev/null && rm -f "$W/$1.ppm"
}

boot "$W/boot1.log"
trap 'ssh "${SSHO[@]}" admin_1@localhost sync 2>/dev/null; kill $PID 2>/dev/null || true' EXIT
wait_ssh || { echo "✗ máy ảo không lên" >&2; exit 1; }

echo "→ Cài Axle Server (provision)"
rsync -a --exclude work --exclude out --exclude cache -e "ssh ${SSHO[*]}" "$ROOT/" admin_1@localhost:/tmp/axle/
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'exec env AXLE_HOSTNAME=axle-desk bash /tmp/axle/core/provision.sh </dev/null'" \
  > "$W/provision.log" 2>&1 || { tail -5 "$W/provision.log"; echo "✗ provision lỗi" >&2; exit 1; }
echo "  ✓ Axle Server $(vm 'cat /etc/axle/version')"

echo "→ axle desktop on (tải GNOME, 10–20 phút)"
sudo_vm 'axle desktop on' > "$W/desktop.log" 2>&1; rc=$?
sed 's/\x1b\[[0-9;]*m//g' "$W/desktop.log" | grep -E '^== |^  ' | tail -12 | sed 's/^/    /'
[ $rc = 0 ] || { echo "✗ axle desktop on lỗi" >&2; exit 1; }

echo "→ Khởi động lại vào giao diện"
sudo_vm 'systemctl reboot' >/dev/null 2>&1 || true
sleep 20
wait_ssh || { echo "✗ máy ảo không lên lại" >&2; exit 1; }
sleep 45   # chờ GDM vẽ xong màn đăng nhập
shot man-dang-nhap
vm 'grep -q "^logo=" /etc/dconf/db/gdm.d/99-axle' >/dev/null 2>&1 || true

# CHỈ ĐỂ THỬ: bật đăng nhập tự động để chụp được màn hình làm việc (bản thật không bật)
echo "→ Chụp màn hình làm việc (bật đăng nhập tự động, chỉ trong bài thử)"
sudo_vm 'printf "%s\n" "[daemon]" "AutomaticLoginEnable=true" "AutomaticLogin=admin_1" > /etc/gdm3/custom.conf; systemctl reboot' >/dev/null 2>&1 || true
sleep 25
wait_ssh || true
sleep 60
shot man-lam-viec

set +e
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
[ "$(vm 'systemctl get-default')" = graphical.target ]; ok $? "máy khởi động thẳng vào giao diện"
vm 'systemctl is-active --quiet gdm3 || systemctl is-active --quiet gdm'; ok $? "màn hình đăng nhập (GDM) đang chạy"
vm 'pgrep -f gnome-shell >/dev/null'; ok $? "GNOME Shell đang chạy"
vm 'dpkg-query -W ibus-unikey >/dev/null 2>&1'; ok $? "bộ gõ tiếng Việt IBus Unikey đã cài"
vm 'test -f /usr/share/axle/wallpaper.png -a -f /usr/share/axle/logo.png'; ok $? "ảnh nền + logo Axle có trên máy"
vm 'test -f /etc/dconf/db/axle && grep -q axle /etc/dconf/profile/user'; ok $? "mặc định giao diện Axle đã biên dịch (dconf)"
vm 'readlink -f /usr/share/plymouth/themes/default.plymouth | grep -q axle'; ok $? "màn khởi động dùng bộ Axle"
vm 'systemctl is-active --quiet axle-approve axle-vault axle-mcp-http'; ok $? "phần Server vẫn chạy nguyên (duyệt, vault, MCP)"
[ -s "$W/man-dang-nhap.png" ]; ok $? "chụp được màn hình máy ảo ($W/man-dang-nhap.png)"

if [ "$fail" != 0 ]; then echo "✗ $fail mục hỏng"; exit 1; fi
echo "✓ lớp giao diện đạt — ảnh màn đăng nhập: $W/man-dang-nhap.png"
