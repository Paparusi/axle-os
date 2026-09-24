# Dùng chung cho provision và lớp Desktop: chờ apt của hệ thống rồi mới cài (máy mới bật hay tự cập nhật ngầm).
# Gọi apt_hold_timers một lần ở đầu script để tạm dừng lịch cập nhật tự động (bật lại khi script thoát).
# Máy mới bật hay tự chạy apt ngầm (apt-daily / unattended-upgrades) → provision đụng khoá apt và hỏng giữa chừng
# (bắt được 19/9 trên máy ảo sạch). Tạm dừng lịch cập nhật tự động, chờ lượt đang chạy xong; xong việc bật lại.
APT_TIMERS="apt-daily.timer apt-daily-upgrade.timer"
apt_hold_timers() {
  systemctl stop $APT_TIMERS 2>/dev/null || true
  # Dừng luôn lượt cập nhật ĐANG chạy: lần khởi động đầu, unattended-upgrades ôm khoá apt 5–20 phút,
  # mình đứng chờ y chừng đó. Nó nhận SIGTERM thì gói đang cài vẫn cài nốt rồi mới dừng (dpkg không dở dang),
  # phần còn lại để lượt sau cài tiếp — không mất bản vá nào.
  systemctl stop unattended-upgrades.service apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
  # Dừng giữa chừng thì systemd ghi "failed" (signal) — lỗi do chính mình, xoá đi kẻo máy tự báo "dịch vụ hỏng" (24/9)
  systemctl reset-failed apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
  trap 'systemctl start $APT_TIMERS 2>/dev/null || true; systemctl start unattended-upgrades.service 2>/dev/null || true' EXIT
}
# Bận = có tiến trình đang GIỮ khoá apt/dpkg, hoặc dịch vụ apt-daily đang chạy. Không dò theo tên tiến trình:
# unattended-upgrade-shutdown chạy THƯỜNG TRỰC, tên bị cắt còn "unattended-upgr" → dò theo tên là chờ mãi.
apt_busy() {
  systemctl is-active --quiet apt-daily.service apt-daily-upgrade.service unattended-upgrades-run.service 2>/dev/null && return 0
  if command -v fuser >/dev/null; then
    fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock >/dev/null 2>&1
  else
    pgrep -x 'apt-get|dpkg' >/dev/null
  fi
}
wait_apt() {
  local n=0
  while apt_busy; do
    [ "$n" = 0 ] && echo "  chờ apt đang chạy ngầm (cập nhật tự động lúc máy mới bật)…"
    n=$((n + 1))
    [ "$n" -le 360 ] || { echo "  apt bận quá 30 phút" >&2; return 1; }
    sleep 5
  done
}
aptg() { wait_apt; apt-get -o DPkg::Lock::Timeout=300 "$@"; }
