#!/usr/bin/env bash
# Thử "màn hình riêng của agent" (docs/DESKTOP.md D2) trên máy ảo SẠCH:
# provision → tạo agent phụ → bật màn hình → agent tự mở app, chụp ảnh, bấm chuột/phím → tắt màn hình.
#   AXLE_PASSWORD='...' build/test-agent-display.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD}"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"; OVMF="$Q/usr/share/OVMF"
BASE="$ROOT/work/vm"; PORT=2228
[ -f "$BASE/disk.qcow2" ] || { echo "Chưa có máy ảo gốc — chạy build/test-vm.sh trước" >&2; exit 1; }

W="$ROOT/work/dispvm"; rm -rf "$W"; mkdir -p "$W"
"$IMG" create -f qcow2 -b "$BASE/disk.qcow2" -F qcow2 "$W/disk.qcow2" >/dev/null
cp "$BASE/vars.fd" "$W/vars.fd"
"$QEMU" -L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu" \
  -enable-kvm -cpu host -m 3072 -smp 2 -display none \
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd" \
  -drive "if=pflash,format=raw,file=$W/vars.fd" \
  -drive "file=$W/disk.qcow2,if=virtio,format=qcow2" \
  -netdev user,id=n0,hostfwd=tcp::$PORT-:22 -device virtio-net-pci,netdev=n0 \
  -serial "file:$W/boot.log" & PID=$!
SSHO=(-i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=5 -o LogLevel=ERROR)
vm() { ssh "${SSHO[@]}" admin_1@localhost "$@"; }
sudo_vm() { printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c '$1 </dev/null'"; }
trap 'ssh "${SSHO[@]}" admin_1@localhost sync 2>/dev/null; kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do vm true 2>/dev/null && break; sleep 5; done
vm true 2>/dev/null || { echo "✗ máy ảo không lên" >&2; exit 1; }

echo "→ Cài Axle Server"
rsync -a --exclude work --exclude out --exclude cache -e "ssh ${SSHO[*]}" "$ROOT/" admin_1@localhost:/tmp/axle/
sudo_vm 'exec env AXLE_HOSTNAME=axle-disp bash /tmp/axle/core/provision.sh' > "$W/provision.log" 2>&1 \
  || { tail -5 "$W/provision.log"; echo "✗ provision lỗi" >&2; exit 1; }
echo "  ✓ Axle $(vm 'cat /etc/axle/version')"

echo "→ Tạo agent phụ + bật màn hình riêng (cài Xvfb, vài phút)"
TOKEN="$(sudo_vm 'axle agent add thu --preset status' | grep '^axle_')"
[ -n "$TOKEN" ] || { echo "✗ không lấy được token agent" >&2; exit 1; }
sudo_vm 'axle agent screen thu on --kich-thuoc 1024x768' > "$W/screen-on.log" 2>&1 || { cat "$W/screen-on.log"; exit 1; }
sed 's/^/    /' "$W/screen-on.log"
# Máy chủ (không có GNOME) thì chưa có app đồ hoạ nào — thêm một app vô hại để agent có cái mà mở
sudo_vm 'DEBIAN_FRONTEND=noninteractive apt-get install -yq x11-apps >/dev/null 2>&1; jq ".dongho = \"/usr/bin/xclock\"" /etc/axle/screen-apps.json > /tmp/a.json && install -m 0644 /tmp/a.json /etc/axle/screen-apps.json && systemctl restart axle-display@thu'

echo "→ Agent tự dùng màn hình của nó"
set +e
vm "cd /tmp/axle && node build/screen-smoke.mjs http://127.0.0.1:8765/mcp '$TOKEN'" 2>&1 | tee "$W/smoke.log"
smoke=${PIPESTATUS[0]}

fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
[ "$smoke" = 0 ]; ok $? "agent chụp/bấm được trong màn hình của chính nó"
vm 'systemctl is-active --quiet axle-display@thu'; ok $? "dịch vụ màn hình đang chạy"
vm 'test -S /tmp/.X11-unix/X90'; ok $? "màn hình :90 có thật"
[ "$(sudo_vm 'stat -c %a /home/ag-thu/.Xauthority' | tr -d '\r')" = 600 ]
ok $? "vé vào màn hình (.Xauthority) chỉ agent đọc được"
SHOT="$(sudo_vm 'axle agent screen thu anh' | tail -1)"
sudo_vm "test -s '$SHOT'"; ok $? "chủ chụp được màn hình của agent ($SHOT)"
sudo_vm 'axle agent screen thu off' >/dev/null; ok $? "tắt màn hình"
! vm 'systemctl is-active --quiet axle-display@thu'; ok $? "tắt xong dịch vụ dừng hẳn"
sudo_vm 'jq -e ".thu.tools | index(\"screen_shot\") | not" /etc/axle/mcp-clients.json' >/dev/null
ok $? "tắt xong thu hồi luôn công cụ screen_*"

if [ "$fail" != 0 ]; then echo "✗ $fail mục hỏng — xem $W"; exit 1; fi
echo "✓ màn hình riêng của agent đạt"
