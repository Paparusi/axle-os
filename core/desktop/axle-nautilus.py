"""Axle trong Files (Nautilus): chuột phải vào tệp → "Đưa vào Bộ não Axle" · "Hỏi Axle về tệp này…".
Cài vào /usr/share/nautilus-python/extensions/axle.py (gói python3-nautilus); Files nạp lúc khởi động — cài xong phải
đóng hết cửa sổ Files rồi mở lại (hay `nautilus -q`).

  Đưa vào Bộ não  → `axle brain them --nap --bao <tệp…>` chạy nền: tệp vào ~/Axle/Brain/raw/ (cùng khuôn với tệp điện
                    thoại gửi), Claude đọc, ghi trang wiki, rút mốc có ngày; xong GNOME hiện thông báo.
  Hỏi Axle        → `axle-gui <tệp…>`: Bàn mở ra, tệp nằm sẵn trong ô "Bảo Axle làm", gõ câu hỏi rồi Làm.
Chỉ hiện khi MỌI mục chọn là tệp thường trên đĩa (không thư mục, không tệp trong thùng rác / mạng).
"""
import os
import subprocess

import gi

for _v in ("4.1", "4.0"):          # Nautilus 43+ (API 4.0); bản mới hơn có thể là 4.1
    try:
        gi.require_version("Nautilus", _v)
        break
    except ValueError:
        continue
from gi.repository import GObject, Nautilus  # noqa: E402

AXLE = os.environ.get("AXLE_BIN", "/usr/local/bin/axle")
AXLE_GUI = os.environ.get("AXLE_GUI_BIN", "/usr/local/bin/axle-gui")
TOI_DA = 20


def duong_tep(files):
    """Đường dẫn của các mục chọn nếu TẤT CẢ là tệp thường cục bộ; không thì [] (menu không hiện)."""
    ds = []
    for f in files:
        if f.get_uri_scheme() != "file" or f.is_directory():
            return []
        loc = f.get_location()
        p = loc.get_path() if loc else None
        if not p or not os.path.isfile(p):
            return []
        ds.append(p)
    return ds[:TOI_DA]


def chay_nen(args):
    """Chạy tách khỏi Files (phiên riêng): đóng Files thì việc vẫn chạy tiếp."""
    try:
        subprocess.Popen(args, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, close_fds=True)
    except OSError:
        pass


class AxleMenu(GObject.GObject, Nautilus.MenuProvider):
    def get_file_items(self, *args):
        files = args[-1]                # Nautilus 43+: (files); bản cũ: (window, files)
        ds = duong_tep(files)
        if not ds:
            return []
        mot = len(ds) == 1
        nap = Nautilus.MenuItem(name="AxleMenu::Nap", label="Đưa vào Bộ não Axle",
                                tip="Axle đọc, tóm tắt thành trang wiki, rút hạn trả tiền / hết hạn… rồi báo khi xong")
        nap.connect("activate", lambda *_: chay_nen([AXLE, "brain", "them", "--nap", "--bao", "--", *ds]))
        hoi = Nautilus.MenuItem(name="AxleMenu::Hoi", label="Hỏi Axle về tệp này…" if mot else f"Hỏi Axle về {len(ds)} tệp này…",
                                tip="Mở Bàn Axle với tệp đính kèm sẵn — gõ câu hỏi rồi bấm Làm")
        hoi.connect("activate", lambda *_: chay_nen([AXLE_GUI, *ds]))
        return [nap, hoi]
