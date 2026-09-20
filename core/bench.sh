#!/usr/bin/env bash
# Đo cái giá Axle bắt máy phải trả: RAM lúc rảnh, thời gian khởi động, độ trễ snapshot, chỗ đĩa đã ăn.
#   axle bench            — in bảng số
#   axle bench --nghiem   — đối chiếu ngưỡng, quá thì thoát khác 0 (dùng trong bài thử / CI)
#
# Vì sao có file này: Axle có hơn 200 bài kiểm tính ĐÚNG, không bài nào kiểm tính NẶNG. Một bản phát hành
# có thể âm thầm ăn gấp đôi RAM hay thêm 30 giây khởi động mà không ai biết — đúng chuyện đã xảy ra
# 20/9/2026 (GRUB chờ 30 giây trên mọi máy EFI, không ai để ý cho tới khi ngồi đo).
set -uo pipefail

NGHIEM=0
[ "${1:-}" = --nghiem ] && NGHIEM=1

# Ngưỡng: đặt rộng rãi có chủ ý — đây là hàng rào chống tụt dốc, không phải mục tiêu tối ưu.
NGUONG_RAM_MB=${AXLE_BENCH_RAM_MB:-260}      # tổng RAM các dịch vụ axle-* lúc rảnh
NGUONG_LOADER_S=${AXLE_BENCH_LOADER_S:-8}    # GRUB: không được ngồi chờ menu
NGUONG_USERSPACE_S=${AXLE_BENCH_USERSPACE_S:-30}
NGUONG_SNAP_S=${AXLE_BENCH_SNAP_S:-5}        # chụp snapshot nằm trên đường găng của mọi việc bậc 3

hong=0
dat() { printf '  %-34s %-18s %s\n' "$1" "$2" "$3"; }
kiem() {   # tên · giá trị · ngưỡng · đơn vị
  local ten="$1" gia="$2" nguong="$3" dv="${4:-}"
  if [ "$NGHIEM" = 1 ] && awk "BEGIN{exit !($gia > $nguong)}"; then
    dat "$ten" "$gia$dv" "✗ quá ngưỡng $nguong$dv"; hong=$((hong + 1))
  else
    dat "$ten" "$gia$dv" "$([ "$NGHIEM" = 1 ] && echo "✓ ≤ $nguong$dv" || echo "(ngưỡng $nguong$dv)")"
  fi
}

echo "== RAM lớp Axle lúc rảnh =="
# Lấy theo cgroup (MemoryCurrent) chứ không theo RSS: RSS đếm trùng trang dùng chung, thổi số lên gấp đôi.
tong_kb=0
for u in $(systemctl list-units --type=service --all --no-legend 'axle*' 2>/dev/null | awk '{print $1}'); do
  [ "$(systemctl is-active "$u" 2>/dev/null)" = active ] || continue
  v="$(systemctl show "$u" -p MemoryCurrent --value 2>/dev/null)"
  case "$v" in ''|'[not set]'|0|*[!0-9]*) continue ;; esac
  mb="$(awk "BEGIN{printf \"%.1f\", $v/1048576}")"
  printf '  %-34s %s MB\n' "$u" "$mb"
  tong_kb=$((tong_kb + v / 1024))
done
tong_mb="$(awk "BEGIN{printf \"%.1f\", $tong_kb/1024}")"
echo
kiem "tổng lớp Axle" "$tong_mb" "$NGUONG_RAM_MB" " MB"
if [ -r /proc/meminfo ]; then
  tong_may="$(awk '/MemTotal/{printf "%.1f", $2/1048576}' /proc/meminfo)"
  dung_may="$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf "%.1f", (t-a)/1048576}' /proc/meminfo)"
  dat "toàn máy đang dùng" "$dung_may / $tong_may GB" "$(awk "BEGIN{printf \"Axle chiếm %.0f%%\", $tong_mb/1024/$dung_may*100}")"
fi

echo
echo "== Khởi động lần gần nhất =="
if command -v systemd-analyze >/dev/null; then
  d="$(systemd-analyze 2>/dev/null | head -1)"
  lay() { printf '%s' "$d" | grep -oE "[0-9.]+s \($1\)" | grep -oE '^[0-9.]+' || echo 0; }
  kiem "GRUB (loader)" "$(lay loader)" "$NGUONG_LOADER_S" "s"
  kiem "userspace" "$(lay userspace)" "$NGUONG_USERSPACE_S" "s"
  dat "tổng" "$(printf '%s' "$d" | grep -oE '= .*$' | tr -d '= ')" ""
  echo "  ba dịch vụ chậm nhất:"
  systemd-analyze blame 2>/dev/null | head -3 | sed 's/^/    /'
fi

echo
echo "== Snapshot (mọi việc bậc 3 đều chụp trước khi làm) =="
if command -v snapper >/dev/null && snapper -c root list >/dev/null 2>&1; then
  t0=$(date +%s.%N)
  so="$(snapper -c root create -t single -c number -d 'axle bench' --print-number 2>/dev/null)"
  t1=$(date +%s.%N)
  [ -n "$so" ] && snapper -c root delete "$so" >/dev/null 2>&1
  kiem "chụp một snapshot" "$(awk "BEGIN{printf \"%.2f\", $t1-$t0}")" "$NGUONG_SNAP_S" "s"
  dat "đang giữ" "$(snapper -c root list 2>/dev/null | grep -cE '^[0-9]') cái" "$(df -h / | awk 'NR==2{print "ổ " $5 " đầy"}')"
else
  dat "snapshot" "bỏ qua" "(cần sudo + snapper)"
fi

echo
if [ "$NGHIEM" = 1 ]; then
  [ "$hong" = 0 ] && echo "✓ hiệu năng: đạt" || echo "✗ $hong mục quá ngưỡng"
  exit $((hong > 0))
fi
echo "Chạy 'axle bench --nghiem' để đối chiếu ngưỡng (dùng trong bài thử)."
