#!/usr/bin/env bash
# Thử `axle tay` THẬT trên một ứng dụng thật, không cần máy ảo: dựng một phiên D-Bus riêng + bus trợ năng, mở chính
# cửa sổ Axle (Bàn) với dữ liệu giả trong đó, rồi đi cây trợ năng: liệt kê cửa sổ, chụp bảng, gõ vào ô "Bảo Axle
# làm", đọc lại, bấm nút. Cần một màn hình (WSLg / GNOME / Xvfb) — ở WSLg dùng X11 + vẽ mềm.
#   build/tay-smoke.sh            (AXLE_GUI_PYTHON=/usr/bin/python3.12 nếu python3 mặc định không có gi)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${AXLE_GUI_PYTHON:-python3}"
# Phiên D-Bus riêng để không đụng phiên của người đang ngồi máy: chạy lại chính mình bên trong dbus-run-session
if [ -z "${AXLE_TAY_SMOKE_IN_DBUS:-}" ]; then
  exec env AXLE_TAY_SMOKE_IN_DBUS=1 dbus-run-session -- bash "$0" "$@"
fi
T="$(mktemp -d)"; trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$T"' EXIT
export GDK_BACKEND="${GDK_BACKEND:-x11}" GSK_RENDERER="${GSK_RENDERER:-cairo}" LIBGL_ALWAYS_SOFTWARE=1 LC_ALL=C.UTF-8

# Bus trợ năng do at-spi-bus-launcher cấp (org.a11y.Bus trên phiên vừa dựng)
L=/usr/libexec/at-spi-bus-launcher; [ -x "$L" ] || L="$(command -v at-spi-bus-launcher)"
"$L" --launch-immediately >/dev/null 2>&1 & sleep 1

# Dữ liệu giả cho Bàn (giống build/gui-shot.py) + axle giả
cat > "$T/ban.json" <<'EOF'
{"ts":"2026-09-21T10:00:00+07:00","host":"axle-thu","pending":[{"id":"a1b2c3d4","tier":2,"client":"ssh:claude","action":"claude_tool","buttons":"ahlr","ageSec":42,"text":"🔐 axle-thu · cần duyệt #a1b2c3d4\nAgent: ssh:claude\nViệc: Claude dùng Bash: `npm test`\nBậc 2\nHết hạn sau 10 phút"}],"homNay":{"chu_duyet":1,"tu_duyet":0,"tu_choi":0,"het_han":0},"agents":[{"ten":"claude","vai":"chinh","user":null,"tam_dung":false}]}
EOF
: > "$T/audit.jsonl"
printf '#!/bin/sh\ncase "$1 $2" in "agents --json") echo "[]";; "snapshots --csv") echo "number,date,description";; "dangnhap status") echo tat;; "app terminal") echo tat;; *) echo "thu: $*";; esac\n' > "$T/axle"; chmod +x "$T/axle"
AXLE_BIN="$T/axle" AXLE_BAN_FILE="$T/ban.json" AXLE_AUDIT_FILE="$T/audit.jsonl" "$PY" "$ROOT/core/desktop/axle-gui.py" >"$T/gui.log" 2>&1 &
sleep 4

set +e   # từ đây mỗi mục tự chấm, hỏng một mục không được giết cả bài
fail=0; ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✗ $2"; fail=$((fail + 1)); fi; }
tay() { HOME="$T" "$PY" "$ROOT/core/desktop/tay.py" "$@"; }

cs="$(tay cuaso 2>&1)"; echo "$cs" | sed 's/^/    /'
grep -q 'Bàn Axle' <<<"$cs"; ok $? "tay cuaso thấy cửa sổ \"Bàn Axle\" qua trợ năng"

bang="$(tay chup 2>&1)"; echo "$bang" | head -30 | sed 's/^/    /'
grep -q '"Làm"' <<<"$bang"; ok $? "bảng phần tử có nút \"Làm\""
grep -q '"Chế độ tay"' <<<"$bang"; ok $? "bảng có nút \"Chế độ tay\""
grep -q 'ô chữ' <<<"$bang"; ok $? "bảng có ô nhập chữ"
grep -q '"Lần này"' <<<"$bang"; ok $? "bảng có nút duyệt \"Lần này\" của việc đang chờ"

o="$(grep -m1 'ô chữ' <<<"$bang" | sed -E 's/^#([0-9]+).*/\1/')"
tay go "$o" "tóm tắt log tối qua" >"$T/go.log" 2>&1; ok $? "tay go: đặt chữ vào ô nhập qua EditableText ($(cat "$T/go.log"))"
d="$(tay doc "$o" 2>&1)"; [ "$d" = "tóm tắt log tối qua" ]; ok $? "tay doc đọc lại đúng chữ vừa gõ (đọc: \"$d\")"

n="$(grep -m1 '"Chế độ tay"' <<<"$bang" | sed -E 's/^#([0-9]+).*/\1/')"
tay bam "$n" >"$T/bam.log" 2>&1; ok $? "tay bam: bấm nút \"Chế độ tay\" qua Action ($(cat "$T/bam.log"))"

tay bam 9999 >"$T/sai.log" 2>&1 && r=0 || r=1; [ $r = 1 ] && grep -q 'chỉ có' "$T/sai.log"; ok $? "số ngoài bảng → báo rõ, không làm gì"

if [ "$fail" != 0 ]; then echo "✗ $fail mục hỏng"; tail -5 "$T/gui.log"; exit 1; fi
echo "✓ axle tay đạt (bấm/gõ/đọc qua cây trợ năng, không tiêm phím)"
