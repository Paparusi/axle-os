#!/usr/bin/env bash
# Dựng lõi Axle trên một máy Ubuntu vừa cài xong. Chạy lại bao nhiêu lần cũng được.
#
#   sudo AXLE_HOSTNAME=axle-office bash core/provision.sh
#
# Làm: công cụ cơ bản · /home và /var/lib/docker tách khỏi snapshot · snapper
#      (snapshot theo giờ + trước/sau mỗi lần cài gói) · tường lửa · Docker ·
#      Tailscale · Node (nvm) + PM2 · lệnh `axle`.
# Không làm: `tailscale up` (cần đăng nhập) — chạy `axle net up` sau.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng sudo" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
cd /   # bước tách /home thay thư mục /home — không được đứng bên trong nó
# Tài khoản CHỦ máy: đặt sẵn > đã ghi lúc cài trước > người gọi sudo > tài khoản đầu tiên (uid 1000)
if [ -z "${AXLE_USER:-}" ]; then
  if [ -s /etc/axle/owner ]; then AXLE_USER="$(cat /etc/axle/owner)"
  elif [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then AXLE_USER="$SUDO_USER"
  else AXLE_USER="$(getent passwd 1000 | cut -d: -f1)"; fi
fi
id "$AXLE_USER" >/dev/null 2>&1 || { echo "Không tìm ra tài khoản chủ máy — chạy lại với AXLE_USER=<tên>" >&2; exit 1; }
NODE_VERSION="${NODE_VERSION:-22}"
NVM_VERSION="v0.40.7"
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

. "$HERE/lib/apt.sh"
apt_hold_timers
is_subvol() { [ -d "$1" ] && [ "$(stat -f -c %T "$1")" = btrfs ] && [ "$(stat -c %i "$1")" = 256 ]; }

# Biến một thư mục thành subvolume riêng để snapshot của / không cuốn nó theo.
make_subvol() {
  local dir="$1"
  is_subvol "$dir" && return 0
  if [ -e "$dir" ]; then
    btrfs subvolume create "$dir.axle-new" >/dev/null
    # reflink=auto: file NOCOW (journal của journald) không clone được → chép thường
    cp -a --reflink=auto "$dir/." "$dir.axle-new/"
    mv "$dir" "$dir.axle-old" && mv "$dir.axle-new" "$dir" && rm -rf "$dir.axle-old"
  else
    btrfs subvolume create "$dir" >/dev/null
  fi
  echo "  $dir → subvolume riêng"
}

step "Tên máy"
if [ -n "${AXLE_HOSTNAME:-}" ] && [ "$(hostname)" != "$AXLE_HOSTNAME" ]; then
  old="$(hostname)"
  hostnamectl set-hostname "$AXLE_HOSTNAME"
  sed -i "s/\b$old\b/$AXLE_HOSTNAME/g" /etc/hosts /etc/issue
fi
echo "  $(hostname)"
# Màn đăng nhập tại chỗ: tên Axle + máy + IP. Ghi rõ nền Ubuntu (không mạo danh, không giấu nguồn).
printf '%s\n' 'Axle Server — dựa trên Ubuntu 26.04 LTS · \n · \l' 'IP: \4' '' > /etc/issue

step "Công cụ cơ bản"
aptg update -q
aptg install -yq curl ca-certificates gnupg git jq htop tmux unzip rsync \
  build-essential python3-venv python3-pip pipx btrfs-progs snapper ufw acl qrencode >/dev/null
echo "  xong"

step "Tách dữ liệu + nhật ký khỏi snapshot hệ thống"
[ "$(stat -f -c %T /)" = btrfs ] || { echo "Ổ gốc không phải btrfs" >&2; exit 1; }
make_subvol /home
if ! is_subvol /var/lib/docker && systemctl is-active -q docker 2>/dev/null; then
  systemctl stop docker docker.socket; make_subvol /var/lib/docker; systemctl start docker
else
  make_subvol /var/lib/docker
fi
# /var/log: undo mà cuốn theo nhật ký thì (1) xoá mất một đoạn nhật ký — thành cách xoá dấu vết,
# (2) auditd/journald cứ ghi vào file cũ đã bị thay → mọi thứ sau đó mất hút. Tách ra như openSUSE.
if ! is_subvol /var/log; then
  make_subvol /var/log
  # tiến trình đang mở file ở /var/log cũ (đã xoá) → khởi động lại để mở file mới
  systemctl restart systemd-journald
  for u in rsyslog auditd; do systemctl is-active -q "$u" && systemctl restart "$u"; done
fi
# /var/lib/tailscale: undo mà lôi khoá định danh cũ về thì máy rớt khỏi mạng riêng
if ! is_subvol /var/lib/tailscale; then
  if systemctl is-active -q tailscaled 2>/dev/null; then
    systemctl stop tailscaled; make_subvol /var/lib/tailscale; systemctl start tailscaled
  else
    make_subvol /var/lib/tailscale
  fi
fi

step "Swap sang subvolume riêng"
# btrfs không cho snapshot subvolume đang chứa swapfile bật (ETXTBSY) — trình cài
# Ubuntu đặt /swap.img ngay trên / nên phải dời đi trước khi snapper chạy được.
if grep -q '^/swap.img' /etc/fstab; then
  swapoff /swap.img 2>/dev/null || true
  rm -f /swap.img
  sed -i '\#^/swap.img#d' /etc/fstab
fi
is_subvol /swap || btrfs subvolume create /swap >/dev/null
if [ ! -f /swap/swapfile ]; then
  btrfs filesystem mkswapfile --size "${AXLE_SWAP:-4g}" /swap/swapfile >/dev/null
  echo '/swap/swapfile none swap defaults 0 0' >> /etc/fstab
fi
# Không dùng `lệnh | grep -q` dưới pipefail: grep thoát sớm → lệnh trước dính SIGPIPE → báo sai NGẪU NHIÊN
grep -qx '/swap/swapfile' <<<"$(swapon --show=NAME --noheadings)" || swapon /swap/swapfile
echo "  $(swapon --show=NAME,SIZE --noheadings)"

step "Snapshot (snapper)"
if ! grep -q '^root ' <<<"$(snapper list-configs 2>/dev/null)"; then
  snapper -c root create-config /
fi
snapper -c root set-config \
  TIMELINE_CREATE=yes TIMELINE_CLEANUP=yes NUMBER_CLEANUP=yes \
  TIMELINE_LIMIT_HOURLY=12 TIMELINE_LIMIT_DAILY=7 TIMELINE_LIMIT_WEEKLY=4 \
  TIMELINE_LIMIT_MONTHLY=3 TIMELINE_LIMIT_YEARLY=0 NUMBER_LIMIT=30
systemctl enable --now snapper-timeline.timer snapper-cleanup.timer >/dev/null 2>&1
# Snapshot trước/sau mỗi lần cài gói, nếu gói snapper chưa có sẵn hook
if ! grep -rqs snapper /etc/apt/apt.conf.d/; then
  cat > /etc/apt/apt.conf.d/80axle-snapper <<'EOF'
DPkg::Pre-Invoke  { "snapper -c root create -t pre  -c number -d 'apt' --print-number > /run/axle-apt-pre 2>/dev/null || true"; };
DPkg::Post-Invoke { "[ -s /run/axle-apt-pre ] && snapper -c root create -t post -c number -d 'apt' --pre-number $(cat /run/axle-apt-pre) || true; rm -f /run/axle-apt-pre"; };
EOF
fi
echo "  $(snapper -c root list | tail -n +3 | wc -l) snapshot hiện có"

step "SSH chỉ nhận khoá"
# Lộ mật khẩu thì người ngoài vẫn không SSH vào được; mật khẩu chỉ còn dùng tại máy và cho sudo.
# Chỉ tắt khi user đã có khoá, kẻo tự khoá mình ngoài cửa.
if [ -s "/home/$AXLE_USER/.ssh/authorized_keys" ]; then
  printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' \
    > /etc/ssh/sshd_config.d/50-axle.conf
  sshd -t && systemctl reload ssh
  echo "  tắt đăng nhập SSH bằng mật khẩu"
else
  echo "  CHƯA tắt mật khẩu: $AXLE_USER chưa có khoá SSH nào"
fi

step "Tường lửa"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw --force enable >/dev/null
echo "  chặn mọi kết nối vào trừ SSH và Tailscale"

step "Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  aptg update -q
  aptg install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
usermod -aG docker "$AXLE_USER"
systemctl enable --now docker >/dev/null 2>&1
echo "  $(docker --version)"

step "Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$CODENAME.noarmor.gpg" \
    -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/$CODENAME.tailscale-keyring.list" \
    -o /etc/apt/sources.list.d/tailscale.list
  aptg update -q
  aptg install -yq tailscale >/dev/null
fi
systemctl enable --now tailscaled >/dev/null 2>&1
echo "  $(tailscale version | head -1)"

step "Node $NODE_VERSION + PM2 (cho $AXLE_USER)"
sudo -u "$AXLE_USER" -H bash -s "$NVM_VERSION" "$NODE_VERSION" <<'EOF'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$1/install.sh" | bash >/dev/null
. "$NVM_DIR/nvm.sh"
nvm install "$2" >/dev/null 2>&1
nvm alias default "$2" >/dev/null
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null 2>&1
echo "  node $(node -v), pm2 $(pm2 -v 2>/dev/null | tail -1)"
EOF
NODE_BIN="$(sudo -u "$AXLE_USER" -H bash -c '. ~/.nvm/nvm.sh && dirname "$(command -v node)"')"
env PATH="$NODE_BIN:$PATH" "$NODE_BIN/pm2" startup systemd -u "$AXLE_USER" --hp "/home/$AXLE_USER" >/dev/null
echo "  PM2 tự bật cùng máy"

step "Lệnh axle + cổng MCP"
mkdir -p /etc/axle /opt/axle /usr/local/lib/axle
if [ -f "$HERE/../VERSION" ]; then cp "$HERE/../VERSION" /etc/axle/version   # cài từ gói phát hành
else git -C "$HERE/.." rev-parse --short HEAD 2>/dev/null > /etc/axle/version || date +%F > /etc/axle/version; fi
# Chạy từ chính /opt/axle (cài bằng gói phát hành / axle update) thì không chép lên chính mình
if [ "$(realpath "$HERE/..")" != /opt/axle ]; then
  rsync -a --delete --exclude .git --exclude work --exclude out --exclude cache --exclude node_modules \
    "$HERE/../" /opt/axle/
fi
chown -R root:root /opt/axle
install -m 0755 "$HERE/bin/axle" /usr/local/bin/axle
install -m 0755 -o root -g root "$HERE/lib/axle-snap" /usr/local/lib/axle/axle-snap
install -m 0755 -o root -g root "$HERE/lib/axle-cmdlog" /usr/local/lib/axle/axle-cmdlog
# User thường chụp/xem snapshot và đọc nhật ký lệnh không cần mật khẩu, CHỈ qua 2 cửa hẹp này
echo "$AXLE_USER ALL=(root) NOPASSWD: /usr/local/lib/axle/axle-snap, /usr/local/lib/axle/axle-cmdlog" > /etc/sudoers.d/axle.new
chmod 0440 /etc/sudoers.d/axle.new
visudo -cqf /etc/sudoers.d/axle.new && mv /etc/sudoers.d/axle.new /etc/sudoers.d/axle
usermod -aG systemd-journal "$AXLE_USER"   # đọc log hệ thống không cần sudo
install -d -o "$AXLE_USER" -g "$AXLE_USER" "/home/$AXLE_USER/work"   # vùng agent được ghi file
# Thư viện MCP: gói phát hành đã đóng sẵn (dấu .axle-lock = băm package-lock) → khỏi tải lại
LOCK_SHA="$(sha256sum /opt/axle/mcp/package-lock.json | cut -d' ' -f1)"
if [ "$(cat /opt/axle/mcp/node_modules/.axle-lock 2>/dev/null)" != "$LOCK_SHA" ]; then
  (cd /opt/axle/mcp && env PATH="$NODE_BIN:$PATH" npm ci --omit=dev --silent)
  echo "$LOCK_SHA" > /opt/axle/mcp/node_modules/.axle-lock
fi
# Danh sách công cụ (để `axle mcp client add` kiểm tên) + sổ token HTTP (hash, root sở hữu, agent chỉ đọc)
env PATH="$NODE_BIN:$PATH" node --input-type=module \
  -e "const m = await import('/opt/axle/mcp/tools.js'); console.log(JSON.stringify(m.toolInfo()))" > /etc/axle/mcp-tools.json
getent group axle-agent >/dev/null || groupadd --system axle-agent
usermod -aG axle-agent "$AXLE_USER"
# Cửa trước chạy bằng axle-gw (không quyền gì); máy chủ từng agent chạy bằng ag-<tên>, cả hai dùng Node hệ thống
command -v /usr/bin/node >/dev/null || aptg install -yq nodejs >/dev/null
id axle-gw >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group axle-gw
[ -f /etc/axle/mcp-clients.json ] || echo '{}' > /etc/axle/mcp-clients.json
[ -f /etc/axle/agents-state.json ] || echo '{"suspended":[]}' > /etc/axle/agents-state.json
chmod 0644 /etc/axle/agents-state.json
install -d -m 0755 /etc/axle/grants
echo "$AXLE_USER" > /etc/axle/owner
chown root:axle-gw /etc/axle/mcp-clients.json; chmod 0640 /etc/axle/mcp-clients.json
install -m 0644 /opt/axle/mcp/axle-mcp-http.service /etc/systemd/system/axle-mcp-http.service
install -m 0644 "/opt/axle/mcp/axle-mcp@.socket" "/opt/axle/mcp/axle-mcp@.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable axle-mcp-http >/dev/null 2>&1
systemctl restart axle-mcp-http
/usr/local/bin/axle agent resync
echo "  /usr/local/bin/axle, cổng MCP stdio + cửa trước HTTP 127.0.0.1:8765 ($(jq length /etc/axle/mcp-tools.json) công cụ, $(jq length /etc/axle/mcp-clients.json) agent, bản $(cat /etc/axle/version))"

step "Nhật ký lệnh (auditd)"
# Nhân Linux ghi MỌI chương trình được chạy trong phiên đăng nhập của user (kể cả qua sudo, lệnh con,
# lệnh cổng MCP chạy hộ). Chỉ root đọc/ghi được /var/log/audit → agent không xoá được dấu vết.
command -v auditctl >/dev/null || aptg install -yq auditd >/dev/null
AXLE_UID="$(id -u "$AXLE_USER")"
printf '%s\n' \
  "# Axle: mọi lệnh chạy từ phiên đăng nhập của $AXLE_USER (auid=$AXLE_UID)" \
  "-a always,exit -F arch=b64 -S execve,execveat -F auid=$AXLE_UID -F key=axle-cmd" \
  "-a always,exit -F arch=b32 -S execve,execveat -F auid=$AXLE_UID -F key=axle-cmd" \
  > /etc/audit/rules.d/50-axle.rules
# log_group=root: user đầu tiên của Ubuntu thuộc nhóm adm, mà mặc định adm đọc được nhật ký audit
# (chứa cả lệnh người gõ tay, có thể dính token) → chỉ root đọc; axle cmdlog đi qua cửa hẹp.
sed -i -E 's/^max_log_file = .*/max_log_file = 50/; s/^num_logs = .*/num_logs = 10/; s/^max_log_file_action = .*/max_log_file_action = ROTATE/; s/^log_group = .*/log_group = root/' /etc/audit/auditd.conf
systemctl enable auditd >/dev/null 2>&1
systemctl restart auditd
chgrp -R root /var/log/audit && chmod 0700 /var/log/audit && chmod 0600 /var/log/audit/audit.log*
# Khởi động lại auditd tự kéo theo audit-rules.service (xoá hết luật → nạp lại). Tự chạy augenrules song song
# sẽ đua với nó: có khoảnh khắc nhân KHÔNG còn luật nào. → Gọi đúng dịch vụ đó (chờ xong), rồi chờ luật xuất hiện.
if systemctl cat audit-rules.service >/dev/null 2>&1; then systemctl restart audit-rules.service
else augenrules --load >/dev/null 2>&1 || true; fi
for _ in $(seq 1 50); do grep -q axle-cmd <<<"$(auditctl -l)" && break; sleep 0.1; done
grep -q axle-cmd <<<"$(auditctl -l)" || { echo "Nạp luật auditd thất bại" >&2; exit 1; }
echo "  ghi mọi lệnh của $AXLE_USER · nhật ký 50MB × 10 bản xoay vòng"

step "Vault"
# Node của hệ thống cho vault: root sở hữu, agent không sửa được (khác Node trong ~/.nvm)
command -v /usr/bin/node >/dev/null || aptg install -yq nodejs >/dev/null
getent group axle-agent >/dev/null || groupadd --system axle-agent
id axle-vault >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent \
  --shell /usr/sbin/nologin --user-group axle-vault
usermod -aG axle-agent "$AXLE_USER"
# Khoá không vào snapshot hệ thống (undo không được lôi khoá cũ về)
make_subvol /var/lib/axle-vault
# file rỗng (mất điện lúc vừa tạo) cũng coi như chưa có
[ -s /var/lib/axle-vault/secrets.json ] || { echo '{}' > /var/lib/axle-vault/secrets.json; sync /var/lib/axle-vault/secrets.json; }
chown -R axle-vault:axle-vault /var/lib/axle-vault
chmod 700 /var/lib/axle-vault; chmod 600 /var/lib/axle-vault/secrets.json
install -d -o axle-vault -g axle-agent -m 0750 /var/log/axle-vault
install -m 0644 /opt/axle/vault/axle-vault.service /etc/systemd/system/axle-vault.service
install -m 0644 "/opt/axle/vault/axle-vault-agent@.socket" /etc/systemd/system/
systemctl daemon-reload
systemctl enable axle-vault >/dev/null 2>&1
systemctl restart axle-vault
for _ in 1 2 3 4 5; do [ -S /run/axle-vault/vault.sock ] && break; sleep 1; done
[ -S /run/axle-vault/vault.sock ] || { journalctl -u axle-vault -n 20 --no-pager; exit 1; }
echo "  node hệ thống $(/usr/bin/node -v), $(jq length /var/lib/axle-vault/secrets.json) khoá"

/usr/local/bin/axle agent resync

step "Duyệt qua Telegram"
install -m 0644 /opt/axle/approve/axle-approve.service /etc/systemd/system/axle-approve.service
systemctl daemon-reload
systemctl enable axle-approve >/dev/null 2>&1
systemctl restart axle-approve
for _ in 1 2 3 4 5; do [ -S /run/axle-approve/approve.sock ] && break; sleep 1; done
[ -S /run/axle-approve/approve.sock ] || { journalctl -u axle-approve -n 20 --no-pager; exit 1; }
if [ -f /etc/axle/approve.json ]; then echo "  chủ Telegram: $(jq -r .owner /etc/axle/approve.json)"
else echo "  chưa nối Telegram: sudo axle approve setup --owner <id>"; fi

snapper -c root create -t single -c number -d "axle provision $(cat /etc/axle/version)" >/dev/null
sync   # mất điện ngay sau khi dựng máy thì các file vừa ghi vẫn còn nguyên
step "Xong. Việc còn lại: axle net up"
