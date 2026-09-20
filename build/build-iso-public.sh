#!/usr/bin/env bash
# ISO Axle Server CÔNG KHAI: Ubuntu Server gốc (kiểm checksum chính thức) + autoinstall-public + gói Axle có chữ ký
# (thư mục /axle trên đĩa) + menu khởi động của Axle. Không chứa mật khẩu / khoá / tên máy của ai: trình cài HỎI.
#
#   build/build-iso-public.sh [--relay URL] [--release-url URL] [--ubuntu 26.04.1]
#   AXLE_PASSWORD=… build/build-iso-public.sh --test     bản CHỈ để thử máy ảo: điền sẵn admin_1 + mật khẩu + khoá SSH
#
# --relay        trạm chuyển tiếp mặc định cho app (Axle Cloud) — máy tự nối sau khi cài
# --release-url  nơi `axle update` lấy bản mới (mặc định GitHub Releases của axle-os)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UBUNTU="26.04.1"; RELAY=""; RELURL="https://github.com/Paparusi/axle-os/releases/latest/download"; TEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --relay) RELAY="$2"; shift 2 ;;
    --release-url) RELURL="$2"; shift 2 ;;
    --ubuntu) UBUNTU="$2"; shift 2 ;;
    --test) TEST=1; shift ;;
    *) echo "Không hiểu tham số: $1" >&2; exit 2 ;;
  esac
done
XORRISO="${XORRISO:-$(command -v xorriso || true)}"
[ -x "$XORRISO" ] || { echo "Không tìm thấy xorriso (đặt XORRISO=...)" >&2; exit 1; }

ISO="ubuntu-${UBUNTU}-live-server-amd64.iso"
URL="https://releases.ubuntu.com/${UBUNTU}"
mkdir -p "$ROOT/cache" "$ROOT/out"
if [ ! -f "$ROOT/cache/$ISO" ]; then
  echo "→ Tải $ISO"
  curl -fL --progress-bar -o "$ROOT/cache/$ISO.part" "$URL/$ISO"
  mv "$ROOT/cache/$ISO.part" "$ROOT/cache/$ISO"
fi
WANT="$(curl -fsSL "$URL/SHA256SUMS" | grep " \*$ISO\$" | cut -d' ' -f1)"
GOT="$(sha256sum "$ROOT/cache/$ISO" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { echo "Checksum Ubuntu KHÔNG khớp" >&2; exit 1; }
echo "✓ Ubuntu $UBUNTU gốc: checksum khớp"

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
# 1. Gói Axle có chữ ký (máy kiểm lại chữ ký lúc cài) + firstboot + nơi cập nhật + trạm mặc định
"$ROOT/build/release.sh" "$W/axle" | tail -1
VER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$W/axle/latest.json")"
cp -r "$ROOT/core/firstboot" "$W/axle/firstboot"
echo "$RELURL" > "$W/axle/release-url"
[ -z "$RELAY" ] || echo "$RELAY" > "$W/axle/relay-url"

# 2. autoinstall: bản công khai hỏi identity; bản thử máy ảo điền sẵn
python3 - "$ROOT/server/autoinstall-public.yaml.tmpl" "$W/autoinstall.yaml" "$TEST" <<'PY'
import os, subprocess, sys, yaml
src, dst, test = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
head, sep, s = open(src).read().partition("autoinstall:")   # chỉ điền trong phần cấu hình, không đụng chú thích
if test:
    pw = os.environ["AXLE_PASSWORD"]
    h = subprocess.run(["mkpasswd", "-m", "sha-512", "--stdin"], input=pw, capture_output=True, text=True, check=True).stdout.strip()
    key = open(os.path.expanduser(os.environ.get("AXLE_SSH_KEY", "~/.ssh/id_ed25519.pub"))).readline().strip()
    s = s.replace("__INTERACTIVE__", "")
    s = s.replace("__IDENTITY__", "identity:\n    hostname: axle-iso\n    realname: Axle\n    username: admin_1\n    password: '%s'" % h)
    s = s.replace("__SSH_KEYS__", "authorized-keys:\n      - '%s'" % key)
else:
    s = s.replace("__INTERACTIVE__", "interactive-sections:\n    - identity")
    s = s.replace("__IDENTITY__", "")
    s = s.replace("__SSH_KEYS__", "")
assert "__" not in s, "còn chỗ chưa điền"
s = head + sep + s
cfg = yaml.safe_load(s)
assert ("identity" in cfg["autoinstall"]) == test and ("interactive-sections" in cfg["autoinstall"]) != test
open(dst, "w").write(s)
PY

# 3. Menu khởi động: KHÔNG tự chọn (timeout -1) — người dùng phải tự bấm mục có chữ XOÁ
cat > "$W/grub.cfg" <<'EOF'
set timeout=-1

loadfont unicode

set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

menuentry "Cài Axle Server — XOÁ SẠCH ổ lớn nhất trong máy" {
    set gfxpayload=keep
    linux  /casper/vmlinuz autoinstall ---
    initrd /casper/initrd
}
menuentry "Cài Axle Desktop (có giao diện) — XOÁ SẠCH ổ lớn nhất trong máy" {
    set gfxpayload=keep
    linux  /casper/vmlinuz autoinstall axle.edition=desktop ---
    initrd /casper/initrd
}
menuentry "Trình cài gốc (tự chọn ổ, hỏi trước khi xoá)" {
    set gfxpayload=keep
    linux  /casper/vmlinuz  ---
    initrd /casper/initrd
}
grub_platform
if [ "$grub_platform" = "efi" ]; then
menuentry 'Khởi động từ ổ tiếp theo' {
    exit 1
}
menuentry 'Cài đặt UEFI' {
    fwsetup
}
fi
EOF

SUFFIX=""; [ "$TEST" = 1 ] && SUFFIX="-THU-MAY-AO"
OUT="$ROOT/out/axle-server-$VER$SUFFIX.iso"
rm -f "$OUT"
"$XORRISO" -indev "$ROOT/cache/$ISO" -outdev "$OUT" \
  -map "$W/autoinstall.yaml" /autoinstall.yaml -map "$W/axle" /axle -map "$W/grub.cfg" /boot/grub/grub.cfg \
  -boot_image any replay 2>&1 | grep -E 'completed|FAILURE|SORRY' || true
[ -s "$OUT" ] || { echo "✗ không tạo được ISO" >&2; exit 1; }
(cd "$ROOT/out" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) — Axle $VER$([ "$TEST" = 1 ] && echo ' — BẢN THỬ, không phát hành')"
