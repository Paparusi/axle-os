#!/usr/bin/env python3
"""Dịch vụ nhỏ chạy TRONG phiên đồ hoạ của chủ, để Axle chụp được màn hình thật khi chủ đã cho phép
(docs/DESKTOP.md, nhịp D3).

Vì sao cần: agent chạy bằng user riêng (ag-<tên>), không với tới phiên đồ hoạ của chủ. Dịch vụ này là
đầu bên chủ; dịch vụ duyệt (chạy root) mới là chỗ kiểm quyền rồi hỏi sang đây.

Ổ cắm: $XDG_RUNTIME_DIR/axle-portal.sock (0600 — chỉ chủ mở được; root thì luôn mở được).
Lệnh (mỗi dòng một JSON):
    {"cmd":"shot"}    → {"ok":true,"png":"<base64>"}   (lần đầu GNOME hỏi chủ chọn màn hình)
    {"cmd":"forget"}  → quên giấy phép GNOME đã nhớ, lần sau hỏi lại
    {"cmd":"status"}  → còn giấy phép hay chưa
"""
import base64
import json
import os
import socket
import socketserver
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import portal_lib  # noqa: E402

SOCK = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "axle-portal.sock")
# Dịch vụ systemd của user KHÔNG có sẵn biến môi trường của phiên đồ hoạ (GNOME không phải lúc nào cũng
# nạp vào systemd). Thiếu XDG_CURRENT_DESKTOP là cổng xin phép không biết chọn backend nào → treo.
CAN = ("XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XDG_SESSION_DESKTOP", "WAYLAND_DISPLAY",
       "DISPLAY", "XAUTHORITY", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS")


def nap_moi_truong_phien():
    """Đọc môi trường từ tiến trình phiên đồ hoạ của chính mình (gnome-shell / gnome-session)."""
    me = os.getuid()
    for d in sorted(os.listdir("/proc")):
        if not d.isdigit():
            continue
        p = f"/proc/{d}"
        try:
            if os.stat(p).st_uid != me:
                continue
            with open(f"{p}/comm") as f:
                if f.read().strip() not in ("gnome-shell", "gnome-session-b", "gnome-session-binary"):
                    continue
            with open(f"{p}/environ", "rb") as f:
                env = dict(kv.split("=", 1) for kv in f.read().decode("utf-8", "replace").split("\0") if "=" in kv)
        except OSError:
            continue
        lay = {k: env[k] for k in CAN if k in env}
        if "XDG_CURRENT_DESKTOP" not in lay:
            continue
        os.environ.update(lay)
        return lay
    return None
KHOA = threading.Lock()   # mỗi lần một lời gọi: portal không thích bị hỏi song song


def chup_ra_bytes(timeout_s):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "shot.png")
        portal_lib.chup(out, timeout_s, im_lang=True)
        with open(out, "rb") as f:
            return f.read()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        for line in self.rfile:
            try:
                req = json.loads(line.decode("utf-8", "replace") or "{}")
            except ValueError:
                self.tra({"ok": False, "err": "JSON hỏng"})
                continue
            cmd = req.get("cmd")
            try:
                if cmd == "shot":
                    with KHOA:
                        png = chup_ra_bytes(int(req.get("timeout", 60)))
                    self.tra({"ok": True, "png": base64.b64encode(png).decode()})
                elif cmd == "forget":
                    portal_lib.quen_token()
                    self.tra({"ok": True})
                elif cmd == "status":
                    self.tra({"ok": True, "co_giay_phep": portal_lib.doc_token() is not None})
                else:
                    self.tra({"ok": False, "err": f"không hiểu lệnh {cmd!r}"})
            except portal_lib.PortalLoi as e:
                self.tra({"ok": False, "err": str(e)})
            except Exception as e:                      # noqa: BLE001 — lỗi nào cũng phải trả lời, đừng để bên kia treo
                self.tra({"ok": False, "err": f"{type(e).__name__}: {e}"})

    def tra(self, obj):
        self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode())
        self.wfile.flush()


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        print("✗ phải chạy trong phiên đồ hoạ của chủ (không có bus phiên)", file=sys.stderr)
        sys.exit(78)
    lay = nap_moi_truong_phien()
    if not lay:
        print("✗ chưa thấy phiên đồ hoạ nào của chủ — chờ đăng nhập rồi chạy lại", file=sys.stderr)
        sys.exit(75)   # EX_TEMPFAIL: systemd sẽ thử lại
    print(f"Axle portal: phiên {lay.get('XDG_CURRENT_DESKTOP')} ({lay.get('XDG_SESSION_TYPE')})", flush=True)
    try:
        os.unlink(SOCK)
    except OSError:
        pass
    srv = Server(SOCK, Handler)
    os.chmod(SOCK, 0o600)
    print(f"Axle portal: nghe ở {SOCK}", flush=True)
    try:
        srv.serve_forever()
    finally:
        try:
            os.unlink(SOCK)
        except OSError:
            pass
