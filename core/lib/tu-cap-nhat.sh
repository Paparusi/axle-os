#!/usr/bin/env bash
# Axle TỰ CẬP NHẬT (nhịp D16, 24/9) — timer axle-tu-cap-nhat chạy lúc ~3 giờ sáng. Trước đây bản mới chỉ tới máy khi có
# người gõ `sudo axle update`.
#   1. Cài qua ĐÚNG install.sh: kiểm chữ ký, không hạ cấp, chụp hệ thống trước, chờ câu hỏi dở trên điện thoại xong.
#   2. Khám: dịch vụ lõi (bộ duyệt, cổng MCP, vault — cái nào đang bật) phải chạy trong 90 giây.
#   3. Hỏng (dựng máy lỗi hay dịch vụ không lên) → TỰ QUAY VỀ bản cũ (/opt/axle.prev), dựng lại máy bằng bản cũ, ghi bản
#      hỏng vào danh sách bỏ qua để đêm sau không cài lại đúng bản đó (bản mới hơn thì vẫn cài).
#   4. Mỗi lượt một dòng /var/lib/axle/cap-nhat.jsonl {luc, ket_qua: ok|kiem|loi|quay_ve|bo_qua, tu, len, ghi_chu, chi_tiet}
#      — bộ duyệt đọc để báo lên Bàn + app ("Axle đã lên …, có gì mới"), Bàn đọc để hiện lần gần nhất.
# Tắt: sudo axle update tu-dong off (/etc/axle/tu-cap-nhat.json {"bat": false}). Mọi đường dẫn đổi được bằng biến để thử
# (build/tu-cap-nhat-smoke.sh).
set -uo pipefail
OPT="${AXLE_OPT:-/opt/axle}"
CFG="${AXLE_TU_CAP_NHAT_CFG:-/etc/axle/tu-cap-nhat.json}"
NHAT_KY="${AXLE_CAP_NHAT_LOG:-/var/lib/axle/cap-nhat.jsonl}"
BO_QUA="${AXLE_CAP_NHAT_BO_QUA:-/var/lib/axle/cap-nhat-bo-qua}"
NGUON="${AXLE_RELEASE_SOURCE_FILE:-/etc/axle/release-source}"
SYSTEMCTL="${AXLE_SYSTEMCTL:-systemctl}"
DV_LOI="${AXLE_DV_LOI:-axle-approve axle-mcp-http axle-vault}"
KHAM_LAN="${AXLE_KHAM_LAN:-18}"          # 18 × 5 giây = 90 giây
KHAM_NGHI="${AXLE_KHAM_NGHI:-5}"

ban() { cut -d' ' -f1 "$OPT/VERSION" 2>/dev/null || echo "?"; }
ghi() {   # ghi <ket_qua> <tu> <len> <ghi_chu> <chi_tiet>
  mkdir -p "$(dirname "$NHAT_KY")"
  python3 - "$NHAT_KY" "$@" <<'PY'
import datetime, json, sys
f, kq, tu, len_, ghi_chu, chi_tiet = sys.argv[1:7]
d = {"luc": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "ket_qua": kq, "tu": tu, "len": len_,
     "ghi_chu": ghi_chu[:1000], "chi_tiet": chi_tiet[-800:]}
dong = []
try:
    dong = open(f, encoding="utf-8").read().splitlines()[-199:]   # giữ 200 lượt gần nhất
except OSError:
    pass
open(f, "w", encoding="utf-8").write("\n".join(dong + [json.dumps(d, ensure_ascii=False)]) + "\n")
PY
  chmod 0644 "$NHAT_KY" 2>/dev/null || true
  echo "tự cập nhật: $1 ${2}→${3} ${5:0:300}"
}
kham() {   # in tên dịch vụ lõi không chạy; rỗng = ổn
  local i dv hong=""
  for i in $(seq 1 "$KHAM_LAN"); do
    hong=""
    for dv in $DV_LOI; do
      "$SYSTEMCTL" is-enabled -q "$dv" 2>/dev/null || continue     # máy không bật dịch vụ đó thì thôi
      "$SYSTEMCTL" is-active -q "$dv" 2>/dev/null || hong+="$dv "
    done
    [ -z "$hong" ] && return 0
    sleep "$KHAM_NGHI"
  done
  printf '%s' "${hong% }"
  return 1
}

bat="$(python3 -c 'import json, sys
try: print("tat" if json.load(open(sys.argv[1])).get("bat") is False else "bat")
except Exception: print("bat")' "$CFG")"
[ "$bat" = bat ] || { echo "Tự cập nhật đang tắt (bật: sudo axle update tu-dong on)"; exit 0; }

TU="$(ban)"
# Bản mới nhất ở nơi phát hành (chỉ để so với danh sách bỏ qua — install.sh vẫn tự tải + kiểm chữ ký lại từ đầu)
if [ -s "$BO_QUA" ]; then
  src="$(cat "$NGUON" 2>/dev/null)"; src="${src%/}"
  moi="${AXLE_BAN_MOI_NHAT:-}"
  if [ -z "$moi" ] && [[ "$src" =~ ^https:// ]]; then
    moi="$(curl -fsSL --max-time 30 -H 'Cache-Control: no-cache' "$src/latest.json?t=$$-$(date +%s)" 2>/dev/null \
      | python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])' 2>/dev/null)"
  fi
  if [ -n "$moi" ] && grep -qxF "$moi" "$BO_QUA"; then
    ghi bo_qua "$TU" "$moi" "" "Bản $moi đã hỏng một lần trên máy này (đã tự quay về) — chờ bản sau."
    exit 0
  fi
fi

RA="$(mktemp)"; trap 'rm -f "$RA"' EXIT
if [ -n "${AXLE_CAI:-}" ]; then bash -c "$AXLE_CAI" >"$RA" 2>&1; else bash "$OPT/core/install.sh" --update </dev/null >"$RA" 2>&1; fi
MA=$?
cat "$RA"
LEN="$(ban)"
if [ "$LEN" = "$TU" ]; then
  # Không thay bản: đã mới nhất, hoặc hỏng TRƯỚC khi thay (mạng, chữ ký sai, gói hỏng) — máy vẫn nguyên như cũ
  if [ "$MA" = 0 ]; then ghi kiem "$TU" "$TU" "" "$(tail -n 1 "$RA")"
  else ghi loi "$TU" "$TU" "" "$(grep -v '^\s*$' "$RA" | tail -n 3 | tr '\n' ' ')"; fi
  exit "$MA"
fi

GHI_CHU="$(python3 -c 'import json, sys
try: print(json.load(open(sys.argv[1])).get("ghi_chu", ""))
except Exception: print("")' "$OPT/RELEASE.json")"
LY_DO=""
if [ "$MA" != 0 ]; then
  LY_DO="dựng máy bằng bản mới lỗi (mã $MA): $(grep -v '^\s*$' "$RA" | tail -n 2 | tr '\n' ' ')"
elif ! HONG="$(kham)"; then
  LY_DO="dịch vụ không chạy sau khi cài: $HONG"
fi
if [ -z "$LY_DO" ]; then
  ghi ok "$TU" "$LEN" "$GHI_CHU" ""
  exit 0
fi

# ---- Hỏng → quay về bản cũ ----
echo "✗ $LY_DO — quay về $TU"
if [ ! -d "$OPT.prev" ]; then
  ghi loi "$TU" "$LEN" "$GHI_CHU" "$LY_DO · không còn bản cũ ở $OPT.prev để quay về — axle undo về bản chụp trước khi cài"
  exit 1
fi
rm -rf "$OPT.hong"
mv "$OPT" "$OPT.hong" && mv "$OPT.prev" "$OPT"
echo "$LEN" >> "$BO_QUA"
if [ -n "${AXLE_PROVISION_CU:-}" ]; then bash -c "$AXLE_PROVISION_CU" >"$RA" 2>&1; else bash "$OPT/core/provision.sh" </dev/null >"$RA" 2>&1; fi
MA2=$?
HONG2="$(kham)"; K2=$?
if [ "$MA2" = 0 ] && [ "$K2" = 0 ]; then
  ghi quay_ve "$TU" "$LEN" "$GHI_CHU" "$LY_DO"
  exit 0
fi
ghi loi "$TU" "$LEN" "$GHI_CHU" "$LY_DO · quay về $TU cũng chưa lành (mã $MA2${HONG2:+, $HONG2}) — axle undo về bản chụp trước khi cài"
exit 1
