#!/usr/bin/env python3
"""Tự chụp cửa sổ Axle (Bàn) thành PNG để NHÌN thấy bố cục — không cần Xvfb hay máy ảo, chỉ cần một màn hình
(WSLg, GNOME…): mở cửa sổ với dữ liệu giả, chờ vẽ xong, vẽ lại cây widget ra texture, lưu PNG, tự đóng.
    python3 build/gui-shot.py out/ban.png [--ban] [--trang ban|may|dt|tn|ag|ql|nao]
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
                   {"ten": "cog", "vai": "phu", "user": "ag-cog", "tam_dung": True}],
        "so": [{"id": "11aa22bb", "luc": gio(600), "agent": "ssh:claude", "action": "claude_tool", "viec": "Claude Bash `npm test`", "tu_duyet": False, "quyet_dinh": "h", "via": "qua app iPhone của Bi", "ket_qua": "done", "exitCode": 0},
               {"id": "33cc44dd", "luc": gio(2400), "agent": "http:cog (user ag-cog)", "action": "run_command", "viec": "lệnh `sudo systemctl restart nginx` (root)", "tu_duyet": False, "quyet_dinh": "r", "via": "tại máy", "ket_qua": "rejected", "exitCode": None},
               {"id": "55ee66ff", "luc": gio(5000), "agent": "ssh:claude", "action": "claude_tool", "viec": "Claude Edit ~/work/web/app.js", "tu_duyet": "phiên 1 giờ #3 (tới 15:02)", "quyet_dinh": None, "via": None, "ket_qua": "done", "exitCode": 0},
               {"id": "7788aabb", "luc": gio(9000), "agent": "ssh:claude", "action": "run_command", "viec": "lệnh `rm -rf node_modules`", "tu_duyet": False, "quyet_dinh": None, "via": None, "ket_qua": "expired", "exitCode": None}]}, f, ensure_ascii=False)
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
  "net kiem") cat "$(dirname "$0")/mang.json" ;;
  "claude "*) sleep 1; echo "Log tối qua có 2 lỗi kết nối Supabase lúc 02:13 và 02:41, worker tự nối lại sau 30 giây. Không cần sửa gì." ;;
  *) echo "thu: $*" ;;
esac
""")
os.chmod(axle, stat.S_IRWXU)
# Khám mạng giả cho trang Máy: mặc định ca 24/9 (dây vào cổng WAN cục mesh) để thấy biểu ngữ + bước + lệnh sửa;
# AXLE_SHOT_MANG=ok thì máy khoẻ. Kết luận lấy từ đúng hàm ket_luan của core/lib/kiem-mang.py.
import importlib.util
_spec = importlib.util.spec_from_file_location("kiem_mang", os.path.join(ROOT, "core/lib/kiem-mang.py"))
_km = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_km)
_sk = {"card": [{"ten": "enp34s0", "wifi": False, "tin_hieu": True, "trang_thai": "up"}], "mac": {"enp34s0": "02:00:00:00:00:0b"},
       "ipv4": {"enp34s0": ["192.168.1.216/24"]}, "ipv6": {}, "gw": "192.168.1.1", "gw_dev": "enp34s0", "gw_ping": True,
       "gw_lang_gieng": "REACHABLE", "internet": True, "dns": True, "quan_ly": "nm",
       "ket_noi": {"enp34s0": {"trang_thai": "connected", "ten": "netplan-enp34s0"}}, "xin_ipv4": {"enp34s0": "dhcp"},
       "ts": {"trang_thai": "Running", "online": True, "ip": "100.1.2.3"}, "tram": {"url": "https://tram.example.com", "ok": True}}
if os.environ.get("AXLE_SHOT_MANG", "loi") != "ok":
    _sk.update(ipv4={}, gw=None, gw_dev=None, internet=False, dns=False, ts={"trang_thai": "Running", "online": False, "ip": None},
               tram={"url": "https://tram.example.com", "ok": False},
               ket_noi={"enp34s0": {"trang_thai": "connecting (getting IP configuration)", "ten": "netplan-enp34s0"}})
with open(os.path.join(T, "mang.json"), "w", encoding="utf-8") as f:
    json.dump(_km.ket_luan(_sk), f, ensure_ascii=False)

# Bộ não giả cho trang Tri thức: 8 trang nối nhau, một link tới trang chưa có, một trang mồ côi — đủ để nhìn đồ thị
import shutil
B = os.path.join(T, "Brain")
subprocess.run(["bash", os.path.join(ROOT, "core/desktop/brain-init.sh"), B], check=True, capture_output=True)
TRANG = {
    "sources/hop-dong-omron-hrvn-2026-09.md": ("Hợp đồng dịch vụ Omron – HRVN", "source", "Phí giới thiệu 1 tháng lương, bảo hành 60 ngày. Bên A [[omron-healthcare]], bên B [[tmdv-hrvn]]. Thuộc [[hiro]]."),
    "entities/omron-healthcare.md": ("Omron Healthcare Manufacturing Vietnam", "entity", "Nhà máy VSIP II Bình Dương, 1.200 công nhân. Ký [[hop-dong-omron-hrvn-2026-09]]. Đầu mối [[nguoi-lien-he-lan]]."),
    "entities/tmdv-hrvn.md": ("TMDV HRVN", "entity", "Công ty cung ứng lao động của Bi. Hợp đồng [[hop-dong-omron-hrvn-2026-09]], dự án [[hiro]]."),
    "projects/hiro.md": ("HIRO", "project", "Nền tảng cung ứng lao động: đối chiếu công, hoa hồng. Khách [[omron-healthcare]], [[tmdv-hrvn]]. Quyết định giá [[gia-dich-vu-2026]]."),
    "decisions/gia-dich-vu-2026.md": ("Giá dịch vụ 2026", "decision", "Chốt phí 1 tháng lương, không thu phí công nhân. Áp cho [[hiro]]. Rút từ [[bai-hoc-bao-hanh]]."),
    "learnings/bai-hoc-bao-hanh.md": ("Bài học bảo hành 60 ngày", "learning", "Công nhân nghỉ trong 60 ngày phải bù người. Ghi trong [[hop-dong-omron-hrvn-2026-09]]."),
    "concepts/quy-trinh-ingest.md": ("Quy trình ingest", "concept", "Tệp vào raw → tóm tắt → trang sources → nối entity → index → log. Không ai trỏ tới trang này."),
    "concepts/phi-gioi-thieu.md": ("Phí giới thiệu", "concept", "Một tháng lương cơ bản của người được nhận. Xem [[gia-dich-vu-2026]], [[hiro]]."),
}
for p, (ten, loai, than) in TRANG.items():
    with open(os.path.join(B, "wiki", p), "w", encoding="utf-8") as f:
        f.write(f"---\ntitle: {ten}\ntype: {loai}\n---\n{than}\n")
with open(os.path.join(B, "wiki/index.md"), "a", encoding="utf-8") as f:
    f.write("\n## Tài liệu (sources)\n- [[hop-dong-omron-hrvn-2026-09]] — hợp đồng dịch vụ 9/2026\n")

env = dict(os.environ, AXLE_BIN=axle, AXLE_BAN_FILE=os.path.join(T, "ban.json"), AXLE_AUDIT_FILE=os.path.join(T, "audit.jsonl"),
           AXLE_GUI_SHOT=os.path.abspath(out), AXLE_GUI_TRANG=trang, LC_ALL="C.UTF-8",
           AXLE_BRAIN_DIR=B, AXLE_BRAIN_JS=os.path.join(ROOT, "mcp/brain.js"), AXLE_NODE=shutil.which("node") or "/usr/bin/node")
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
