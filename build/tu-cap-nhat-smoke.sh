#!/usr/bin/env bash
# Thử core/lib/tu-cap-nhat.sh trên thư mục giả: bộ cài giả (đổi bản / hỏng mạng / dựng máy lỗi), systemctl giả (dịch vụ
# nào hỏng đọc từ tệp trạng thái), dựng-lại-bản-cũ giả. Không đụng /opt, /etc, systemd thật.   bash build/tu-cap-nhat-smoke.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
chk() { if eval "$1"; then ok 0 "$2"; else ok 1 "$2"; fi; }

export AXLE_OPT="$T/opt/axle" AXLE_TU_CAP_NHAT_CFG="$T/cfg.json" AXLE_CAP_NHAT_LOG="$T/cap-nhat.jsonl" AXLE_CAP_NHAT_BO_QUA="$T/bo-qua"
export AXLE_RELEASE_SOURCE_FILE="$T/nguon" AXLE_KHAM_LAN=2 AXLE_KHAM_NGHI=0 AXLE_DV_LOI="axle-approve axle-vault"
# systemctl giả: mọi dịch vụ đang bật; "active" trừ khi tên nằm trong $T/dv-hong
cat > "$T/systemctl" <<EOF
#!/bin/bash
case "\$1" in is-enabled) exit 0 ;; is-active) grep -qxF "\$3" "$T/dv-hong" 2>/dev/null && exit 3; exit 0 ;; esac
EOF
chmod +x "$T/systemctl"; export AXLE_SYSTEMCTL="$T/systemctl"
# Bộ cài giả theo $T/che-do: moi-nhat | mang | ok | dung-loi | mat-ban-cu
cat > "$T/cai.sh" <<EOF
#!/bin/bash
touch "$T/da-goi-cai"
O="\$AXLE_OPT"
doi_ban() { rm -rf "\$O.prev"; mv "\$O" "\$O.prev"; mkdir -p "\$O"; echo "0.1.164 (moi)" > "\$O/VERSION"
  printf '{"version": "0.1.164", "ghi_chu": "Chu\\\\u1ed9t ph\\\\u1ea3i trong Files."}' > "\$O/RELEASE.json"; }
case "\$(cat "$T/che-do")" in
  moi-nhat) echo "Đang ở bản mới nhất (0.1.163)"; exit 0 ;;
  mang) echo "✗ Không tải được https://x/latest.json"; exit 1 ;;
  ok) doi_ban; echo "✓ Axle Server 0.1.164 đã sẵn sàng"; exit 0 ;;
  dung-loi) doi_ban; echo "✗ provision lỗi"; exit 1 ;;
  mat-ban-cu) doi_ban; rm -rf "\$O.prev"; exit 1 ;;
esac
EOF
export AXLE_CAI="bash $T/cai.sh"
export AXLE_PROVISION_CU="rm -f $T/dv-hong; exit \$(cat $T/provision-cu-ma 2>/dev/null || echo 0)"
lai() {   # dựng lại máy giả ở bản 0.1.163
  rm -rf "$T/opt" "$T/da-goi-cai" "$T/dv-hong" "$T/provision-cu-ma"; mkdir -p "$AXLE_OPT"; echo "0.1.163 (cu)" > "$AXLE_OPT/VERSION"
}
chay() { bash "$ROOT/core/lib/tu-cap-nhat.sh" >"$T/ra" 2>&1; echo $?; }
cuoi() { python3 -c 'import json, sys; d = json.loads(open(sys.argv[1]).read().splitlines()[-1]); print(d[sys.argv[2]])' "$AXLE_CAP_NHAT_LOG" "$1"; }
ban() { cut -d' ' -f1 "$AXLE_OPT/VERSION"; }

lai; echo '{"bat": false}' > "$AXLE_TU_CAP_NHAT_CFG"
m=$(chay); chk "[ $m = 0 ] && [ ! -e '$T/da-goi-cai' ] && [ ! -e '$AXLE_CAP_NHAT_LOG' ] && grep -q 'đang tắt' '$T/ra'" "tắt → không cài, không ghi gì"
echo '{"bat": true}' > "$AXLE_TU_CAP_NHAT_CFG"

lai; echo moi-nhat > "$T/che-do"; m=$(chay)
chk "[ $m = 0 ] && [ \$(cuoi ket_qua) = kiem ] && [ \$(ban) = 0.1.163 ]" "đã mới nhất → ghi 'kiem', không đổi gì"

lai; echo mang > "$T/che-do"; m=$(chay)
chk "[ $m = 1 ] && [ \$(cuoi ket_qua) = loi ] && [ \$(ban) = 0.1.163 ] && [ ! -e '$AXLE_OPT.hong' ] && cuoi chi_tiet | grep -q latest.json" \
  "mất mạng trước khi thay → ghi 'loi' kèm lý do, máy nguyên như cũ, không quay về"

lai; echo ok > "$T/che-do"; m=$(chay)
chk "[ $m = 0 ] && [ \$(cuoi ket_qua) = ok ] && [ \$(cuoi tu) = 0.1.163 ] && [ \$(cuoi len) = 0.1.164 ] && [ \"\$(cuoi ghi_chu)\" = 'Chuột phải trong Files.' ] && [ \$(ban) = 0.1.164 ]" \
  "lên bản mới, dịch vụ chạy → ghi 'ok' từ 0.1.163 lên 0.1.164 kèm ghi chú phát hành (từ RELEASE.json đã ký)"

lai; echo ok > "$T/che-do"; echo axle-approve > "$T/dv-hong"; m=$(chay)
chk "[ $m = 0 ] && [ \$(cuoi ket_qua) = quay_ve ] && [ \$(ban) = 0.1.163 ] && [ \$(cut -d' ' -f1 '$AXLE_OPT.hong/VERSION') = 0.1.164 ] && grep -qxF 0.1.164 '$AXLE_CAP_NHAT_BO_QUA' && cuoi chi_tiet | grep -q axle-approve" \
  "cài xong mà bộ duyệt không chạy → tự quay về 0.1.163, giữ bản hỏng ở .hong, ghi bản hỏng vào danh sách bỏ qua"

rm -f "$T/da-goi-cai"; AXLE_BAN_MOI_NHAT=0.1.164 m=$(AXLE_BAN_MOI_NHAT=0.1.164 chay)
chk "[ $m = 0 ] && [ \$(cuoi ket_qua) = bo_qua ] && [ ! -e '$T/da-goi-cai' ] && [ \$(ban) = 0.1.163 ]" "đêm sau vẫn là bản hỏng đó → bỏ qua, không cài lại"
rm -f "$T/da-goi-cai"; echo moi-nhat > "$T/che-do"; m=$(AXLE_BAN_MOI_NHAT=0.1.165 chay)
chk "[ -e '$T/da-goi-cai' ]" "có bản mới hơn bản hỏng → cài như thường"
rm -f "$AXLE_CAP_NHAT_BO_QUA"

lai; echo dung-loi > "$T/che-do"; m=$(chay)
chk "[ $m = 0 ] && [ \$(cuoi ket_qua) = quay_ve ] && [ \$(ban) = 0.1.163 ] && cuoi chi_tiet | grep -q 'dựng máy bằng bản mới lỗi'" "dựng máy bằng bản mới lỗi → tự quay về, ghi lý do"
rm -f "$AXLE_CAP_NHAT_BO_QUA"

lai; echo mat-ban-cu > "$T/che-do"; m=$(chay)
chk "[ $m = 1 ] && [ \$(cuoi ket_qua) = loi ] && cuoi chi_tiet | grep -q 'không còn bản cũ'" "hỏng mà không còn bản cũ → ghi 'loi', chỉ đường axle undo"

lai; echo ok > "$T/che-do"; echo axle-vault > "$T/dv-hong"; echo 1 > "$T/provision-cu-ma"; m=$(chay)
chk "[ $m = 1 ] && [ \$(cuoi ket_qua) = loi ] && cuoi chi_tiet | grep -q 'cũng chưa lành'" "quay về mà dựng bản cũ cũng lỗi → ghi 'loi' (bộ duyệt báo có rung)"
rm -f "$AXLE_CAP_NHAT_BO_QUA"

for i in $(seq 1 205); do echo '{"luc": "x", "ket_qua": "kiem"}' >> "$AXLE_CAP_NHAT_LOG"; done
lai; echo moi-nhat > "$T/che-do"; chay >/dev/null
chk "[ \$(wc -l < '$AXLE_CAP_NHAT_LOG') = 200 ]" "nhật ký giữ 200 lượt gần nhất"

[ "$fail" = 0 ] || { echo "✗ $fail mục hỏng"; exit 1; }
echo "✓ tự cập nhật đạt"
