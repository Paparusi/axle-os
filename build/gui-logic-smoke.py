#!/usr/bin/env python3
"""Thử phần THUẦN của cửa sổ Axle (không cần GTK, không cần màn hình): nạp axle-gui.py với gi giả rồi gọi các hàm
đọc dữ liệu — vì lỗi ở đây (ban.json hỏng, tin xin duyệt lạ, audit thiếu trường) là lỗi Bàn hiện sai giữa mặt tiền.
    python3 build/gui-logic-smoke.py
"""
import datetime, json, os, runpy, sys, types
from unittest import mock

# gi giả: đủ để `import gi; gi.require_version; from gi.repository import …` đi qua, còn lớp GTK thì là MagicMock
gi = types.ModuleType("gi"); gi.require_version = lambda *a: None
rep = types.ModuleType("gi.repository")
for n in ("Adw", "Gdk", "Gio", "GLib", "Gtk", "Pango"):
    m = mock.MagicMock(name=n)
    setattr(rep, n, m)
# Lớp cơ sở phải là class thật để `class Trang(Adw.PreferencesPage)` định nghĩa được
rep.Adw.PreferencesPage = type("PreferencesPage", (), {"__init__": lambda self, **k: None})
rep.Adw.ApplicationWindow = type("ApplicationWindow", (), {"__init__": lambda self, **k: None})
rep.Adw.Application = type("Application", (), {"__init__": lambda self, **k: None})
gi.repository = rep
sys.modules["gi"] = gi; sys.modules["gi.repository"] = rep
g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core/desktop/axle-gui.py"), run_name="axle_gui")

fail = 0
def ok(c, m):
    global fail
    print(f"  {'✓' if c else '✗'} {m}")
    if not c: fail += 1

doc_ban, tom_tat_viec, doc_audit, goi_y_loi, tuoi, loi_chao, mo_ta_so = (g[k] for k in ("doc_ban", "tom_tat_viec", "doc_audit", "goi_y_loi", "tuoi", "loi_chao", "mo_ta_so"))
md_lite = g["md_lite"]

ok(doc_ban("") is None and doc_ban("{oops") is None and doc_ban("[]") is None, "ban.json rỗng / hỏng / sai kiểu → None (Bàn nói 'chưa đọc được', không giả vờ trống)")
p, hn, ag, so = doc_ban(json.dumps({"pending": [], "homNay": {"chu_duyet": 1}, "agents": []}))
ok(p == [] and hn == {"chu_duyet": 1} and ag == [] and so == [], "ban.json trống hợp lệ → không việc, có số hôm nay, sổ rỗng")
raw = {"pending": [
    {"id": "a1b2c3d4", "tier": 2, "client": "ssh:claude", "buttons": "ahlr", "ageSec": 42,
     "text": "🔐 m · cần duyệt #a1b2c3d4\nAgent: ssh:claude\nViệc: Claude dùng Bash: `npm test` <b>x</b>\nBậc 2\nHết hạn sau 10 phút"},
    {"id": "ZZZ", "text": "giả"},                                   # id lạ → bỏ
    {"id": "e5f60718", "tier": "3", "client": "http:cog (user ag-cog)", "buttons": "axr", "text": ""},   # nút lạ 'x' bị lọc
], "agents": [{"ten": "cog", "vai": "phu"}, {"vai": "phu"}, "rác"]}
p, hn, ag, so = doc_ban(json.dumps(raw, ensure_ascii=False))
ok([r["id"] for r in p] == ["a1b2c3d4", "e5f60718"], "bỏ việc có id lạ, giữ đúng thứ tự")
ok(p[1]["tier"] == 3 and p[1]["buttons"] == "ar", "bậc dạng chuỗi → số; chữ nút lạ bị lọc, còn a/r")
ok(ag == [{"ten": "cog", "vai": "phu"}], "agent thiếu tên / không phải dict → bỏ")
viec, ai = tom_tat_viec(p[0])
ok(viec == "Claude dùng Bash: `npm test` <b>x</b>" and ai == "ssh:claude", "tóm tắt tin xin duyệt: lấy dòng Việc + Agent, giữ nguyên < > (use_markup=False)")
viec2, ai2 = tom_tat_viec(p[1])
ok(viec2 == "(không có mô tả)" and ai2 == "http:cog (user ag-cog)", "tin trống → '(không có mô tả)', ai = client")
ok(tuoi(5) == "5 giây trước" and tuoi(125) == "2 phút trước" and tuoi(7200) == "2 giờ trước", "tuổi việc chờ")
ok(loi_chao(9, "Bi") == "Chào buổi sáng, Bi" and loi_chao(20, "Bi") == "Chào buổi tối, Bi", "lời chào theo giờ")

now = datetime.datetime.now().astimezone(); hom = now.date().isoformat()
lines = [json.dumps({"ts": now.isoformat(), "client": "ssh:claude", "tool": "file_read"}),
         json.dumps({"ts": now.isoformat(), "client": "ssh:claude", "tool": "http_auth"}),      # bỏ như tin tóm tắt
         json.dumps({"ts": (now - datetime.timedelta(days=1)).isoformat(), "client": "ssh:claude", "tool": "web_click"}),
         json.dumps({"ts": "rác", "tool": "x"}), "không phải json", json.dumps({"tool": "thieu-ts"}),
         json.dumps({"ts": now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"), "client": "cog", "tool": "web_snapshot"})]   # cùng thời điểm, viết dạng UTC 'Z'
n, gan = doc_audit(lines, hom)
ok(n == 2, f"đếm hôm nay = {n} (bỏ http_auth, bỏ hôm qua, bỏ dòng hỏng; dòng 'Z' là cùng thời điểm)")
ok(len(gan) == 3 and gan[0].endswith("ssh:claude · file_read") and gan[-1].endswith("cog · web_snapshot"), "vài dòng gần nhất: giờ · ai · công cụ")
ok(doc_audit([], hom) == (0, []), "audit rỗng → 0, []")

s1 = mo_ta_so({"id": "1", "luc": now.isoformat(), "agent": "ssh:claude", "viec": "Claude Bash `npm test`", "tu_duyet": False, "quyet_dinh": "h", "via": "qua app iPhone", "ket_qua": "done", "exitCode": 0})
ok(s1[0] == "✅" and s1[1] == "Claude Bash `npm test`" and "1 giờ · qua app iPhone · xong" in s1[2], f"sổ: chủ cho 1 giờ qua app, chạy xong → {s1}")
s2 = mo_ta_so({"id": "2", "luc": now.isoformat(), "agent": "cog", "viec": "lệnh `sudo x` (root)", "tu_duyet": False, "quyet_dinh": "r", "via": "tại máy", "ket_qua": "rejected"})
ok(s2[0] == "❌" and "từ chối · tại máy" in s2[2] and "xong" not in s2[2], "sổ: từ chối tại máy")
s3 = mo_ta_so({"id": "3", "luc": now.isoformat(), "agent": "ssh:claude", "viec": "Claude Edit a.js", "tu_duyet": "phiên 1 giờ #3", "ket_qua": "done", "exitCode": 0})
ok(s3[0] == "⚙" and "tự duyệt (phiên 1 giờ #3)" in s3[2], "sổ: tự duyệt theo phiên")
s4 = mo_ta_so({"id": "4", "luc": "rác", "agent": "x", "action": "run_command", "ket_qua": "expired"})
ok(s4 == ("⌛", "run_command", "? · x · hết hạn, không chạy"), f"sổ: hết hạn, thiếu mô tả và giờ hỏng → vẫn ra dòng đọc được ({s4})")
ok(mo_ta_so({"id": "5", "luc": now.isoformat(), "agent": "a", "viec": "v", "ket_qua": "failed", "exitCode": 2, "quyet_dinh": "a"})[2].endswith("lần này · lỗi (mã 2)"), "sổ: cho phép lần này, chạy lỗi mã 2")

ok(md_lite("**Tóm tắt:** máy `axle-office` ổn\n") == [("Tóm tắt:", {"dam"}), (" máy ", set()), ("axle-office", {"ma"}), (" ổn", set())], "md_lite: đậm + mã giữa câu")
ok(md_lite("## Hoạt động") == [("Hoạt động", {"dam"})], "md_lite: tiêu đề → đậm")
ok(md_lite("- disk 8%") == [("• disk 8%", set())] and md_lite("  * con") == [("  • con", set())], "md_lite: đầu dòng → •")
ok(md_lite("→ system_status") == [("→ system_status", {"mo"})] and md_lite("— xong (14,6 giây)")[0][1] == {"mo"}, "md_lite: dòng công cụ / xong → mờ")
ok(md_lite("› tóm tắt hôm nay") == [("› tóm tắt hôm nay", {"dam"})], "md_lite: câu hỏi → đậm")
ok(md_lite("**dở dang") == [("dở dang", {"dam"})] and md_lite("") == [], "md_lite: đậm không đóng vẫn ra chữ; dòng trống → rỗng")

ok("đăng nhập Claude" in goi_y_loi("Error: Not logged in. Please run /login"), "lỗi chưa đăng nhập → chỉ cách đăng nhập")
ok("chưa có Claude Code" in goi_y_loi("Chưa cài Claude Code trên máy này (npm …)"), "chưa cài → nói chưa cài")
ok(goi_y_loi("lỗi lạ") == "", "lỗi khác → không đoán bừa")

if fail: print(f"✗ {fail} mục hỏng"); sys.exit(1)
print("✓ phần thuần của cửa sổ Axle đạt")
