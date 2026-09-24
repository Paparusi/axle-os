#!/usr/bin/env bash
# Đóng gói bản phát hành Axle Server: axle-<bản>.tar.gz + latest.json (bản, băm, kích thước) + latest.json.sig
# (Ed25519, khoá riêng trong vault) + install.sh. Máy người dùng kiểm chữ ký bằng core/release-key.pub.pem.
#   build/release.sh [thư mục ra]          (mặc định out/release)
#   AXLE_RELEASE_VERSION=0.1.999 build/release.sh …   (ép số bản — chỉ dùng khi thử)
# Chỉ đóng code ĐÃ COMMIT (git archive) — không lẫn file đang sửa dở.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/out/release}"
KEY="${AXLE_RELEASE_KEY:-$HOME/brain/vault/axle_release_ed25519.pem}"
OPENSSL=/usr/bin/openssl
[ -r "$KEY" ] || { echo "Thiếu khoá ký $KEY" >&2; exit 1; }

cd "$ROOT"
COMMIT="$(git rev-parse --short HEAD)"
VER="${AXLE_RELEASE_VERSION:-0.1.$(git rev-list --count HEAD)}"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Số bản sai dạng: $VER" >&2; exit 1; }
[ -z "$(git status --porcelain -- core mcp vault approve app branding)" ] || echo "  (lưu ý: có thay đổi chưa commit — KHÔNG được đóng vào gói)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/axle" "$OUT"
# Máy chỉ cần: lõi, cổng MCP, vault, duyệt, giao thức app, nhận diện. Không kèm trạm, iOS, tài liệu, bài thử máy ảo.
git archive HEAD core mcp vault approve app branding README.md | tar -x -C "$STAGE/axle"
find "$STAGE/axle" -name 'test-*.mjs' -delete
rm -f "$STAGE/axle/app/vectors.mjs" "$STAGE/axle/app/relay-smoke.mjs"
(cd "$STAGE/axle/mcp" && npm ci --omit=dev --silent --no-audit --no-fund)
sha256sum "$STAGE/axle/mcp/package-lock.json" | cut -d' ' -f1 > "$STAGE/axle/mcp/node_modules/.axle-lock"
printf '%s (%s)\n' "$VER" "$COMMIT" > "$STAGE/axle/VERSION"

FILE="axle-$VER.tar.gz"
# Gói lặp lại được: thứ tự file cố định, chủ sở hữu root, thời gian = lúc commit
MTIME="$(git log -1 --format=%cI)"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="$MTIME" -C "$STAGE" -czf "$OUT/$FILE" axle
SHA="$(sha256sum "$OUT/$FILE" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$OUT/$FILE")"
# ghi_chu (AXLE_RELEASE_NOTES, phat-hanh.sh truyền vào): nằm TRONG tệp đã ký → máy tự cập nhật xong báo "có gì mới"
python3 - "$OUT/latest.json" "$VER" "$COMMIT" "$FILE" "$SHA" "$SIZE" "${AXLE_RELEASE_NOTES:-}" <<'PY'
import json, sys, datetime
out, ver, commit, f, sha, size, ghi_chu = sys.argv[1:]
m = {"product": "axle-server", "version": ver, "commit": commit, "file": f, "sha256": sha, "size": int(size),
     "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
if ghi_chu.strip():
    m["ghi_chu"] = ghi_chu.strip()[:1000]
json.dump(m, open(out, "w"), indent=1)   # ASCII thuần (\uXXXX): locale nào đọc cũng được
PY
"$OPENSSL" pkeyutl -sign -inkey "$KEY" -rawin -in "$OUT/latest.json" -out "$OUT/latest.json.sig"
"$OPENSSL" pkeyutl -verify -pubin -inkey "$ROOT/core/release-key.pub.pem" -rawin -in "$OUT/latest.json" \
  -sigfile "$OUT/latest.json.sig" >/dev/null || { echo "✗ khoá ký không khớp core/release-key.pub.pem" >&2; exit 1; }
cp "$ROOT/core/install.sh" "$OUT/install.sh"
echo "✓ Axle Server $VER ($COMMIT): $OUT/$FILE ($(numfmt --to=iec "$SIZE")), latest.json đã ký"
