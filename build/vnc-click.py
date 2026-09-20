#!/usr/bin/env python3
"""Bấm chuột vào máy ảo qua màn hình VNC của QEMU — dùng cho bài thử giao diện.

Chuột giả lập qua monitor của QEMU (`mouse_move`) nhiều khi guest không nhận; đường VNC thì chắc,
vì đó là đường người dùng thật cũng đi.

    build/vnc-click.py <cổng> <x> <y> [--chi-di-chuyen]

Chỉ nói chuyện RFB đủ để di chuột + bấm: bắt tay, bảo mật None, rồi gửi PointerEvent.
"""
import socket
import struct
import sys
import time


def noi(port):
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    ver = s.recv(12)                       # "RFB 003.008\n"
    if not ver.startswith(b"RFB"):
        raise SystemExit(f"✗ không phải máy chủ VNC: {ver!r}")
    s.sendall(b"RFB 003.008\n")
    n = s.recv(1)[0]
    if n == 0:
        raise SystemExit("✗ máy chủ VNC từ chối kết nối")
    types = s.recv(n)
    if 1 not in types:
        raise SystemExit(f"✗ máy chủ VNC đòi xác thực (kiểu {list(types)}) — bài thử chỉ đi kiểu None")
    s.sendall(bytes([1]))
    if struct.unpack(">I", s.recv(4))[0] != 0:
        raise SystemExit("✗ bắt tay VNC hỏng")
    s.sendall(bytes([1]))                  # ClientInit: dùng chung màn hình
    w, h = struct.unpack(">HH", s.recv(4))
    s.recv(16)                             # định dạng điểm ảnh
    ln = struct.unpack(">I", s.recv(4))[0]
    s.recv(ln)
    return s, w, h


def chuot(s, x, y, mask=0):
    s.sendall(struct.pack(">BBHH", 5, mask, x, y))
    time.sleep(0.25)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    port, x, y = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    s, w, h = noi(port)
    if not (0 <= x < w and 0 <= y < h):
        raise SystemExit(f"✗ ({x},{y}) nằm ngoài màn hình {w}x{h}")
    chuot(s, x, y)                         # di tới
    if "--chi-di-chuyen" not in sys.argv:
        chuot(s, x, y, 1)                  # nhấn
        chuot(s, x, y, 0)                  # nhả
    time.sleep(0.5)
    s.close()
    print(f"đã bấm ({x},{y}) trên màn hình {w}x{h}")
