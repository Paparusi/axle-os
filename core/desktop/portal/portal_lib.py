#!/usr/bin/env python3
"""Lõi chụp màn hình thật của chủ qua cổng xin phép của GNOME (docs/DESKTOP.md, nhịp D3).

Chạy TRONG phiên đồ hoạ của chủ (không phải root): GNOME hiện hộp thoại "chọn màn hình để chia sẻ",
chủ bấm đồng ý thì mới có hình. Không có đường nào lách hộp thoại đó — lách được một lần là mất luôn
thứ khiến người ta dám cài Axle.

Lần đầu hỏi; những lần sau trong cùng một phiên dùng lại giấy phép đã lưu (persist_mode=2) nên không
hỏi lại — GNOME vẫn hiện biểu tượng "đang chia sẻ màn hình" trên thanh trên cùng suốt thời gian đó.
"""
import os
import random
import sys

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst  # noqa: E402

BUS = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
IFACE = "org.freedesktop.portal.ScreenCast"
TOKEN_FILE = os.path.join(
    os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "axle", "screencast-token"
)


class PortalLoi(Exception):
    """Hỏng ở tầng cổng xin phép / lấy hình — gọi bên ngoài tự quyết in ra hay trả về."""


def loi(msg, code=1):
    raise PortalLoi(msg)


class Portal:
    def __init__(self, timeout_s):
        self.timeout_s = timeout_s
        self.loop = GLib.MainLoop()
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        # Tên duy nhất của mình trên bus → dùng để đoán đường dẫn "Request" mà portal sẽ trả lời
        self.me = self.bus.get_unique_name()[1:].replace(".", "_")
        self.result = None
        self.err = None

    def call(self, method, sig="", values=(), opts=None):
        """Gọi một lời gọi kiểu portal: sig+values là tham số vị trí, opts là a{sv}.
        Portal trả lời bất đồng bộ qua tín hiệu Response trên một đường dẫn Request đoán trước được."""
        token = f"axle{random.randint(0, 2**32)}"
        handle = f"/org/freedesktop/portal/desktop/request/{self.me}/{token}"
        opts = dict(opts or {})
        opts["handle_token"] = GLib.Variant("s", token)
        got = {}

        def on_response(_conn, _sender, _path, _iface, _sig, params):
            got["code"], got["data"] = params.unpack()
            self.loop.quit()

        sub = self.bus.signal_subscribe(
            BUS, "org.freedesktop.portal.Request", "Response", handle, None,
            Gio.DBusSignalFlags.NONE, on_response,
        )
        body = GLib.Variant(f"({sig}a{{sv}})", tuple(values) + (opts,))
        try:
            self.bus.call_sync(BUS, PATH, IFACE, method, body, None, Gio.DBusCallFlags.NONE, -1, None)
        except GLib.Error as e:
            self.bus.signal_unsubscribe(sub)
            loi(f"gọi {method} hỏng: {e.message}")
        # Hết giờ thì thôi, đừng treo vĩnh viễn (chủ không bấm gì trong hộp thoại)
        tid = GLib.timeout_add_seconds(self.timeout_s, lambda: (self.loop.quit(), False)[1])
        self.loop.run()
        GLib.Source.remove(tid)
        self.bus.signal_unsubscribe(sub)
        if "code" not in got:
            # Hết giờ mà không đóng yêu cầu thì hộp thoại của GNOME nằm lại trên màn hình mãi mãi
            try:
                self.bus.call_sync(BUS, handle, "org.freedesktop.portal.Request", "Close",
                                   None, None, Gio.DBusCallFlags.NONE, 3000, None)
            except GLib.Error:
                pass
            loi(f"chủ không trả lời hộp thoại xin phép trong {self.timeout_s} giây")
        if got["code"] != 0:
            loi("chủ đã từ chối chia sẻ màn hình" if got["code"] == 1 else f"portal trả mã {got['code']}")
        return got["data"]


def doc_token():
    try:
        with open(TOKEN_FILE) as f:
            return f.read().strip() or None
    except OSError:
        return None


def quen_token():
    """Quên giấy phép GNOME đã nhớ → lần sau hỏi lại chủ."""
    try:
        os.unlink(TOKEN_FILE)
        return True
    except OSError:
        return False


def ghi_token(t):
    if not t:
        return
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        os.chmod(TOKEN_FILE, 0o600)
        f.write(t)


def man_hinh_dang_khoa():
    """Màn hình khoá thì KHÔNG chụp: chủ đang rời máy, không ai xác nhận được gì."""
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        r = bus.call_sync("org.gnome.ScreenSaver", "/org/gnome/ScreenSaver", "org.gnome.ScreenSaver",
                          "GetActive", None, GLib.VariantType("(b)"), Gio.DBusCallFlags.NONE, 3000, None)
        return bool(r.unpack()[0])
    except GLib.Error:
        return False   # không hỏi được thì thôi, để portal tự quyết


def chup(out, timeout_s, im_lang=False, rong=None, chat_luong=None):
    """rong/chat_luong: chụp ra JPEG thu nhỏ (gửi qua trạm chuyển tiếp, hộp tối đa 64KB).
    Không truyền thì ra PNG nguyên cỡ như cũ."""
    if man_hinh_dang_khoa():
        loi("màn hình của chủ đang khoá — chủ đang rời máy, không chụp")
    p = Portal(timeout_s)
    sess = p.call("CreateSession", opts={"session_handle_token": GLib.Variant("s", f"axle{random.randint(0, 2**32)}")})
    handle = sess["session_handle"]

    opts = {
        "types": GLib.Variant("u", 1),          # 1 = màn hình (monitor)
        "multiple": GLib.Variant("b", False),
        "cursor_mode": GLib.Variant("u", 2),    # con trỏ vẽ luôn vào hình
        "persist_mode": GLib.Variant("u", 2),   # nhớ giấy phép cho lần sau
    }
    cu = doc_token()
    if cu:
        opts["restore_token"] = GLib.Variant("s", cu)
    p.call("SelectSources", "o", (handle,), opts)

    started = p.call("Start", "os", (handle, ""))
    ghi_token(started.get("restore_token"))
    streams = started.get("streams") or []
    if not streams:
        loi("chủ đồng ý nhưng không chọn màn hình nào")
    node_id = streams[0][0]

    fd_list = None
    try:
        ret, fd_list = p.bus.call_with_unix_fd_list_sync(
            BUS, PATH, IFACE, "OpenPipeWireRemote",
            GLib.Variant("(oa{sv})", (handle, {})), GLib.VariantType("(h)"),
            Gio.DBusCallFlags.NONE, -1, None, None,
        )
    except GLib.Error as e:
        loi(f"không mở được luồng hình: {e.message}")
    fd = fd_list.get(ret.unpack()[0])

    Gst.init(None)
    # Dựng ống bằng tay chứ KHÔNG ghép chuỗi: tên tệp có dấu cách hay dấu nháy là gst hiểu sai đường dẫn
    pipe = Gst.Pipeline.new("axle-shot")
    nho = rong is not None
    chuoi = (("pipewiresrc", "videoconvert", "videoscale", "jpegenc", "filesink") if nho
             else ("pipewiresrc", "videoconvert", "pngenc", "filesink"))
    els = {}
    for ten in chuoi:
        e = Gst.ElementFactory.make(ten, None)
        if e is None:
            loi(f"thiếu phần tử GStreamer '{ten}' (cài: sudo apt install gstreamer1.0-pipewire gstreamer1.0-plugins-good)")
        els[ten] = e
        pipe.add(e)
    els["pipewiresrc"].set_property("fd", fd)
    els["pipewiresrc"].set_property("path", str(node_id))
    els["pipewiresrc"].set_property("num-buffers", 1)
    els["filesink"].set_property("location", out)
    if nho:
        els["jpegenc"].set_property("quality", int(chat_luong or 50))
        # Ép bề ngang, để cao tự theo tỉ lệ (-1) — không thì ảnh bị bóp méo
        caps = Gst.Caps.from_string(f"video/x-raw,width={int(rong)},pixel-aspect-ratio=1/1")
        noi = (els["pipewiresrc"].link(els["videoconvert"])
               and els["videoconvert"].link(els["videoscale"])
               and els["videoscale"].link_filtered(els["jpegenc"], caps)
               and els["jpegenc"].link(els["filesink"]))
    else:
        els["pngenc"].set_property("snapshot", True)
        noi = (els["pipewiresrc"].link(els["videoconvert"])
               and els["videoconvert"].link(els["pngenc"])
               and els["pngenc"].link(els["filesink"]))
    if not noi:
        loi("không nối được ống lấy hình")
    pipe.set_state(Gst.State.PLAYING)
    msg = pipe.get_bus().timed_pop_filtered(12 * Gst.SECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR)
    pipe.set_state(Gst.State.NULL)
    if msg is None:
        loi("không lấy được khung hình trong 12 giây (màn hình đang tắt?)")
    if msg.type == Gst.MessageType.ERROR:
        e, _ = msg.parse_error()
        loi(f"lấy hình hỏng: {e.message}")
    if not os.path.exists(out) or os.path.getsize(out) == 0:
        loi("không ghi được tệp ảnh")
    if not im_lang:
        print(out)
    return out


