#!/usr/bin/env python3
"""Thử phần mở rộng Axle cho Files (core/desktop/axle-nautilus.py) KHÔNG cần Nautilus: gi giả + FileInfo giả.
Kiểm menu chỉ hiện khi mọi mục là tệp thường cục bộ, đúng hai mục, bấm thì chạy đúng lệnh (tách phiên).
    python3 build/nautilus-smoke.py
"""
import os, runpy, sys, tempfile, types
from unittest import mock

gi = types.ModuleType("gi")
phien_ban = []
def require_version(ns, v):
    phien_ban.append((ns, v))
    if ns == "Nautilus" and v == "4.1":
        raise ValueError("Namespace Nautilus not available for version 4.1")   # giả máy chỉ có 4.0 → phải lùi được
gi.require_version = require_version
rep = types.ModuleType("gi.repository")


class MenuItem:
    def __init__(self, **k):
        self.k, self.cb = k, None
    def connect(self, sig, cb):
        assert sig == "activate"
        self.cb = cb
rep.Nautilus = types.SimpleNamespace(MenuProvider=type("MenuProvider", (), {}), MenuItem=MenuItem)
rep.GObject = types.SimpleNamespace(GObject=type("GObject", (), {}))
gi.repository = rep
sys.modules["gi"] = gi; sys.modules["gi.repository"] = rep
g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core/desktop/axle-nautilus.py"), run_name="axle_nautilus")

fail = 0
def ok(c, m):
    global fail
    print(f"  {'✓' if c else '✗'} {m}")
    if not c: fail += 1


class Tep:
    def __init__(self, p, scheme="file"):
        self.p, self.scheme = p, scheme
    def get_uri_scheme(self): return self.scheme
    def is_directory(self): return os.path.isdir(self.p)
    def get_location(self): return types.SimpleNamespace(get_path=lambda: self.p)

T = tempfile.mkdtemp()
a, b = os.path.join(T, "Hợp đồng thuê kho.pdf"), os.path.join(T, "bảng lương.xlsx")
for f in (a, b):
    open(f, "w").write("x")
m = g["AxleMenu"]()
ok(("Nautilus", "4.0") in phien_ban, "Nautilus chỉ có API 4.0 → lùi từ 4.1 xuống 4.0 được")
items = m.get_file_items([Tep(a)])
ok([i.k["label"] for i in items] == ["Đưa vào Bộ não Axle", "Hỏi Axle về tệp này…"], f"một tệp: hai mục ({[i.k['label'] for i in items]})")
ok(m.get_file_items([Tep(a), Tep(b)])[1].k["label"] == "Hỏi Axle về 2 tệp này…", "nhiều tệp: nói số tệp")
ok(m.get_file_items(None, [Tep(a)]) != [], "bản Nautilus cũ gọi (window, files) vẫn chạy")
ok(m.get_file_items([Tep(T)]) == [] and m.get_file_items([Tep(a), Tep(T)]) == [], "có thư mục trong mục chọn → không hiện")
ok(m.get_file_items([Tep(a, scheme="trash")]) == [] and m.get_file_items([Tep(os.path.join(T, "khong-co.pdf"))]) == [], "thùng rác / tệp không có → không hiện")
chay = []
with mock.patch.object(g["subprocess"], "Popen", lambda args, **k: chay.append((args, k))):
    items = m.get_file_items([Tep(a), Tep(b)])
    items[0].cb(items[0]); items[1].cb(items[1])
ok(chay[0][0] == ["/usr/local/bin/axle", "brain", "them", "--nap", "--bao", "--", a, b], f"Đưa vào Bộ não → axle brain them --nap --bao -- <tệp> ({chay[0][0][:5]})")
ok(chay[1][0] == ["/usr/local/bin/axle-gui", a, b], "Hỏi Axle → axle-gui <tệp> (Bàn nhận tệp đính kèm)")
ok(all(k.get("start_new_session") and k.get("stdin") == g["subprocess"].DEVNULL for _, k in chay), "chạy tách phiên, không dính stdin của Files")
ok(len(g["duong_tep"]([Tep(a)] * 30)) == 20, "tối đa 20 tệp một lần")
if fail:
    print(f"✗ {fail} mục hỏng"); sys.exit(1)
print("✓ Axle trong Files đạt")
