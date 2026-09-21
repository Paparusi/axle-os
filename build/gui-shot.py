#!/usr/bin/env python3
"""Tự chụp cửa sổ Axle (Bàn) thành PNG để NHÌN thấy bố cục — không cần Xvfb hay máy ảo, chỉ cần một màn hình
(WSLg, GNOME…): mở cửa sổ với dữ liệu giả, chờ vẽ xong, vẽ lại cây widget ra texture, lưu PNG, tự đóng.
    python3 build/gui-shot.py out/ban.png [--ban] [--trang ban|may|dt|tn|ag|ql]
Dữ liệu giả: ban.json có 2 việc chờ + 2 agent, audit.jsonl có vài lần gọi công cụ, `axle` là script trả lời sẵn —
để bắt lỗi kiểu 20/9 (phụ đề có < > vỡ Pango, ô QR chừa chỗ trống, thẻ ngang cắt chữ) trước khi phát hành.
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "out/ban.png"
ban = "--ban" in sys.argv
trang = sys.argv[sys.argv.index("--trang") + 1] if "--trang" in sys.argv else "ban"

T = tempfile.mkdtemp(prefix="axle-gui-shot-")
now = datetime.datetime.now().astimezone()
gio = lambda d: (now - datetime.timedelta(seconds=d)).isoformat()   # noqa: E731
with open(os.path.join(T, "ban.json"), "w", encoding="utf-8") as f:
    json.dump({"ts": now.isoformat(), "host": "axle-thu", "pending": [
        {"id": "a1b2c3d4", "tier": 2, "client": "ssh:claude", "action": "claude_tool", "buttons": "ahlr", "ageSec": 42,
         "text": "🔐 axle-thu · cần duyệt #a1b2c3d4\nAgent: ssh:claude\nViệc: Claude dùng Bash: `npm test` trong ~/work/web <b>không phải thẻ</b>\nBậc 2 · có thể cho 1 giờ hoặc luôn việc này\nHết hạn sau 10 phút"},
        {"id": "e5f60718", "tier": 3, "client": "http:cog (user ag-cog)", "action": "run_command", "buttons": "ar", "ageSec": 400,
         "text": "🔐 axle-thu · cần duyệt #e5f60718\nAgent: http:cog (user ag-cog)\nViệc: chạy `sudo systemctl restart nginx` ⚠️ BẰNG QUYỀN ROOT\n⚠️ Bậc 3 · việc hệ trọng, luôn phải hỏi\nHết hạn sau 10 phút"}],
        "homNay": {"chu_duyet": 7, "tu_duyet": 12, "tu_choi": 1, "het_han": 0},
        "agents": [{"ten": "claude", "vai": "chinh", "user": None, "tam_dung": False},
                   {"ten": "cog", "vai": "phu", "user": "ag-cog", "tam_dung": True}]}, f, ensure_ascii=False)
with open(os.path.join(T, "audit.jsonl"), "w", encoding="utf-8") as f:
    for i, tool in enumerate(["file_read", "web_snapshot", "web_click", "file_search", "system_status", "http_auth"]):
        f.write(json.dumps({"ts": gio(3600 - i * 300), "client": "ssh:claude", "tool": tool}) + "\n")
axle = os.path.join(T, "axle")
with open(axle, "w", encoding="utf-8") as f:
    f.write("""#!/usr/bin/env bash
case "$1 $2" in
  "agents --json") echo '[{"ten":"claude","vai":"chinh","user":null,"cong_cu":[],"tam_dung":false,"dang_chay":false},{"ten":"cog","vai":"phu","user":"ag-cog","cong_cu":["file_read","web_snapshot","web_click","web_type","http_fetch"],"tam_dung":true,"dang_chay":false}]' ;;
  "snapshots --csv") printf '%s\\n' 'number,date,description' '12,2026-09-21 09:10:11,"axle provision 0.1.117"' '13,2026-09-21 10:00:00,"trước khi cài Axle Desktop"' ;;
  "dangnhap status") echo "Duyệt đăng nhập bằng điện thoại: ĐANG BẬT" ;;
  "app terminal") echo "Gõ lệnh từ app: BẬT (admin_1, 180 giây)" ;;
  "claude "*) sleep 1; echo "Log tối qua có 2 lỗi kết nối Supabase lúc 02:13 và 02:41, worker tự nối lại sau 30 giây. Không cần sửa gì." ;;
  *) echo "thu: $*" ;;
esac
""")
os.chmod(axle, stat.S_IRWXU)

env = dict(os.environ, AXLE_BIN=axle, AXLE_BAN_FILE=os.path.join(T, "ban.json"), AXLE_AUDIT_FILE=os.path.join(T, "audit.jsonl"),
           AXLE_GUI_SHOT=os.path.abspath(out), AXLE_GUI_TRANG=trang, LC_ALL="C.UTF-8")
# Chạy GUI thật trong tiến trình con có "móc chụp": sau 2,5 giây vẽ cửa sổ ra PNG rồi thoát.
code = f"""
import sys, runpy
sys.argv = ['axle-gui'] + {['--ban'] if ban else []!r}
import gi
gi.require_version('Gtk', '4.0'); gi.require_version('Adw', '1'); gi.require_version('Graphene', '1.0')
from gi.repository import Gtk, Adw, GLib, Graphene
import os
g = runpy.run_path({os.path.join(ROOT, 'core/desktop/axle-gui.py')!r}, run_name='axle_gui')
App, CuaSo = g['App'], g['CuaSo']
def chup(app):
    w = app.props.active_window
    if os.environ.get('AXLE_GUI_TRANG', 'ban') != 'ban':
        w.tabs.set_visible_child_name(os.environ['AXLE_GUI_TRANG'])
        GLib.timeout_add(700, lambda: (luu(app, w), False)[1])
        return False
    luu(app, w)
    return False
def luu(app, w):
    W, H = w.get_width(), w.get_height()
    p = Gtk.WidgetPaintable.new(w)
    s = Gtk.Snapshot.new()
    p.snapshot(s, W, H)
    node = s.to_node()
    tex = w.get_native().get_renderer().render_texture(node, Graphene.Rect().init(0, 0, W, H))
    os.makedirs(os.path.dirname(os.environ['AXLE_GUI_SHOT']) or '.', exist_ok=True)
    tex.save_to_png(os.environ['AXLE_GUI_SHOT'])
    print('đã chụp', os.environ['AXLE_GUI_SHOT'], W, 'x', H)
    app.quit()
a = App(ban={ban!r})
a.connect('activate', lambda app: GLib.timeout_add(2500, chup, app))
a.run(None)
"""
py = os.environ.get("AXLE_GUI_PYTHON", sys.executable)
r = subprocess.run([py, "-c", code], env=env, timeout=60)
sys.exit(r.returncode)
