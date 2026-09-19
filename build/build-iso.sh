#!/usr/bin/env bash
# Đóng gói ISO Axle Server: Ubuntu Server gốc + autoinstall.yaml ở gốc đĩa.
#
#   AXLE_PASSWORD='...' build/build-iso.sh [--hostname axle-server] [--ubuntu 26.04.1]
#
# Biến môi trường:
#   AXLE_PASSWORD  (bắt buộc) mật khẩu user admin_1, chỉ đưa vào ISO dạng hash sha-512
#   AXLE_SSH_KEY   khoá công khai được SSH vào (mặc định ~/.ssh/id_ed25519.pub)
#   XORRISO        đường dẫn xorriso nếu không có trong PATH
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOSTNAME_="axle-server"
UBUNTU="26.04.1"
while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME_="$2"; shift 2 ;;
    --ubuntu)   UBUNTU="$2"; shift 2 ;;
    *) echo "Không hiểu tham số: $1" >&2; exit 2 ;;
  esac
done

: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD}"
AXLE_SSH_KEY="${AXLE_SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
XORRISO="${XORRISO:-$(command -v xorriso || true)}"
[ -x "$XORRISO" ] || { echo "Không tìm thấy xorriso (đặt XORRISO=...)" >&2; exit 1; }
command -v mkpasswd >/dev/null || { echo "Thiếu mkpasswd (gói whois)" >&2; exit 1; }
[ -r "$AXLE_SSH_KEY" ] || { echo "Không đọc được khoá $AXLE_SSH_KEY" >&2; exit 1; }

ISO="ubuntu-${UBUNTU}-live-server-amd64.iso"
URL="https://releases.ubuntu.com/${UBUNTU}"
mkdir -p "$ROOT/cache" "$ROOT/work" "$ROOT/out"

# 1. Ubuntu gốc, kiểm checksum chính thức
if [ ! -f "$ROOT/cache/$ISO" ]; then
  echo "→ Tải $ISO"
  curl -fL --progress-bar -o "$ROOT/cache/$ISO.part" "$URL/$ISO"
  mv "$ROOT/cache/$ISO.part" "$ROOT/cache/$ISO"
fi
WANT="$(curl -fsSL "$URL/SHA256SUMS" | grep " \*$ISO\$" | cut -d' ' -f1)"
GOT="$(sha256sum "$ROOT/cache/$ISO" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { echo "Checksum Ubuntu KHÔNG khớp" >&2; exit 1; }
echo "✓ Checksum Ubuntu khớp"

# 2. Điền template
HASH="$(mkpasswd -m sha-512 "$AXLE_PASSWORD")"
KEY="$(head -n1 "$AXLE_SSH_KEY")"
CFG="$ROOT/work/autoinstall.yaml"
python3 - "$ROOT/server/autoinstall.yaml.tmpl" "$CFG" "$HASH" "$KEY" "$HOSTNAME_" <<'PY'
import sys, yaml
src, dst, h, k, host = sys.argv[1:]
s = open(src).read().replace('__PASSWORD_HASH__', h).replace('__SSH_KEY__', k).replace('__HOSTNAME__', host)
assert '__' not in s.split('autoinstall:', 1)[1], 'Còn placeholder chưa điền'
yaml.safe_load(s)
open(dst, 'w').write(s)
PY
echo "✓ autoinstall.yaml hợp lệ (hostname $HOSTNAME_)"

# 3. Đóng gói: giữ nguyên bản ghi khởi động của ISO gốc
OUT="$ROOT/out/axle-server-${UBUNTU}.iso"
rm -f "$OUT"
"$XORRISO" -indev "$ROOT/cache/$ISO" -outdev "$OUT" \
  -map "$CFG" /autoinstall.yaml -boot_image any replay 2>&1 | grep -E 'completed|FAILURE|SORRY' || true
rm -f "$CFG"
sha256sum "$OUT" | tee "$OUT.sha256"
echo "✓ Xong: $OUT"
