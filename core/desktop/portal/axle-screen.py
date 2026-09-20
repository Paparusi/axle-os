#!/usr/bin/env python3
"""Chụp màn hình THẬT của chủ (axle screen chup) — GNOME hỏi trước, chủ đồng ý mới có hình.

    axle-screen.py shot <tệp.png> [--han-giay 60]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from portal_lib import PortalLoi, chup  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "shot":
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    han = 60
    if "--han-giay" in sys.argv:
        han = int(sys.argv[sys.argv.index("--han-giay") + 1])
    if not os.environ.get("XDG_RUNTIME_DIR") or not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        print("✗ phải chạy TRONG phiên đồ hoạ của chủ (thiếu DBUS_SESSION_BUS_ADDRESS)", file=sys.stderr)
        sys.exit(1)
    try:
        chup(sys.argv[2], han)
    except PortalLoi as e:
        print(f"✗ {e}", file=sys.stderr)
        sys.exit(1)
