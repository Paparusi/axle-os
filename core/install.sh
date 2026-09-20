#!/usr/bin/env bash
# Cài / cập nhật Axle Server trên Ubuntu 26.04: tải bản phát hành, KIỂM CHỮ KÝ Ed25519 rồi mới cài.
#   curl -fsSL <nơi phát hành>/install.sh -o install.sh && sudo bash install.sh --from <nơi phát hành>
#   sudo axle update                  (cập nhật: dùng lại nơi phát hành đã ghi lúc cài; không hạ cấp)
# Tuỳ chọn: --from <url|thư mục>  --hostname <tên máy>  --update  --force (cho cài lại / hạ cấp)
set -euo pipefail

FROM="${AXLE_RELEASE_URL:-}"; NEWHOST=""; MODE=install; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --hostname) NEWHOST="${2:-}"; shift 2 ;;
    --update) MODE=update; shift ;;
    --force) FORCE=1; shift ;;
    *) echo "Không hiểu: $1" >&2; exit 2 ;;
  esac
done
die() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Cần chạy bằng sudo"
[ -n "$FROM" ] || FROM="$(cat /etc/axle/release-source 2>/dev/null || true)"
[ -n "$FROM" ] || die "Chưa biết nơi phát hành: thêm --from <url>"
FROM="${FROM%/}"
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID%%.*}" -lt 26 ]; then echo "  cảnh báo: Axle được thử trên Ubuntu 26.04 — máy này là ${PRETTY_NAME:-?}"; fi
for c in curl openssl tar python3 sha256sum; do command -v "$c" >/dev/null || die "Máy thiếu $c"; done
# Axle cần ổ hệ thống btrfs (bản chụp + axle undo). Ubuntu cài mặc định là ext4 → báo rõ thay vì hỏng giữa chừng.
[ "$(findmnt -no FSTYPE /)" = btrfs ] \
  || die "Axle cần ổ hệ thống btrfs — cài bằng ISO Axle, hoặc lúc cài Ubuntu chọn định dạng btrfs cho /"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
# `latest.json` bị CDN của GitHub giữ bản cũ theo từng điểm phát: 20/9 máy văn phòng thấy 0.1.104 trong khi
# máy đóng gói thấy 0.1.106 — `axle update` báo "đã mới nhất" mà thật ra không phải. Bảo CDN đừng dùng bản
# nhớ sẵn, và thêm một tham số ngẫu nhiên cho chắc. Tệp tarball thì tên đã có số bản nên không cần.
fetch() {
  local nocache=""
  case "$1" in latest.json|latest.json.sig) nocache="?t=$$-$(date +%s)" ;; esac
  case "$FROM" in
    http://*|https://*) curl -fsSL --retry 3 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "$FROM/$1$nocache" -o "$T/$1" ;;
    *) cp "$FROM/$1" "$T/$1" ;;
  esac
}
# Khoá công khai ký bản phát hành Axle (khoá riêng chỉ nằm ở máy đóng gói). Đổi khoá = phát hành install.sh mới.
cat > "$T/pub.pem" <<'KEY'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAviKNRhB945sPe1G9bJ9XqUZu4NR8YlyuGMY3uQWX+os=
-----END PUBLIC KEY-----
KEY

fetch latest.json || die "Không tải được $FROM/latest.json"
fetch latest.json.sig || die "Không tải được chữ ký latest.json.sig"
openssl pkeyutl -verify -pubin -inkey "$T/pub.pem" -rawin -in "$T/latest.json" -sigfile "$T/latest.json.sig" >/dev/null 2>&1 \
  || die "CHỮ KÝ SAI — bản phát hành không phải của Axle hoặc đã bị sửa. Dừng, không cài gì."
read -r VER FILE SHA < <(python3 -c '
import json, sys
m = json.load(open(sys.argv[1]))
assert m["product"] == "axle-server"
print(m["version"], m["file"], m["sha256"])' "$T/latest.json") || die "latest.json hỏng"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$FILE" =~ ^axle-[0-9.]+\.tar\.gz$ ]] && [[ "$SHA" =~ ^[0-9a-f]{64}$ ]] \
  || die "latest.json có trường lạ"

CUR="$(cut -d' ' -f1 /etc/axle/version 2>/dev/null || true)"
if [ "$MODE" = update ] && [ "$FORCE" = 0 ] && [[ "$CUR" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  [ "$CUR" = "$VER" ] && { echo "Đang ở bản mới nhất ($CUR)"; exit 0; }
  [ "$(printf '%s\n%s\n' "$CUR" "$VER" | sort -V | tail -1)" = "$VER" ] \
    || die "Bản ở nơi phát hành ($VER) CŨ hơn bản đang chạy ($CUR) — không hạ cấp (thêm --force nếu cố ý)"
fi

echo "→ Tải Axle Server $VER"
fetch "$FILE" || die "Không tải được $FILE"
echo "$SHA  $T/$FILE" | sha256sum -c --quiet - || die "Gói tải về không khớp băm đã ký — dừng, không cài gì"
rm -rf /opt/axle.new
mkdir -p /opt/axle.new
tar -xzf "$T/$FILE" -C /opt/axle.new --strip-components=1 --no-same-owner
[ -f /opt/axle.new/core/provision.sh ] || die "Gói thiếu core/provision.sh"

# Chụp hệ thống trước khi thay (quay lại được bằng axle undo); bản cũ giữ ở /opt/axle.prev
if command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
  snapper -c root create -t single -c number -d "trước khi cài Axle ${CUR:-mới} → $VER" >/dev/null || true
fi
rm -rf /opt/axle.prev
if [ -d /opt/axle ]; then mv /opt/axle /opt/axle.prev; fi
mv /opt/axle.new /opt/axle
mkdir -p /etc/axle
echo "$FROM" > /etc/axle/release-source

echo "→ Thiết lập máy (provision)"
if ! env ${NEWHOST:+AXLE_HOSTNAME=$NEWHOST} bash /opt/axle/core/provision.sh </dev/null; then
  die "provision lỗi — bản trước vẫn còn ở /opt/axle.prev (hoặc: axle undo về bản chụp trước khi cài)"
fi
echo "✓ Axle Server $(cat /etc/axle/version) đã sẵn sàng"
