#!/usr/bin/env bash
# Soi lỗi tĩnh trong script provision: heredoc KHÔNG bọc nháy (cần biến) mà chứa dấu huyền hay $( … ) là bash
# CHẠY LỆNH lúc provision — 21/9 một dấu huyền trong comment của 99-axle đã gọi nhầm `axle tay` trên máy thật.
#   build/provision-lint.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
for f in "$ROOT"/core/provision.sh "$ROOT"/core/desktop/provision-desktop.sh "$ROOT"/core/install.sh; do
  # Duyệt từng heredoc: mở bằng <<TỪ (không nháy) → tới dòng TỪ; trong đó soi ` và $(
  awk -v f="$f" '
    /<<[A-Za-z_][A-Za-z_0-9]*[[:space:]]*$/ && !/<<'"'"'/ && !/<<"/ {
      match($0, /<<[A-Za-z_][A-Za-z_0-9]*/); tag = substr($0, RSTART + 2, RLENGTH - 2); trong = 1; next
    }
    trong && $0 == tag { trong = 0; next }
    trong && (/`/ || /\$\(/) { printf "  ✗ %s:%d: heredoc <<%s không bọc nháy có dấu huyền/$( → bash sẽ CHẠY: %s\n", f, NR, tag, $0; bad = 1 }
    END { exit bad ? 1 : 0 }
  ' "$f" || fail=1
done
bash -n "$ROOT"/core/provision.sh "$ROOT"/core/desktop/provision-desktop.sh "$ROOT"/core/install.sh || fail=1
[ "$fail" = 0 ] && echo "✓ provision: heredoc không bọc nháy sạch dấu huyền/\$(, cú pháp bash ổn" || { echo "✗ provision lint hỏng"; exit 1; }
