#!/usr/bin/env bash
# Chạy thử ISO Axle Server trên máy ảo UEFI: cài tự động, khởi động lại, SSH vào kiểm tra.
#
#   build/test-vm.sh out/axle-server-26.04.1.iso
#
# Biến môi trường:
#   QEMU_ROOT  thư mục gốc nếu qemu/OVMF được giải nén tay (mặc định dùng của hệ thống)
#   AXLE_SSH_PRIV  khoá riêng để SSH (mặc định ~/.ssh/id_ed25519)
set -euo pipefail

ISO="$(realpath "${1:?Cần đường dẫn ISO}")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"
OVMF="$Q/usr/share/OVMF"
W="$ROOT/work/vm"; rm -rf "$W"; mkdir -p "$W"

"$IMG" create -f qcow2 "$W/disk.qcow2" 25G >/dev/null
cp "$OVMF/OVMF_VARS_4M.fd" "$W/vars.fd"
"${XORRISO:-xorriso}" -osirrox on -indev "$ISO" \
  -extract /casper/vmlinuz "$W/vmlinuz" -extract /casper/initrd "$W/initrd" >/dev/null 2>&1

base=(-L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu"
  -enable-kvm -cpu host -m 4096 -smp 2 -display none
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd"
  -drive "if=pflash,format=raw,file=$W/vars.fd"
  -drive "file=$W/disk.qcow2,if=virtio,format=qcow2"
  -netdev user,id=n0,hostfwd=tcp::2222-:22 -device virtio-net-pci,netdev=n0)

# 1. Cài. ISO gắn dạng virtio (casper không thấy -cdrom khi boot bằng -kernel).
#    'autoinstall' trên dòng lệnh để bỏ câu hỏi xác nhận — CHỈ dùng trong máy ảo.
echo "→ Cài trên máy ảo (5–15 phút)…"
"$QEMU" "${base[@]}" -drive "file=$ISO,if=virtio,format=raw,readonly=on" \
  -kernel "$W/vmlinuz" -initrd "$W/initrd" -append "autoinstall console=ttyS0 ---" \
  -serial "file:$W/install.log" -no-reboot
grep -aq 'finish: subiquity/Install/install: ' "$W/install.log" \
  || { echo "✗ Cài KHÔNG xong — xem $W/install.log" >&2; exit 1; }
echo "✓ Cài xong"

# 2. Khởi động từ ổ vừa cài, SSH vào kiểm tra
"$QEMU" "${base[@]}" -serial "file:$W/boot.log" & PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
ssh_=(ssh -i "$KEY" -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=3 -o BatchMode=yes -o LogLevel=ERROR admin_1@localhost)
for _ in $(seq 1 40); do "${ssh_[@]}" true 2>/dev/null && break; sleep 5; done
"${ssh_[@]}" '
  set -e
  echo "hệ điều hành : $(lsb_release -ds)"
  echo "tên máy      : $(hostname)"
  echo "ổ gốc        : $(findmnt -no FSTYPE /)"
  test -d /sys/firmware/efi && echo "khởi động    : UEFI"
  echo "chế độ ngủ   : $(systemctl is-enabled sleep.target || true)"
  test "$(findmnt -no FSTYPE /)" = btrfs
'
echo "✓ Máy ảo đạt"
