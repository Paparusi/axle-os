#!/usr/bin/env bash
# Chạy thử core/provision.sh trên máy ảo đã cài bằng build/test-vm.sh.
# Dùng ổ phủ (overlay) nên ổ máy ảo gốc giữ nguyên, thử lại bao nhiêu lần cũng từ máy sạch.
#
#   AXLE_PASSWORD='...' build/test-provision.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${AXLE_PASSWORD:?Thiếu AXLE_PASSWORD (mật khẩu đã dùng khi dựng ISO)}"
Q="${QEMU_ROOT:-}"
KEY="${AXLE_SSH_PRIV:-$HOME/.ssh/id_ed25519}"
export LD_LIBRARY_PATH="${Q:+$Q/usr/lib/x86_64-linux-gnu}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
QEMU="$Q/usr/bin/qemu-system-x86_64"; IMG="$Q/usr/bin/qemu-img"; OVMF="$Q/usr/share/OVMF"
BASE="$ROOT/work/vm"
[ -f "$BASE/disk.qcow2" ] || { echo "Chưa có máy ảo gốc — chạy build/test-vm.sh trước" >&2; exit 1; }
W="$ROOT/work/prov"; rm -rf "$W"; mkdir -p "$W"
# Máy ảo cũ còn giữ cổng 2223 thì máy mới không bật được và mọi lệnh sẽ chui vào máy CŨ, bẩn.
pkill -f 'hostfwd=tcp::2223-' 2>/dev/null && sleep 2 || true
"$IMG" create -f qcow2 -b "$BASE/disk.qcow2" -F qcow2 "$W/disk.qcow2" >/dev/null
cp "$BASE/vars.fd" "$W/vars.fd"

"$QEMU" -L "$Q/usr/share/qemu" -L "$Q/usr/share/seabios" -L "$Q/usr/lib/ipxe/qemu" \
  -enable-kvm -cpu host -m 4096 -smp 2 -display none \
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF/OVMF_CODE_4M.fd" \
  -drive "if=pflash,format=raw,file=$W/vars.fd" \
  -drive "file=$W/disk.qcow2,if=virtio,format=qcow2" \
  -netdev user,id=n0,hostfwd=tcp::2223-:22 -device virtio-net-pci,netdev=n0 \
  -serial "file:$W/boot.log" & PID=$!
sleep 3
kill -0 "$PID" 2>/dev/null || { echo "✗ Máy ảo không bật được (cổng 2223 bận?)" >&2; exit 1; }

SSHO=(-i "$KEY" -p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR)
vm() { ssh "${SSHO[@]}" admin_1@localhost "$@"; }
# sync trước khi tắt: giết qemu ngang thì dữ liệu chưa xuống đĩa bị mất → gỡ lỗi sau đó thấy file rỗng GIẢ
trap 'ssh "${SSHO[@]}" admin_1@localhost sync 2>/dev/null; kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do vm true 2>/dev/null && break; sleep 5; done
# Chạy một khối kiểm (stdin) trên máy ảo. Bắt buộc khối phải chạy tới dòng cuối: lệnh nào trong khối
# lỡ đọc stdin sẽ ăn mất phần còn lại → không có dấu kết thúc → báo hỏng thay vì đạt giả.
vm_block() {
  local out rc=0
  out="$( { cat; echo 'echo __AXLE_BLOCK_DONE__'; } | vm 'bash -s' )" || rc=$?
  grep -v __AXLE_BLOCK_DONE__ <<<"$out" || true
  [ "$rc" = 0 ] || return "$rc"
  grep -q __AXLE_BLOCK_DONE__ <<<"$out" || { echo "  ✗ khối kiểm không chạy hết (có lệnh ăn mất stdin?)"; return 1; }
}

vm '[ ! -e /etc/axle/version ]' || { echo "✗ Máy ảo không sạch: đã có Axle từ trước" >&2; exit 1; }
echo "→ Chép repo vào máy ảo"
rsync -a --exclude work --exclude out --exclude cache -e "ssh ${SSHO[*]}" "$ROOT/" admin_1@localhost:/tmp/axle/

for lan in 1 2; do
  echo "→ provision lần $lan"
  # stdin của provision là /dev/null: mật khẩu sudo không bao giờ lọt vào lệnh bên trong
  printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'exec env AXLE_HOSTNAME=axle-vm bash /tmp/axle/core/provision.sh </dev/null'" \
    > "$W/provision-$lan.log" 2>&1 || { tail -30 "$W/provision-$lan.log"; echo "✗ provision lần $lan lỗi" >&2; exit 1; }
  grep -E '^== |^  ' "$W/provision-$lan.log" | sed 's/\x1b\[[0-9;]*m//g' | sed 's/^/   /'
done

echo "→ Vault: thêm khoá thử + dựng máy chủ tiếng vọng trên localhost:8088"
TEST_SECRET="axle-test-secret-$RANDOM$RANDOM"
# Khoá thử đi qua FILE riêng, không chung stdin với mật khẩu sudo: sudo mà không hỏi mật khẩu
# (vd còn quyền tạm) thì dòng mật khẩu sẽ bị đọc nhầm làm giá trị khoá.
printf '%s' "$TEST_SECRET" | vm 'umask 077; cat > /tmp/test-secret'
printf '%s\n' "$AXLE_PASSWORD" \
  | vm "sudo -S -p '' bash -c 'axle vault set TEST_TOKEN --host localhost --desc thu </tmp/test-secret; rm -f /tmp/test-secret'"
vm 'cat > /tmp/echo.py <<"PY"
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        open("/tmp/echo-received", "a").write(self.headers.get("Authorization", "") + "\n")
        body = json.dumps({"auth": self.headers.get("Authorization"), "path": self.path}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8088), H).serve_forever()
PY
nohup python3 /tmp/echo.py >/dev/null 2>&1 &'
sleep 1

echo "→ Cổng MCP qua SSH (như agent ở máy khác gọi vào)"
AXLE_TEST_SECRET="$TEST_SECRET" node "$ROOT/build/mcp-smoke.mjs" "${SSHO[@]}" admin_1@localhost

echo "→ Duyệt qua Telegram (Telegram giả trong máy ảo, bài thử giả làm chủ bấm nút)"
TG_TOKEN="test-bot-$RANDOM$RANDOM:$RANDOM"
printf '%s' "$TG_TOKEN" | vm 'umask 077; cat > /tmp/tg-token'
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle vault set AXLE_TG_TOKEN --host localhost </tmp/tg-token && rm -f /tmp/tg-token && axle approve setup --owner 111111 --expire 15 --api http://localhost:8099 --tomtat tat </dev/null'"
vm 'nohup python3 /tmp/axle/build/tg-mock.py >/dev/null 2>&1 &'
sleep 1
ssh "${SSHO[@]}" -N -L 28099:127.0.0.1:8099 admin_1@localhost & TUN2=$!
sleep 6   # dịch vụ duyệt đọc lại cấu hình mỗi 5 giây
AXLE_TEST_TG_TOKEN="$TG_TOKEN" node "$ROOT/build/approve-smoke.mjs" http://127.0.0.1:28099 111111 "${SSHO[@]}" admin_1@localhost \
  || { kill $TUN2; exit 1; }
kill $TUN2 2>/dev/null || true
vm_block <<'EOF'
[ "$(stat -c %U ~/work/duyet.txt)" = admin_1 ] && echo "  ✓ file lệnh đã duyệt tạo ra thuộc admin_1 (không phải root)" || { echo "  ✗ sai chủ file"; exit 1; }
axle approve log 4 | sed 's/^/    /'
EOF

echo "→ Agent riêng: user riêng, hộp cát, qua cửa trước HTTP"
new_agent() {
  printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle agent add $1 --preset $2 </dev/null'" | grep -o 'axle_[A-Za-z0-9_-]*'
}
TOKA="$(new_agent testbot files)"; TOKB="$(new_agent bot2 full)"
[ -n "$TOKA" ] && [ -n "$TOKB" ] || { echo "  ✗ không tạo được agent"; exit 1; }
ssh "${SSHO[@]}" -N -L 28765:127.0.0.1:8765 admin_1@localhost & TUN=$!
sleep 2
node "$ROOT/build/mcp-http-smoke.mjs" http://127.0.0.1:28765/mcp "$TOKA" "$TOKB" || { kill $TUN; exit 1; }
echo "→ Agent riêng dùng vault + xin duyệt (danh tính theo socket)"
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle vault grant TEST_TOKEN bot2 </dev/null'"
ssh "${SSHO[@]}" -N -L 28099:127.0.0.1:8099 admin_1@localhost & TUN3=$!
sleep 2
node "$ROOT/build/agent-full-smoke.mjs" http://127.0.0.1:28765/mcp "$TOKB" http://127.0.0.1:28099 111111 "$TEST_SECRET" \
  || { kill $TUN $TUN3; exit 1; }
echo "→ Trợ lý chính (khoá SSH chỉ mở MCP) + dừng khẩn cấp qua Telegram"
COGKEY="$W/cog_key"
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle agent add cog --vai chinh </dev/null'" \
  | sed -n '/-----BEGIN OPENSSH PRIVATE KEY-----/,/-----END OPENSSH PRIVATE KEY-----/p' > "$COGKEY"
chmod 600 "$COGKEY"
grep -q 'END OPENSSH PRIVATE KEY' "$COGKEY" || { echo "  ✗ không nhận được khoá của trợ lý"; exit 1; }
COGSSH=(-i "$COGKEY" -p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR -o IdentitiesOnly=yes)
ssh "${COGSSH[@]}" admin_1@localhost 'touch /tmp/pwned-cog' </dev/null >/dev/null 2>&1 || true
vm 'test ! -e /tmp/pwned-cog' && echo "  ✓ khoá trợ lý KHÔNG mở được shell (lệnh tuỳ ý bị thay bằng axle mcp)" || { echo "  ✗ khoá trợ lý chạy được lệnh tuỳ ý"; exit 1; }
ssh "${COGSSH[@]}" -N -L 28111:127.0.0.1:8765 admin_1@localhost & FWD=$!
sleep 2
code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:28111/mcp || true)"
kill $FWD 2>/dev/null || true
[ "$code" = 000 ] && echo "  ✓ khoá trợ lý KHÔNG chuyển cổng được (restrict)" || { echo "  ✗ khoá trợ lý chuyển cổng được ($code)"; exit 1; }
node "$ROOT/build/role-smoke.mjs" http://127.0.0.1:28099 111111 http://127.0.0.1:28765/mcp "$TOKB" "$COGKEY" \
  -p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR -o IdentitiesOnly=yes admin_1@localhost \
  || { kill $TUN $TUN3; exit 1; }
vm_block <<'EOF'
axle cmdlog --agent --since today --limit 3000 | grep '\[cog\]' >/dev/null && echo "  ✓ axle cmdlog gắn [cog] cho lệnh trong phiên của trợ lý" || { echo "  ✗ cmdlog không nhận ra phiên của cog"; exit 1; }
EOF
echo "→ Cấp quyền kiểu điện thoại: thư mục, mạng, hạn dùng"
vm 'mkdir -p ~/projects/demo/src ~/projects/demo/data ~/projects/other ~/projects/tam ~/brain/vault && echo tam thoi > ~/projects/tam/t.txt && echo "console.log('"'"'demo'"'"')" > ~/projects/demo/src/app.js && echo SECRET=1 > ~/projects/demo/.env && echo khac > ~/projects/other/x.txt'
sudo_vm() { printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c '$1 </dev/null'"; }
# đường dẫn tuyệt đối: trong bash -c của root, ~ thành /root và mục này sẽ đạt vì lý do SAI
for bad in /home/admin_1/.ssh /home/admin_1 /home/admin_1/brain /etc; do
  if sudo_vm "axle agent grant bot2 thu-muc $bad --doc" >/dev/null 2>&1; then echo "  ✗ cấp được vùng cấm $bad"; exit 1; fi
  msg="$(sudo_vm "axle agent grant bot2 thu-muc $bad --doc" 2>&1 || true)"
  case "$bad" in /etc) want="Chỉ cấp thư mục" ;; *) want="vùng bí mật" ;; esac
  grep -q "$want" <<<"$msg" || { echo "  ✗ $bad bị chặn nhưng sai lý do: $msg"; exit 1; }
done
echo "  ✓ không cấp được ~/.ssh, cả home, ~/brain (đều chứa/là vùng bí mật), /etc — đúng lý do"
sudo_vm "axle agent grant bot2 thu-muc /home/admin_1/projects/demo --doc && axle agent grant bot2 thu-muc /home/admin_1/projects/demo/data --ghi && axle agent grant bot2 thu-muc /home/admin_1/projects/tam --doc --han 20s && axle agent grant bot2 mang 127.0.0.1 && axle agent grant cog thu-muc /home/admin_1/projects/demo --ghi" | sed 's/^/    /'
vm 'axle agent grants bot2' | sed 's/^/    /'
GSSH=(-p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR -o IdentitiesOnly=yes admin_1@localhost)
# quyền ~/projects/tam có hạn 20 giây: kiểm còn hạn ở lượt granted, hết hạn ở lượt revoked
node "$ROOT/build/grant-smoke.mjs" granted http://127.0.0.1:28765/mcp "$TOKB" http://127.0.0.1:28099 111111 "$COGKEY" "${GSSH[@]}" || { kill $TUN $TUN3; exit 1; }
sleep 20
sudo_vm "axle agent revoke bot2 thu-muc /home/admin_1/projects/demo && axle agent revoke bot2 mang 127.0.0.1 && axle agent revoke cog thu-muc /home/admin_1/projects/demo && axle agent expire" | sed 's/^/    /'
node "$ROOT/build/grant-smoke.mjs" revoked http://127.0.0.1:28765/mcp "$TOKB" http://127.0.0.1:28099 111111 "$COGKEY" "${GSSH[@]}" || { kill $TUN $TUN3; exit 1; }
echo "→ Duyệt 4 bậc: 1 giờ, luôn việc này, bậc 3, /luat /quen /tomtat"
node "$ROOT/build/tier-smoke.mjs" http://127.0.0.1:28099 111111 http://127.0.0.1:28765/mcp "$TOKB" "${SSHO[@]}" admin_1@localhost \
  || { kill $TUN $TUN3; exit 1; }
# Trạm chuyển tiếp thuộc Axle Cloud (mã đóng): bản mã nguồn mở không kèm → bỏ qua phần app
if [ -f "$ROOT/relay/server.js" ]; then
echo "→ App Axle (điện thoại giả): ghép cặp, duyệt, tấn công, dừng khẩn cấp, duyệt tại máy"
vm 'AXLE_RELAY_STATE=/tmp/relay-state.json nohup /usr/bin/node /opt/axle/relay/server.js >/tmp/relay.log 2>&1 &'
sleep 1
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle app setup --relay http://127.0.0.1:8787 </dev/null'" | sed 's/^/    /'
ssh "${SSHO[@]}" -N -L 28787:127.0.0.1:8787 admin_1@localhost & TUN4=$!
sleep 2
AXLE_PASSWORD="$AXLE_PASSWORD" node "$ROOT/build/app-smoke.mjs" http://127.0.0.1:28787 http://127.0.0.1:28099 111111 \
  http://127.0.0.1:28765/mcp "$TOKB" "${SSHO[@]}" admin_1@localhost || { kill $TUN $TUN3 $TUN4; exit 1; }
kill $TUN4 2>/dev/null || true
else
  echo "→ App Axle: bỏ qua (bản mã nguồn mở không kèm trạm chuyển tiếp)"
fi
rm -f "$COGKEY"
kill $TUN3 2>/dev/null || true
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' bash -c 'axle agent rm testbot </dev/null'" >/dev/null
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKA" -H 'content-type: application/json' -d '{}' http://127.0.0.1:28765/mcp)"
kill $TUN 2>/dev/null || true
[ "$code" = 401 ] && echo "  ✓ thu hồi agent → token cũ bị từ chối (401)" || { echo "  ✗ agent đã thu hồi vẫn vào được ($code)"; exit 1; }
vm_block <<'EOF'
set -uo pipefail
chk() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then echo "  ✓ $d"; else echo "  ✗ $d"; exit 1; fi; }
g="$(id -nG ag-bot2)"
chk "user agent không ở nhóm sudo/docker/axle-agent/journal ($g)" bash -c "! grep -qwE 'sudo|docker|axle-agent|systemd-journal|adm' <<<'$g'"
pid="$(systemctl show -p MainPID --value axle-mcp@bot2)"
chk "máy chủ của agent chạy bằng ag-bot2" test "$(ps -o user= -p "$pid")" = ag-bot2
fpid="$(systemctl show -p MainPID --value axle-mcp-http)"
chk "cửa trước chạy bằng axle-gw" test "$(ps -o user= -p "$fpid")" = axle-gw
chk "socket agent: root:axle-gw 660 (agent không sở hữu)" test "$(stat -c '%U:%G %a' /run/axle-mcp/bot2.sock)" = "root:axle-gw 660"
chk "máy chủ agent tắt khi thu hồi" bash -c "! systemctl is-active -q axle-mcp@testbot.socket"
chk "axle audit có http:bot2 (từ journal)" bash -c "axle audit 50 | grep -q 'http:bot2'"
chk "axle cmdlog ghi lệnh chạy bằng user agent [ag-bot2]" bash -c "axle cmdlog --since today --limit 3000 | grep -q '\[ag-bot2\]'"
axle agents | sed 's/^/    /'
EOF

echo "→ Vault: khoá tới đúng nơi, không lọt ra đâu khác"
vm_block <<EOF
set -uo pipefail
grep -q '$TEST_SECRET' /tmp/echo-received && echo "  ✓ máy chủ đích nhận đúng khoá thật" \
  || { echo "  ✗ khoá không tới được đích (máy đích nhận \$(wc -l </tmp/echo-received) yêu cầu)"; exit 1; }
if cat /var/lib/axle-vault/secrets.json >/dev/null 2>&1; then echo "  ✗ agent đọc thẳng được file khoá"; exit 1; fi
echo "  ✓ agent đọc thẳng file khoá bị hệ điều hành chặn"
if grep -rq '$TEST_SECRET' ~/.local/state/axle/ /var/log/axle-vault/ 2>/dev/null; then echo "  ✗ khoá lọt vào nhật ký"; exit 1; fi
echo "  ✓ khoá không có trong nhật ký MCP lẫn nhật ký vault"
grep -q 'TEST_TOKEN → localhost' <<<"\$(axle vault)" && echo "  ✓ axle vault liệt kê tên + nơi gửi" || { echo "  ✗ axle vault không liệt kê đúng"; exit 1; }
axle vault log 5 | sed 's/^/    /'
EOF

echo "→ Nhật ký lệnh (auditd)"
MARK="axle-mark-$RANDOM"
vm "/usr/bin/printf '%s' $MARK >/dev/null; /usr/bin/env true 'hai tu'; sudo -n /usr/local/lib/axle/axle-snap list >/dev/null"
ssh -tt "${SSHO[@]}" admin_1@localhost "/usr/bin/printf pty-$MARK >/dev/null" >/dev/null 2>&1
sleep 1
vm_block <<EOF
set -uo pipefail
all="\$(axle cmdlog --since today --limit 2000)"
agent="\$(axle cmdlog --agent --since today --limit 2000)"
grep -q "printf %s $MARK" <<<"\$agent" && echo "  ✓ ghi lệnh chạy qua SSH không bàn phím (agent)" || { echo "  ✗ thiếu lệnh agent"; exit 1; }
grep -q "env true 'hai tu'" <<<"\$agent" && echo "  ✓ giữ đúng đối số có khoảng trắng" || { echo "  ✗ sai đối số"; exit 1; }
grep -q "axle-snap list" <<<"\$agent" && echo "  ✓ ghi cả lệnh chạy qua sudo" || { echo "  ✗ thiếu lệnh sudo"; exit 1; }
grep -q "journalctl -u ssh" <<<"\$(axle cmdlog --agent --since today --tim "journalctl -u ssh")" && echo "  ✓ ghi cả lệnh cổng MCP chạy hộ (tìm bằng --tim trong nhật ký dài)" || { echo "  ✗ thiếu lệnh MCP"; exit 1; }
grep -q "pty-$MARK" <<<"\$all" && ! grep -q "pty-$MARK" <<<"\$agent" && echo "  ✓ --agent tách được lệnh gõ có bàn phím" || { echo "  ✗ lọc --agent sai"; exit 1; }
if cat /var/log/audit/audit.log >/dev/null 2>&1; then echo "  ✗ agent đọc thẳng được nhật ký gốc"; exit 1; fi
echo "  ✓ agent không đọc thẳng được nhật ký gốc"
if sudo -n /usr/sbin/auditctl -D >/dev/null 2>&1; then echo "  ✗ agent xoá được luật ghi"; exit 1; fi
echo "  ✓ agent không xoá được luật ghi"
axle cmdlog --agent --since today --limit 4 | sed 's/^/    /'
EOF

echo "→ Cửa hẹp sudo (trước khi cấp sudo tạm cho phần kiểm còn lại)"
vm_block <<'EOF'
set -uo pipefail
if sudo -n /usr/bin/snapper -c root list >/dev/null 2>&1; then echo "  ✗ gọi thẳng snapper qua sudo được"; exit 1; fi
echo "  ✓ không gọi thẳng snapper qua sudo được"
n="$(sudo -n /usr/local/lib/axle/axle-snap create '--command=touch /tmp/pwned')" || { echo "  ✗ axle-snap create lỗi"; exit 1; }
if [ -e /tmp/pwned ]; then echo "  ✗ chèn --command chạy được lệnh root"; exit 1; fi
echo "  ✓ chèn --command chỉ thành mô tả snapshot #$n, không chạy lệnh"
EOF

# Chỉ trong máy ảo thử: cho sudo không hỏi mật khẩu để kiểm tự động
printf '%s\n' "$AXLE_PASSWORD" | vm "sudo -S -p '' sh -c 'echo \"admin_1 ALL=(ALL) NOPASSWD:ALL\" > /etc/sudoers.d/99-test'"

echo "→ Kiểm tra"
vm_block <<'EOF'
set -uo pipefail
# chk "mô tả" lệnh… — sai là DỪNG và báo hỏng. Không dùng `điều_kiện && ok`: sai thì bị bỏ qua im lặng.
# Không dùng `grep -q` sau ống: grep thoát sớm → lệnh trước dính SIGPIPE → pipefail báo sai.
chk() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then echo "  ✓ $d"; else echo "  ✗ $d"; exit 1; fi; }
has() { grep -qx -- "$1" <<<"$2"; }   # tìm trong chữ đã chụp sẵn, không qua ống
axle status | sed 's/^/    /'
chk "tên máy axle-vm" test "$(hostname)" = axle-vm
for d in /home /var/lib/docker /var/lib/axle-vault /var/log /var/lib/tailscale /swap; do chk "$d là subvolume riêng" test "$(stat -c %i $d)" = 256; done
chk "Docker chạy container được" bash -c 'docker run --rm hello-world | grep "Hello from Docker"'
. ~/.nvm/nvm.sh
chk "node $(node -v), pm2 $(pm2 -v 2>/dev/null | tail -1)" command -v pm2
chk "PM2 tự bật cùng máy" systemctl is-enabled pm2-admin_1
chk "tường lửa bật" bash -c 'sudo ufw status | grep "Status: active"'
chk "tailscaled chạy" systemctl is-active tailscaled
chk "auditd chạy" systemctl is-active auditd
chk "vault chạy" systemctl is-active axle-vault

before="$(sudo snapper -c root list | tail -n +3 | wc -l)"
sudo apt-get install -yq cowsay >/dev/null 2>&1 </dev/null
after="$(sudo snapper -c root list | tail -n +3 | wc -l)"
chk "cài gói tự chụp snapshot trước/sau ($before → $after)" test "$after" -ge $((before + 2))

n="$(axle snapshot 'thử undo' | grep -o '[0-9]*$')"
sudo sh -c 'echo rac > /etc/axle-undo-test'
echo giu-lai > ~/giu-lai.txt
axle undo "$n" --yes >/dev/null
chk "undo xoá được file lạ trong /etc" test ! -e /etc/axle-undo-test
chk "undo không đụng /home" test -e ~/giu-lai.txt

sshd_cfg="$(sudo sshd -T 2>/dev/null)"
chk "SSH tắt đăng nhập bằng mật khẩu" has 'passwordauthentication no' "$sshd_cfg"
chk "SSH cấm root đăng nhập" has 'permitrootlogin no' "$sshd_cfg"
chk "file agent tạo ra thuộc ag-testbot" test "$(sudo stat -c %U /home/ag-testbot/work/a.txt)" = ag-testbot
chk "home agent 700, agent khác không vào được" bash -c '! sudo -u ag-bot2 ls /home/ag-testbot'
chk "agent không nối thẳng socket của mình (phải qua cửa trước)" bash -c '! sudo -u ag-bot2 curl -s --unix-socket /run/axle-mcp/bot2.sock http://x/mcp'
chk "agent không đọc được home của chủ" bash -c '! sudo -u ag-bot2 ls /home/admin_1'
chk "agent không sudo được" bash -c '! sudo -u ag-bot2 sudo -n true'
chk "agent không mở được socket vault của chủ máy" bash -c '! sudo -u ag-bot2 curl -s --unix-socket /run/axle-vault/vault.sock http://x/secrets'
chk "agent không mở được socket duyệt của chủ máy" bash -c '! sudo -u ag-bot2 curl -s --unix-socket /run/axle-approve/approve.sock http://x/status/00000000'
chk "socket vault riêng của agent: root:ag-bot2 660" test "$(stat -c '%U:%G %a' /run/axle-vault-agents/bot2.sock)" = "root:ag-bot2 660"
chk "socket duyệt riêng của agent: root:ag-bot2 660" test "$(stat -c '%U:%G %a' /run/axle-approve-agents/bot2.sock)" = "root:ag-bot2 660"
chk "thu hồi testbot → socket vault/duyệt của nó biến mất" bash -c '! test -e /run/axle-vault-agents/testbot.sock && sleep 4 && ! test -e /run/axle-approve-agents/testbot.sock'
chk "nhật ký vault ghi agent bot2" sudo grep -q '"agent":"bot2"' /var/log/axle-vault/access.log
sudo cp -p /var/lib/axle-vault/secrets.json /tmp/secrets.keep
sudo truncate -s 0 /var/lib/axle-vault/secrets.json
chk "giả mất điện: file khoá rỗng → vault dùng bản sao lưu, vẫn trả lời" bash -c 'curl -sf --unix-socket /run/axle-vault/vault.sock http://x/secrets | grep -q TEST_TOKEN'
sudo cp -p /tmp/secrets.keep /var/lib/axle-vault/secrets.json && sudo rm -f /tmp/secrets.keep
chk "rút quyền → ACL của ag-bot2 bị gỡ khỏi file của chủ" bash -c '! sudo getfacl -p /home/admin_1/projects/demo/src/app.js | grep -q ag-bot2'
chk "file agent tạo trong thư mục được ghi: chủ vẫn đọc được" cat /home/admin_1/projects/demo/data/out.txt
chk "file đó thuộc ag-bot2 (ghi đúng danh tính)" test "$(stat -c %U /home/admin_1/projects/demo/data/out.txt)" = ag-bot2
chk "hộp cát agent có gắn thư mục còn quyền (demo/data)" sudo grep -q 'BindPaths=/home/admin_1/projects/demo/data' '/etc/systemd/system/axle-mcp@bot2.service.d/50-grants.conf'
chk "hộp cát agent đã tháo thư mục bị rút (demo)" bash -c "! sudo grep -q 'BindReadOnlyPaths=/home/admin_1/projects/demo\$' '/etc/systemd/system/axle-mcp@bot2.service.d/50-grants.conf'"
apid="$(systemctl show -p MainPID --value axle-mcp@bot2)"
seen="$(sudo nsenter -t "$apid" -m ls /home | tr '\n' ' ')"
chk "lớp 2 (hộp cát): /home chỉ có ag-bot2 + khung dẫn tới thư mục được cấp (thấy: $seen)" test "$seen" = "admin_1 ag-bot2 "
owner_view="$(sudo nsenter -t "$apid" -m find /home/admin_1 -maxdepth 3 | sort | tr '\n' ' ')"
chk "lớp 2: trong /home/admin_1 chỉ có đường tới demo/data — không .ssh, .bashrc, other, tam, work ($owner_view)" \
  test "$owner_view" = "/home/admin_1 /home/admin_1/projects /home/admin_1/projects/demo /home/admin_1/projects/demo/data "
sudo rm -f /etc/sudoers.d/99-test
sync
EOF
echo "→ Đăng nhập SSH bằng mật khẩu (phải bị từ chối)"
if ssh -p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no \
     -o PreferredAuthentications=password,keyboard-interactive -o BatchMode=yes -o LogLevel=ERROR admin_1@localhost true 2>/dev/null; then
  echo "  ✗ vào được bằng mật khẩu"; exit 1
fi
echo "  ✓ máy chủ chỉ mời đăng nhập bằng khoá"
echo "✓ provision đạt"
