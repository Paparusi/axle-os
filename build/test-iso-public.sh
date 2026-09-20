#!/usr/bin/env bash
# Thử ISO Axle Server công khai trên máy ảo TRỐNG: dựng bản thử (điền sẵn tài khoản) → cài → khởi động → chờ
# axle-firstboot cài Axle từ gói trong ISO → kiểm. Không đụng máy ảo gốc của các bài thử khác (work/vm).
#   AXLE_PASSWORD='...' build/test-iso-public.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD}"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"; OVMF="$Q/usr/share/OVMF"
PORT=2226
RELAY_TEST="https://relay.thu.invalid"

echo "→ Dựng ISO bản thử"
"$ROOT/build/build-iso-public.sh" --test --relay "$RELAY_TEST" | tail -1
ISO="$(ls -t "$ROOT"/out/axle-server-*-THU-MAY-AO.iso | head -1)"
VER="$(basename "$ISO" | sed -E 's/axle-server-([0-9.]+)-THU.*/\1/')"

W="$ROOT/work/isovm"; rm -rf "$W"; mkdir -p "$W"
pkill -f "hostfwd=tcp::$PORT-" 2>/dev/null && sleep 2 || true
"$IMG" create -f qcow2 "$W/disk.qcow2" 25G >/dev/null
cp "$OVMF/OVMF_VARS_4M.fd" "$W/vars.fd"
"${XORRISO:-xorriso}" -osirrox on -indev "$ISO" \
  -extract /casper/vmlinuz "$W/vmlinuz" -extract /casper/initrd "$W/initrd" >/dev/null 2>&1
base=(-L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu"
  -enable-kvm -cpu host -m 3072 -smp 2 -display none
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd"
  -drive "if=pflash,format=raw,file=$W/vars.fd"
  -drive "file=$W/disk.qcow2,if=virtio,format=qcow2"
  -netdev user,id=n0,hostfwd=tcp::$PORT-:22 -device virtio-net-pci,netdev=n0)

echo "→ Cài từ ISO (10–15 phút)"
"$QEMU" "${base[@]}" -drive "file=$ISO,if=virtio,format=raw,readonly=on" \
  -kernel "$W/vmlinuz" -initrd "$W/initrd" -append "autoinstall console=ttyS0 ---" \
  -serial "file:$W/install.log" -no-reboot
# "finish: subiquity/Install/install:" cũng in ra KHI LỖI (kèm câu lỗi) → phải bắt cả dấu hiệu lỗi
if grep -aqE 'An error occurred|Command execution failure' "$W/install.log"; then
  echo "✗ Trình cài báo lỗi:" >&2
  tr -d '\000' < "$W/install.log" | grep -aE 'Command execution failure|returned non-zero' | tail -3 >&2
  exit 1
fi
grep -aq 'finish: subiquity/Install/install: $' "$W/install.log" || grep -aq 'subiquity/Shutdown' "$W/install.log" \
  || { echo "✗ Cài KHÔNG xong — xem $W/install.log" >&2; exit 1; }
echo "  ✓ cài xong"

echo "→ Khởi động máy vừa cài, chờ axle-firstboot cài Axle (tối đa 30 phút)"
"$QEMU" "${base[@]}" -serial "file:$W/boot.log" & PID=$!
SSHO=(-i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=5 -o LogLevel=ERROR)
vm() { ssh "${SSHO[@]}" admin_1@localhost "$@"; }
trap 'ssh "${SSHO[@]}" admin_1@localhost sync 2>/dev/null; kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do vm true 2>/dev/null && break; sleep 5; done
done_=0
for _ in $(seq 1 180); do
  if vm '[ ! -e /opt/axle-installer ] && [ -f /etc/axle/version ]' 2>/dev/null; then done_=1; break; fi
  sleep 10
done

set +e
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
[ "$done_" = 1 ]; ok $? "axle-firstboot cài xong và tự dọn /opt/axle-installer"
[[ "$(vm 'cat /etc/axle/version')" == "$VER "* ]]; ok $? "Axle $VER từ gói trong ISO"
vm 'systemctl is-active --quiet axle-approve axle-vault axle-mcp-http'; ok $? "dịch vụ duyệt, vault, cổng MCP đang chạy"
[ "$(vm 'systemctl is-enabled axle-firstboot 2>/dev/null')" = disabled ]; ok $? "firstboot tự tắt (không chạy lại lần sau)"
[ "$(vm 'cat /etc/axle/owner')" = admin_1 ]; ok $? "chủ máy = tài khoản tạo lúc cài (uid 1000)"
vm 'grep -q github.com/Paparusi/axle-os /etc/axle/release-source'; ok $? "axle update trỏ về nơi phát hành chính thức"
vm "grep -q '$RELAY_TEST' /etc/axle/app.json"; ok $? "tự nối trạm chuyển tiếp mặc định của ISO"
vm 'grep -q "sẵn sàng" /etc/issue.d/50-axle.issue && grep -q "Axle Server" /etc/issue'; ok $? "màn đăng nhập báo Axle sẵn sàng + cách ghép điện thoại"
[ "$(vm 'findmnt -no FSTYPE /')" = btrfs ]; ok $? "ổ hệ thống btrfs"
vm 'journalctl -u axle-firstboot --no-pager -o cat | grep -q "Axle Server .* đã sẵn sàng"'; ok $? "nhật ký firstboot ghi đủ"

if [ "$fail" != 0 ]; then echo "✗ $fail mục hỏng"; vm 'journalctl -u axle-firstboot --no-pager -o cat | tail -30'; exit 1; fi
echo "✓ ISO công khai đạt"
