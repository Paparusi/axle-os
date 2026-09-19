#!/usr/bin/env bash
# Thử đường phát hành trên máy ảo SẠCH, như người dùng thật: tải install.sh → cài (kiểm chữ ký) → chặn bản giả
# → axle update lên bản mới hơn → chặn hạ cấp.
#   AXLE_PASSWORD='...' build/test-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD}"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"; OVMF="$Q/usr/share/OVMF"
BASE="$ROOT/work/vm"; PORT=2225; WEBPORT=18093
[ -f "$BASE/disk.qcow2" ] || { echo "Chưa có máy ảo gốc — chạy build/test-vm.sh trước" >&2; exit 1; }

echo "→ Đóng 2 bản phát hành + 1 bản giả"
R="$ROOT/work/rel"; rm -rf "$R"; mkdir -p "$R"
"$ROOT/build/release.sh" "$R/a" | tail -1
VA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$R/a/latest.json")"
VB="$(awk -F. '{print $1"."$2"."$3+1}' <<<"$VA")"
AXLE_RELEASE_VERSION="$VB" "$ROOT/build/release.sh" "$R/b" | tail -1
cp -r "$R/b" "$R/fake"   # sửa latest.json sau khi ký: đổi băm sang gói khác — chữ ký cũ không còn khớp
python3 - "$R/fake/latest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m["version"] = "9.9.9"; m["sha256"] = "0" * 64
json.dump(m, open(sys.argv[1], "w"), indent=1)
PY

W="$ROOT/work/relvm"; rm -rf "$W"; mkdir -p "$W"
pkill -f "hostfwd=tcp::$PORT-" 2>/dev/null && sleep 2 || true
"$IMG" create -f qcow2 -b "$BASE/disk.qcow2" -F qcow2 "$W/disk.qcow2" >/dev/null
cp "$BASE/vars.fd" "$W/vars.fd"
"$QEMU" -L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu" \
  -enable-kvm -cpu host -m 3072 -smp 2 -display none \
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd" \
  -drive "if=pflash,format=raw,file=$W/vars.fd" \
  -drive "file=$W/disk.qcow2,if=virtio,format=qcow2" \
  -netdev user,id=n0,hostfwd=tcp::$PORT-:22 -device virtio-net-pci,netdev=n0 \
  -serial "file:$W/boot.log" & PID=$!
# Máy chủ web tại chỗ: máy ảo (mạng user của QEMU) thấy máy chủ ở 10.0.2.2
python3 -m http.server "$WEBPORT" --bind 127.0.0.1 --directory "$R" >/dev/null 2>&1 & WEB=$!
SSHO=(-i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR)
vm() { ssh "${SSHO[@]}" admin_1@localhost "$@"; }
trap 'ssh "${SSHO[@]}" admin_1@localhost sync 2>/dev/null; kill $PID $WEB 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do vm true 2>/dev/null && break; sleep 5; done
vm '[ ! -e /etc/axle/version ]' || { echo "✗ Máy ảo không sạch" >&2; exit 1; }

set +e   # từ đây tự kiểm từng bước (lệnh hỏng không được làm dừng bài thử)
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
sudo_vm() { printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c '$1 </dev/null'"; }
WEBVM="http://10.0.2.2:$WEBPORT"

echo "→ Cài như người dùng: tải install.sh rồi chạy bằng sudo"
vm "curl -fsSL $WEBVM/a/install.sh -o /tmp/install.sh"
sudo_vm "bash /tmp/install.sh --from $WEBVM/a --hostname axle-rel" > "$W/install.log" 2>&1; rc=$?
tail -2 "$W/install.log" | sed 's/^/    /'
ok $rc "install.sh cài xong (kiểm chữ ký, tải gói, provision)"
v="$(vm 'cat /etc/axle/version')"
[[ "$v" == "$VA "* ]]; ok $? "bản đang chạy = $VA ($v)"
vm 'systemctl is-active --quiet axle-approve axle-vault axle-mcp-http'; ok $? "dịch vụ duyệt, vault, cổng MCP đang chạy"
[ "$(vm 'cat /etc/axle/owner')" = admin_1 ]; ok $? "nhận đúng chủ máy (người gọi sudo), không viết cứng"
vm 'test "$(cat /opt/axle/mcp/node_modules/.axle-lock)" = "$(sha256sum /opt/axle/mcp/package-lock.json | cut -d" " -f1)"'
ok $? "thư viện MCP dùng bản đóng sẵn trong gói (không tải lại)"
[ "$(vm hostname)" = axle-rel ]; ok $? "--hostname đổi tên máy"

echo "→ Bản giả (latest.json bị sửa sau khi ký)"
out="$(sudo_vm "axle update --from $WEBVM/fake" 2>&1)"; rc=$?
[ $rc != 0 ] && grep -q 'CHỮ KÝ SAI' <<<"$out"; ok $? "axle update từ chối bản giả: CHỮ KÝ SAI"
[[ "$(vm 'cat /etc/axle/version')" == "$VA "* ]]; ok $? "bản đang chạy không đổi sau khi từ chối"

echo "→ Cập nhật lên $VB"
sudo_vm "axle update --from $WEBVM/b" > "$W/update.log" 2>&1; rc=$?
ok $rc "axle update chạy xong"
[[ "$(vm 'cat /etc/axle/version')" == "$VB "* ]]; ok $? "bản đang chạy = $VB"
vm 'systemctl is-active --quiet axle-approve axle-vault axle-mcp-http'; ok $? "dịch vụ vẫn chạy sau cập nhật"
vm '[ -d /opt/axle.prev ]'; ok $? "bản cũ giữ ở /opt/axle.prev"
sudo_vm 'snapper -c root list' | grep -q "Axle $VA → $VB"; ok $? "chụp hệ thống trước khi cập nhật (quay lại được bằng axle undo)"

echo "→ Hạ cấp + cập nhật khi đã mới nhất"
out="$(sudo_vm "axle update --from $WEBVM/a" 2>&1)"; rc=$?
[ $rc != 0 ] && grep -q 'không hạ cấp' <<<"$out"; ok $? "chặn hạ cấp về $VA"
out="$(sudo_vm 'axle update' 2>&1)"; rc=$?
[ $rc = 0 ] && grep -q 'mới nhất' <<<"$out"; ok $? "axle update (không --from) nhớ nơi phát hành, báo đã mới nhất"

if [ "$fail" != 0 ]; then echo "✗ $fail mục hỏng"; exit 1; fi
echo "✓ đường phát hành đạt"
