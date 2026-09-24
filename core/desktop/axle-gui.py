#!/usr/bin/env python3
"""Cửa sổ "Axle" trên desktop — và từ 21/9/2026 là MẶT TIỀN của máy (Bàn Axle): đăng nhập xong là vào Bàn,
không rơi vào một màn hình nền trống. Ubuntu-desktop vẫn ở ngay dưới ("Chế độ tay"), Super+B gọi Bàn về.

Vì sao có file này: tới 20/9/2026 mọi sức mạnh của Axle đều nằm sau `sudo axle …` hoặc trong app điện thoại.
Người cài xong mà không có ai chỉ thì ngồi nhìn một bản Ubuntu đổi màu. Bàn trả lời ba câu ngay khi mở máy:
máy đang làm gì, có gì cần mình, và "bảo Axle làm" một việc bằng tiếng Việt.

Nguyên tắc:
  * Đọc trạng thái KHÔNG cần quyền root và KHÔNG dội sudo: bộ duyệt tự công bố /run/axle/ban.json (root:chủ 0640),
    Bàn chỉ đọc tệp — đổi là thấy ngay (theo dõi tệp), không có cửa hẹp nào mới để lạm dụng.
  * Chỉ lúc ĐỔI thứ gì mới gọi `pkexec axle …` → hộp thoại mật khẩu chuẩn của hệ thống. Duyệt tại máy đi qua
    đúng đường `axle duyet` (socket quản trị root 0600) — cùng mức tin cậy với sudo.
  * Mỗi công tắc kèm một câu nói rõ đánh đổi. Không có nút nào mà người dùng phải đoán nó làm gì.
"""
import datetime
import json
import math
import os
import pwd
import re
import subprocess
import sys
import tempfile
import threading
import uuid

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk, Pango, PangoCairo  # noqa: E402
try:   # vẽ đồ thị bằng cairo cần cầu nối python3-gi-cairo; thiếu thì Bàn vẫn chạy, chỉ thẻ liên kết báo cách cài
    gi.require_foreign("cairo")
    CO_CAIRO = True
except (ImportError, ValueError):
    CO_CAIRO = False

AXLE = os.environ.get("AXLE_BIN", "/usr/local/bin/axle")
BAN_FILE = os.environ.get("AXLE_BAN_FILE", "/run/axle/ban.json")
AUDIT = os.environ.get("AXLE_AUDIT_FILE", os.path.expanduser("~/.local/state/axle/audit.jsonl"))
BRAIN_DIR = os.environ.get("AXLE_BRAIN_DIR", os.path.expanduser("~/Axle/Brain"))
APP_JSON = os.environ.get("AXLE_APP_JSON", "/etc/axle/app.json")   # {"relay": …} — bản cài công khai chưa có, phải đặt tay
BRAIN_JS = os.environ.get("AXLE_BRAIN_JS", "/opt/axle/mcp/brain.js")   # đồ thị liên kết lấy CÙNG một nguồn với app (doThi)
NODE = os.environ.get("AXLE_NODE", "/usr/bin/node")
# Bảy màu phải tách bạch (24/9: thực thể xanh lá với khái niệm xanh ngọc gần như trùng, dự án cam với bài học vàng cũng thế)
MAU_LOAI = {"source": (0x60, 0xA5, 0xFA), "entity": (0x34, 0xD3, 0x99), "project": (0xFB, 0x92, 0x3C), "decision": (0xA7, 0x8B, 0xFA),
            "learning": (0xFA, 0xCC, 0x15), "concept": (0xF4, 0x72, 0xB6), "thieu": (0xF8, 0x71, 0x71)}
TEN_LOAI = {"source": "Nguồn", "entity": "Thực thể", "project": "Dự án", "decision": "Quyết định", "learning": "Bài học",
            "concept": "Khái niệm", "thieu": "Thiếu trang"}
KHUNG_DO_THI = (1000, 500)   # xếp một lần trong khung 2:1 (~ thẻ 680×340 trên Bàn), lúc vẽ co đều cho vừa widget


def do_thi_brain(brain_dir=None):
    """Đồ thị liên kết wiki {nodes, edges, bo_bot?} — chạy đúng hàm doThi của mcp/brain.js (một nguồn cho cả app lẫn Bàn);
    None khi máy chưa có Bộ não / node / brain.js."""
    d = brain_dir or BRAIN_DIR
    if not os.path.isdir(os.path.join(d, "wiki")) or not os.path.exists(BRAIN_JS):
        return None
    try:
        r = subprocess.run([NODE, "-e", "import(process.argv[1]).then((b) => process.stdout.write(JSON.stringify(b.doThi(process.argv[2]))))",
                            BRAIN_JS, d], capture_output=True, text=True, timeout=20)
        g = json.loads(r.stdout) if r.returncode == 0 and r.stdout else None
        return g if isinstance(g, dict) and isinstance(g.get("nodes"), list) else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def sap_toi_brain(brain_dir=None, so_ngay=60):
    """Mốc có ngày sắp tới (hạn trả tiền, hết hạn…) — chạy đúng sapToi của brain.js; None khi máy chưa có Bộ não / node."""
    d = brain_dir or BRAIN_DIR
    if not os.path.isdir(os.path.join(d, "wiki")) or not os.path.exists(BRAIN_JS):
        return None
    try:
        r = subprocess.run([NODE, "-e", "import(process.argv[1]).then((b) => process.stdout.write(JSON.stringify("
                            "b.sapToi(process.argv[2], { soNgay: Number(process.argv[3]) }))))", BRAIN_JS, d, str(so_ngay)],
                           capture_output=True, text=True, timeout=20)
        st = json.loads(r.stdout) if r.returncode == 0 and r.stdout else None
        return st if isinstance(st, list) else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def moc_can_bao(sap_toi, da_bao):
    """Mốc nào cần bật thông báo lúc này: vào khoảng nhắc (còn ≤ nhac_truoc ngày) thì báo MỘT lần, đúng ngày hạn báo thêm
    một lần. Trả [(khoá, tiêu đề, nội dung)] cho những khoá chưa có trong da_bao — Bàn mở lại cũng không báo lặp."""
    ra = []
    for x in sap_toi or []:
        if not x.get("nhac"):
            continue
        hom_nay = x.get("con") == 0
        khoa = f"{x.get('id')}|{x.get('ngay')}|{'hom_nay' if hom_nay else 'truoc'}"
        if khoa in (da_bao or {}):
            continue
        tieu_de = f"Hôm nay: {x.get('viec', '')}" if hom_nay else f"Còn {x.get('con')} ngày: {x.get('viec', '')}"
        ngay = str(x.get("ngay", ""))
        ra.append((khoa, tieu_de, f"{ngay[8:10]}/{ngay[5:7]}" + (f" · {x['ten_trang']}" if x.get("ten_trang") else "")))
    return ra


def xep_do_thi(nodes, edges, W, H, vong=200):
    """Xếp đồ thị bằng lực (Fruchterman–Reingold gọn, cùng cách với app): nút đẩy nhau k²/d, cạnh kéo d²/k, kéo nhẹ về tâm,
    nhiệt giảm dần; cuối cùng co cho vừa khung W×H. Trả {id: (x, y)}. Thuần Python, chạy ở luồng nền."""
    ids = [n["id"] for n in nodes]
    if not ids or W < 10 or H < 10:
        return {}
    if len(ids) == 1:
        return {ids[0]: (W / 2, H / 2)}
    pos = {}
    for i, a in enumerate(ids):
        t = i / len(ids) * 2 * math.pi
        pos[a] = [W / 2 + math.cos(t) * W * 0.35, H / 2 + math.sin(t) * H * 0.35]
    k = math.sqrt(W * H / len(ids)) * 0.6
    vong = 60 if len(ids) > 150 else vong
    ke = [(e["a"], e["b"]) for e in edges if e["a"] in pos and e["b"] in pos and e["a"] != e["b"]]
    for it in range(vong):
        disp = {a: [0.0, 0.0] for a in ids}
        for i, a in enumerate(ids):
            xa, ya = pos[a]
            da = disp[a]
            for b in ids[i + 1:]:
                dx, dy = xa - pos[b][0], ya - pos[b][1]
                d = max(math.hypot(dx, dy), 1.0)
                f = k * k / d / d
                fx, fy = dx * f, dy * f
                da[0] += fx; da[1] += fy
                disp[b][0] -= fx; disp[b][1] -= fy
        for a, b in ke:
            dx, dy = pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]
            d = max(math.hypot(dx, dy), 1.0)
            f = d / k
            fx, fy = dx * f, dy * f
            disp[a][0] -= fx; disp[a][1] -= fy
            disp[b][0] += fx; disp[b][1] += fy
        temp = max(2.0, W / 10 * (1 - it / vong))
        for a in ids:
            dx, dy = disp[a]
            ln = max(math.hypot(dx, dy), 0.01)
            s = min(ln, temp)
            x = pos[a][0] + dx / ln * s
            y = pos[a][1] + dy / ln * s
            x += (W / 2 - x) * 0.05
            y += (H / 2 - y) * 0.05
            pos[a] = [min(W - 20.0, max(20.0, x)), min(H - 20.0, max(20.0, y))]   # giữ trong khung: nút rời không bay xa làm cụm bị ép nhỏ
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    pad = 28
    s = min((W - 2 * pad) / max(max(xs) - min(xs), 1.0), (H - 2 * pad - 12) / max(max(ys) - min(ys), 1.0))
    ox = (W - (max(xs) - min(xs)) * s) / 2
    oy = (H - 12 - (max(ys) - min(ys)) * s) / 2
    return {a: (ox + (p[0] - min(xs)) * s, oy + (p[1] - min(ys)) * s) for a, p in pos.items()}
THU = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"]
# Nút duyệt tại máy, theo chữ cái bộ duyệt gửi (a lần này · h 1 giờ · l luôn · r từ chối)
NUT = {"a": ("Lần này", ["suggested-action"]), "h": ("1 giờ", []), "l": ("Luôn", []), "r": ("Từ chối", ["destructive-action"])}
LOI_DAN = ("Việc đọc, tìm, xem thì Axle làm ngay. Ghi tệp, chạy lệnh, xoá sẽ hỏi bạn trước — "
           "trên điện thoại, hoặc ngay ở “Cần bạn” bên dưới.")
CSS = """
.ban-the { padding: 16px 18px; }
.ban-ket-qua { background: alpha(currentColor, 0.05); border-radius: 8px; }
"""


def chay(*args, root=False, timeout=30):
    """Chạy một lệnh, trả (mã thoát, đầu ra). root=True thì đi qua pkexec (hộp mật khẩu của hệ thống)."""
    cmd = ["pkexec", AXLE, *args] if root else [AXLE, *args]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 1, str(e)


def doc(f, mac=""):
    try:
        with open(f, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return mac


def doc_duoi(f, toi_da=262144):
    """Vài trăm KB cuối của một tệp nhật ký (audit.jsonl lớn dần theo tháng — không đọc cả tệp mỗi phút)."""
    try:
        with open(f, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            n = fh.tell()
            fh.seek(max(0, n - toi_da))
            chu = fh.read().decode("utf-8", "replace")
    except OSError:
        return []
    dong = chu.split("\n")
    return dong[1:] if len(dong) > 1 and n > toi_da else dong


def mot_dong(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


# ---------- phần thuần (không GTK) — thử được bằng build/gui-logic-smoke.py ----------
def doc_ban(chu):
    """Nội dung ban.json → (việc chờ, số hôm nay, agent). Tệp hỏng/thiếu → None: Bàn nói thật, không giả vờ trống."""
    try:
        j = json.loads(chu)
    except (ValueError, TypeError):
        return None
    if not isinstance(j, dict):
        return None
    pend = []
    for r in j.get("pending") or []:
        if not isinstance(r, dict) or not re.fullmatch(r"[0-9a-f]{8}", str(r.get("id", ""))):
            continue
        nut = "".join(c for c in str(r.get("buttons") or "") if c in NUT) or "ar"
        pend.append({"id": r["id"], "tier": int(r.get("tier") or 2), "client": str(r.get("client") or "?"),
                     "text": str(r.get("text") or ""), "buttons": nut, "ageSec": int(r.get("ageSec") or 0)})
    hn = j.get("homNay") if isinstance(j.get("homNay"), dict) else {}
    ag = [a for a in (j.get("agents") or []) if isinstance(a, dict) and a.get("ten")]
    so = [x for x in (j.get("so") or []) if isinstance(x, dict) and x.get("id")]
    return pend, hn, ag, so


def mo_ta_so(x):
    """Một dòng Sổ (từ ban.json) → (dấu, tiêu đề, phụ đề): ai xin, việc gì, chủ quyết ra sao, kết quả."""
    kq = x.get("ket_qua") or "pending"
    qd = x.get("quyet_dinh")
    if x.get("tu_duyet"):
        dau, loi = "⚙", "tự duyệt" + (f" ({x['tu_duyet']})" if isinstance(x.get("tu_duyet"), str) else "")
    elif kq == "rejected" or qd == "r":
        dau, loi = "❌", "từ chối"
    elif kq == "expired":
        dau, loi = "⌛", "hết hạn, không chạy"
    elif kq == "pending":
        dau, loi = "⏳", "đang chờ"
    else:
        dau, loi = "✅", {"a": "lần này", "h": "1 giờ", "l": "luôn việc này"}.get(qd, "cho phép")
    if x.get("via") and kq != "pending" and not x.get("tu_duyet"):
        loi += f" · {x['via']}"
    kq_chu = {"done": "xong", "failed": f"lỗi (mã {x.get('exitCode')})", "running": "đang chạy"}.get(kq, "")
    try:
        gio = datetime.datetime.fromisoformat(str(x.get("luc")).replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M")
    except ValueError:
        gio = "?"
    phu = " · ".join(p for p in (gio, str(x.get("agent") or "?"), loi, kq_chu) if p)
    return dau, str(x.get("viec") or x.get("action") or "?"), phu


def tom_tat_viec(r):
    """Tin xin duyệt (🔐 máy · cần duyệt #id / Agent: … / Việc: … / Bậc …) → (việc, ai)."""
    dong = [d.strip() for d in r["text"].splitlines() if d.strip()]
    viec = next((d[5:].strip() for d in dong if d.startswith("Việc:")), "")
    if not viec:
        viec = next((d for d in dong if not d.startswith("🔐")), "") or "(không có mô tả)"
    ai = next((d[6:].strip() for d in dong if d.startswith("Agent:")), r["client"])
    return viec[:200], ai


def tuoi(giay):
    if giay < 60:
        return f"{giay} giây trước"
    if giay < 3600:
        return f"{giay // 60} phút trước"
    return f"{giay // 3600} giờ trước"


def doc_audit(dong, hom_nay, toi_da=5):
    """audit.jsonl của trợ lý chính → (số lần gọi công cụ hôm nay, vài dòng gần nhất). Bỏ http_auth như tin tóm tắt."""
    n, gan = 0, []
    for l in dong:
        try:
            e = json.loads(l)
        except ValueError:
            continue
        tool, ts = e.get("tool"), e.get("ts")
        if not tool or tool == "http_auth" or not isinstance(ts, str):
            continue
        try:
            t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            continue
        if t.tzinfo is not None:
            t = t.astimezone()
        if t.strftime("%Y-%m-%d") == hom_nay:
            n += 1
        gan.append(f"{t.strftime('%H:%M')} · {e.get('client') or '?'} · {tool}")
    return n, gan[-toi_da:]


def md_lite(dong):
    """Một dòng Claude trả về → [(chữ, tập tag)] cho TextView: **đậm**, `mã`, # tiêu đề → đậm, - đầu dòng → •,
    "→ …"/"— xong" → mờ, "› câu hỏi" → đậm. Không phải Markdown đầy đủ — đủ để đọc được trên Bàn."""
    s = dong.rstrip("\n")
    if s.startswith("→ ") or s.startswith("— xong"):
        return [(s, {"mo"})]
    if s.startswith("› "):
        return [(s, {"dam"})]
    m = re.match(r"^#{1,6}\s+(.*)$", s)
    if m:
        return [(m.group(1), {"dam"})]
    m = re.match(r"^(\s*)[-*]\s+(.*)$", s)
    if m:
        s = f"{m.group(1)}• {m.group(2)}"
    ra, buf, dam, ma, i = [], "", False, False, 0
    tags = lambda: {t for t, on in (("dam", dam), ("ma", ma)) if on}   # noqa: E731
    while i < len(s):
        if s.startswith("**", i):
            if buf:
                ra.append((buf, tags()))
                buf = ""
            dam = not dam
            i += 2
            continue
        if s[i] == "`":
            if buf:
                ra.append((buf, tags()))
                buf = ""
            ma = not ma
            i += 1
            continue
        buf += s[i]
        i += 1
    if buf:
        ra.append((buf, tags()))
    return ra


def loi_chao(gio, ten):
    buoi = "Chào buổi sáng" if gio < 12 else ("Chào buổi chiều" if gio < 18 else "Chào buổi tối")
    return f"{buoi}, {ten}"


def goi_y_loi(chu):
    """Đầu ra hỏng của `axle claude` → một câu chỉ đường, không bắt người dùng đọc stack trace."""
    if "Chưa cài Claude Code" in chu:
        return "Máy này chưa có Claude Code (npm i -g @anthropic-ai/claude-code)."
    if re.search(r"(?i)not logged in|log ?in|đăng nhập|unauthori|authenticat|api key", chu):
        return "Cần đăng nhập Claude một lần: mở cửa sổ dòng lệnh, gõ  claude  rồi làm theo hướng dẫn."
    return ""


class Trang(Adw.PreferencesPage):
    def __init__(self, tieu_de, icon):
        super().__init__(title=tieu_de, icon_name=icon)


class DoThiBrain(Gtk.DrawingArea):
    """Đồ thị liên kết wiki trên Bàn: chấm = trang (màu theo loại, to theo số liên kết), nét = [[link]], chấm đỏ đứt nét =
    trang được nhắc mà chưa có. Bấm một chấm → chọn (phần không dính mờ đi) và báo cho trang Tri thức; bấm chỗ trống → bỏ chọn.
    Toạ độ xếp sẵn trong khung KHUNG_DO_THI (luồng nền), lúc vẽ co đều cho vừa widget nên đổi cỡ cửa sổ không phải xếp lại."""

    def __init__(self, khi_chon):
        super().__init__(content_height=340, hexpand=True)
        self.khi_chon = khi_chon
        self.do_thi = {"nodes": [], "edges": []}
        self.vi_tri = {}
        self.chon = None
        self.set_draw_func(self.ve)
        bam = Gtk.GestureClick()
        bam.connect("released", self.bam)
        self.add_controller(bam)

    def dat(self, do_thi, vi_tri):
        self.do_thi = do_thi or {"nodes": [], "edges": []}
        self.vi_tri = vi_tri or {}
        self.chon = None
        self.queue_draw()

    def nut(self, id_):
        return next((n for n in self.do_thi["nodes"] if n["id"] == id_), None)

    def ten(self, id_):
        n = self.nut(id_)
        return n["ten"] if n else id_

    def hang_xom(self, id_):
        return {e["b"] if e["a"] == id_ else e["a"] for e in self.do_thi.get("edges", []) if id_ in (e["a"], e["b"])}

    def diem(self, W, H):
        """Toạ độ widget của từng nút: co đều khung xếp cho vừa W×H rồi căn giữa."""
        kw, kh = KHUNG_DO_THI
        s = min((W - 16) / kw, (H - 16) / kh)
        ox, oy = (W - kw * s) / 2, (H - kh * s) / 2
        return {a: (ox + x * s, oy + y * s) for a, (x, y) in self.vi_tri.items()}

    def bam(self, _g, _n, x, y):
        P = self.diem(self.get_width(), self.get_height())
        gan = min(((math.hypot(px - x, py - y), a) for a, (px, py) in P.items()), default=(99, None))
        self.chon = gan[1] if gan[0] < 22 else None
        self.queue_draw()
        self.khi_chon(self.nut(self.chon) if self.chon else None)

    def ve(self, _w, cr, W, H):
        if not self.vi_tri:
            return
        P = self.diem(W, H)
        mc = self.get_color()
        ke = ({self.chon} | self.hang_xom(self.chon)) if self.chon else None
        for e in self.do_thi.get("edges", []):
            if e["a"] not in P or e["b"] not in P:
                continue
            noi = self.chon is None or self.chon in (e["a"], e["b"])
            cr.set_source_rgba(mc.red, mc.green, mc.blue, 0.45 if noi else 0.1)
            cr.set_line_width(1.4 if noi else 0.7)
            cr.move_to(*P[e["a"]])
            cr.line_to(*P[e["b"]])
            cr.stroke()
        layout = self.create_pango_layout("")
        fd = self.get_pango_context().get_font_description()
        if fd:
            fd = fd.copy()
            fd.set_size(9 * Pango.SCALE)
            layout.set_font_description(fd)
        layout.set_width(150 * Pango.SCALE)
        layout.set_ellipsize(Pango.EllipsizeMode.END)
        layout.set_alignment(Pango.Alignment.CENTER)
        nhieu = len(self.do_thi["nodes"]) > 30
        for n in self.do_thi["nodes"]:
            if n["id"] not in P:
                continue
            x, y = P[n["id"]]
            r = 5 + min(n.get("so_link", 0), 8)
            sang = ke is None or n["id"] in ke
            c = MAU_LOAI.get(n.get("loai"), (0x9A, 0xA4, 0xB5))
            cr.set_source_rgba(c[0] / 255, c[1] / 255, c[2] / 255, 1 if sang else 0.25)
            cr.new_path()   # sau show_layout cairo còn "điểm hiện tại" → arc sẽ kéo một vạch lạ từ nhãn trước tới chấm này
            cr.arc(x, y, r, 0, 2 * math.pi)
            if n.get("loai") == "thieu":
                cr.set_dash([3, 2])
                cr.set_line_width(1.5)
                cr.stroke()
                cr.set_dash([])
            else:
                cr.fill()
            if self.chon == n["id"]:
                cr.set_source_rgba(mc.red, mc.green, mc.blue, 1)
                cr.set_line_width(1.5)
                cr.new_path()
                cr.arc(x, y, r + 3, 0, 2 * math.pi)
                cr.stroke()
            if sang and (not nhieu or self.chon is not None or n.get("so_link", 0) >= 2):
                layout.set_text(n["ten"], -1)
                cr.set_source_rgba(mc.red, mc.green, mc.blue, 0.95)
                cr.move_to(x - 75, y + r + 3)
                PangoCairo.show_layout(cr, layout)


class CuaSo(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Bàn Axle", default_width=1000, default_height=740)
        self.toast = Adw.ToastOverlay()
        self.tabs = Adw.ViewStack()
        self.dang_lam = False        # đang chạy một việc "bảo Axle làm"
        self.hen_mang, self.dang_kiem_mang = 0, False   # khám mạng: hẹn giờ gom báo đổi mạng / đang khám
        self.co_cuoc = False         # đã có mạch hội thoại → lần sau nối tiếp (--tiep)
        self.phien = str(uuid.uuid4())   # id cuộc riêng của Bàn (app có id khác) — không lẫn mạch với nhau
        self.tien_trinh = None

        css = Gtk.CssProvider()
        try:
            css.load_from_string(CSS)
        except AttributeError:               # GTK < 4.12
            css.load_from_data(CSS.encode())
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        # Thanh bên chứ không phải thẻ ngang: tới mục thứ năm là thẻ ngang cắt cụt chữ ("Điện t…", "Quay …").
        # Đây cũng là cách Cài đặt của GNOME làm, và thêm mục sau này không vỡ bố cục. Bàn đứng đầu: nó là mặt tiền.
        muc = [("ban", "Bàn", "go-home-symbolic", self.trang_ban),
               ("so", "Sổ", "view-list-symbolic", self.trang_so),
               ("nao", "Tri thức", "accessories-dictionary-symbolic", self.trang_nao),
               ("may", "Máy", "computer-symbolic", self.trang_tong_quan),
               ("dt", "Điện thoại", "phone-symbolic", self.trang_dien_thoai),
               ("tn", "Tính năng", "preferences-system-symbolic", self.trang_tinh_nang),
               ("ag", "Agent", "network-workgroup-symbolic", self.trang_agent),
               ("ql", "Quay lại", "edit-undo-symbolic", self.trang_quay_lai)]
        self.ten_muc = Adw.WindowTitle(title="Bàn Axle")   # tiêu đề bên phải đổi theo mục đang mở
        ds = Gtk.ListBox(css_classes=["navigation-sidebar"])

        def chon(_b, r):
            if not r:
                return
            ma, ten = muc[r.get_index()][0], muc[r.get_index()][1]
            self.tabs.set_visible_child_name(ma)
            self.ten_muc.set_title("Bàn Axle" if ma == "ban" else ten)
        ds.connect("row-selected", chon)
        for ma, ten, icon, dung in muc:
            self.tabs.add_titled(dung(), ma, ten)
            hop = Gtk.Box(spacing=12, margin_top=8, margin_bottom=8, margin_start=6, margin_end=6)
            hop.append(Gtk.Image(icon_name=icon))
            hop.append(Gtk.Label(label=ten, xalign=0))
            ds.append(Gtk.ListBoxRow(child=hop))
        ds.select_row(ds.get_row_at_index(0))
        self.ds, self.muc_ma = ds, [m[0] for m in muc]

        ben = Adw.ToolbarView()
        ben.add_top_bar(Adw.HeaderBar(title_widget=Adw.WindowTitle(title="Axle")))
        ben.set_content(Gtk.ScrolledWindow(child=ds, hscrollbar_policy=Gtk.PolicyType.NEVER))
        noi_dung = Adw.ToolbarView()
        thanh = Adw.HeaderBar(title_widget=self.ten_muc)
        # "Chế độ tay": thu Bàn xuống, còn lại là màn hình nền GNOME để tự tay làm. Super+B gọi Bàn về.
        nut_tay = Gtk.Button(label="Chế độ tay", tooltip_text="Thu Bàn xuống, tự tay dùng máy. Super+B gọi Bàn về.")
        nut_tay.connect("clicked", lambda *_: self.minimize())
        thanh.pack_end(nut_tay)
        noi_dung.add_top_bar(thanh)
        # Biểu ngữ mất mạng ngay dưới thanh tiêu đề: khám mạng ra lỗi thì hiện, kèm nút sang trang Máy xem cách sửa
        self.bn_mang = Adw.Banner(title="", button_label="Xem cách sửa", revealed=False, use_markup=False)
        self.bn_mang.connect("button-clicked", lambda *_: self.mo_muc("may"))
        noi_dung.add_top_bar(self.bn_mang)
        noi_dung.set_content(self.tabs)

        chia = Adw.NavigationSplitView(
            sidebar=Adw.NavigationPage(child=ben, title="Axle"),
            content=Adw.NavigationPage(child=noi_dung, title="Axle"),
            min_sidebar_width=200, max_sidebar_width=240)
        self.toast.set_child(chia)
        self.set_content(self.toast)
        self.lam_moi()
        # Bộ theo dõi mạng của hệ thống (NetworkManager qua Gio) báo mỗi lần mạng đổi — cắm/rút dây, mất IP, mất Internet.
        # Không hỏi đi hỏi lại: có báo thì gom 8 giây rồi khám một lần. Mở Bàn là khám ngay một lần.
        try:
            mon = Gio.NetworkMonitor.get_default()
            mon.connect("network-changed", self.mang_doi)
            mon.connect("notify::connectivity", self.mang_doi)
        except (AttributeError, TypeError):
            pass
        GLib.idle_add(self.kiem_mang)
        # Nhắc mốc: 20 giây sau khi mở (đợi phiên làm việc ổn), rồi mỗi 30 phút. Bấm thông báo → mở trang Tri thức.
        mo = Gio.SimpleAction.new("mo-muc", GLib.VariantType.new("s"))
        mo.connect("activate", lambda _a, v: (self.present(), self.mo_muc(v.get_string())))
        app.add_action(mo)
        GLib.timeout_add_seconds(20, lambda: (self.kiem_moc(), GLib.timeout_add_seconds(1800, self.kiem_moc), False)[-1])
        self.theo_doi_ban()

    def bao(self, chu):
        self.toast.add_toast(Adw.Toast(title=chu, timeout=4))

    # ---------- Bàn ----------
    @staticmethod
    def the(tieu_de):
        """Một thẻ trên Bàn: tiêu đề + hộp nội dung xếp dọc (trả cả hai để đổ lại nội dung khi làm mới)."""
        hop = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, css_classes=["card", "ban-the"], hexpand=True)
        hop.append(Gtk.Label(label=tieu_de, xalign=0, css_classes=["heading"]))
        noi = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        hop.append(noi)
        return hop, noi

    @staticmethod
    def don(hop):
        while (c := hop.get_first_child()) is not None:
            hop.remove(c)

    @staticmethod
    def dong_mo(chu, phu=None):
        """Một dòng chữ mờ (trạng thái trống / lỗi) — thẻ không bao giờ để trống không nói gì."""
        hop = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        hop.append(Gtk.Label(label=chu, xalign=0, wrap=True, css_classes=["dim-label"]))
        if phu:
            hop.append(Gtk.Label(label=phu, xalign=0, wrap=True, css_classes=["dim-label", "caption"]))
        return hop

    def trang_ban(self):
        """Mặt tiền của máy. Ba câu: có gì cần tôi, máy đang làm gì, bảo Axle làm."""
        cuon = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        cot = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18,
                      margin_top=20, margin_bottom=24, margin_start=28, margin_end=28)
        # Màn 4K mở to: không kẹp thì chữ dàn hết 3.800px, lọt thỏm góc trái (thấy khi tự chụp 21/9).
        # Clamp giữ khối nội dung ≤1400px và căn giữa — cách Cài đặt của GNOME làm.
        cuon.set_child(Adw.Clamp(child=cot, maximum_size=1400, tightening_threshold=1100))

        self.chao = Gtk.Label(xalign=0, css_classes=["title-1"], label="Xin chào")
        self.chao_phu = Gtk.Label(xalign=0, css_classes=["dim-label"], label="")
        cot.append(self.chao)
        cot.append(self.chao_phu)

        # Bảo Axle làm — việc đầu tiên trên Bàn, vì đó là lý do có Axle
        the, noi = self.the("Bảo Axle làm")
        hang = Gtk.Box(spacing=8)
        self.o_lenh = Gtk.Entry(hexpand=True, placeholder_text="ví dụ: tóm tắt log tối qua · máy in không in được, xem giúp · dọn ổ đĩa")
        self.o_lenh.connect("activate", self.bao_lam)
        self.nut_lam = Gtk.Button(label="Làm", css_classes=["suggested-action"])
        self.nut_lam.connect("clicked", self.bao_lam)
        self.nut_dung = Gtk.Button(label="Dừng", visible=False)
        self.nut_dung.connect("clicked", self.dung_lam)
        hang.append(self.o_lenh)
        hang.append(self.nut_lam)
        hang.append(self.nut_dung)
        noi.append(hang)
        self.lenh_trang_thai = Gtk.Label(xalign=0, wrap=True, css_classes=["dim-label"], label=LOI_DAN)
        noi.append(self.lenh_trang_thai)
        self.ket_qua = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR,
                                    css_classes=["monospace"], top_margin=8, bottom_margin=8, left_margin=10, right_margin=10)
        self.ket_qua_cuon = Gtk.ScrolledWindow(child=self.ket_qua, min_content_height=140, max_content_height=340,
                                               propagate_natural_height=True, visible=False, css_classes=["ban-ket-qua"])
        noi.append(self.ket_qua_cuon)
        self.nut_moi = Gtk.Button(label="Cuộc mới", css_classes=["flat"], halign=Gtk.Align.START, visible=False,
                                  tooltip_text="Quên mạch hội thoại hiện tại, bắt đầu việc khác")
        self.nut_moi.connect("clicked", self.cuoc_moi)
        noi.append(self.nut_moi)
        cot.append(the)

        # Cần bạn — trọn chiều ngang, vì mỗi việc có tới bốn nút
        self.the_can, self.noi_can = self.the("Cần bạn")
        cot.append(self.the_can)

        luoi = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True, min_children_per_line=1,
                           max_children_per_line=2, column_spacing=18, row_spacing=18)
        self.the_dang, self.noi_dang = self.the("Đang làm")
        self.the_nay, self.noi_nay = self.the("Hôm nay")
        luoi.insert(self.the_dang, -1)
        luoi.insert(self.the_nay, -1)
        cot.append(luoi)
        return cuon

    def chon_muc(self, ma):
        """Chuyển sang mục trong thanh bên (nút "Xem sổ" trên Bàn)."""
        if ma in self.muc_ma:
            self.ds.select_row(self.ds.get_row_at_index(self.muc_ma.index(ma)))

    # ---------- Sổ ----------
    def trang_so(self):
        """Sổ: mọi việc máy đã hỏi chủ và chủ đã quyết, công cụ agent đã gọi — thứ Ubuntu không bao giờ kể.
        Đây là lý do người ta DÁM để agent làm việc trên máy: cái gì cũng có dòng ghi, và quay lại được."""
        cuon = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        cot = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18,
                      margin_top=20, margin_bottom=24, margin_start=28, margin_end=28)
        cuon.set_child(Adw.Clamp(child=cot, maximum_size=1100, tightening_threshold=900))
        cot.append(Gtk.Label(label="Sổ của máy", xalign=0, css_classes=["title-2"]))
        self.so_tom_tat = Gtk.Label(xalign=0, wrap=True, css_classes=["dim-label"], label="")
        cot.append(self.so_tom_tat)
        the1, self.so_viec = self.the("Việc đã hỏi bạn")
        cot.append(the1)
        the2, self.so_goi = self.the("Công cụ trợ lý chính đã gọi")
        cot.append(the2)
        the3, noi3 = self.the("Ảnh hệ thống")
        noi3.append(Gtk.Label(label="Mỗi lần cài đặt hay việc hệ trọng, máy tự chụp một ảnh — xem đã đổi gì và quay về ở mục “Quay lại”.",
                              xalign=0, wrap=True, css_classes=["dim-label"]))
        cot.append(the3)
        return cuon

    def ve_so(self, so):
        self.don(self.so_viec)
        if not so:
            self.so_viec.append(self.dong_mo("Chưa có việc nào được hỏi.", "Agent xin gì, bạn quyết gì — đều ghi ở đây."))
            return
        ds = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
        for x in so[:40]:
            dau, tieu_de, phu = mo_ta_so(x)
            row = Adw.ActionRow(title=tieu_de, subtitle=phu, use_markup=False)
            row.add_prefix(Gtk.Label(label=dau))
            ds.append(row)
        self.so_viec.append(ds)

    # ---------- Tri thức (Bộ não Axle) ----------
    def trang_nao(self):
        """Bộ não Axle: tài liệu chủ gửi lên (raw/, bất biến) và wiki Claude tự bảo trì (~/Axle/Brain). Ở đây chỉ NHÌN:
        danh mục index.md, mấy dòng nhật ký gần nhất, mở thư mục để tự sửa tay."""
        cuon = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        cot = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18,
                      margin_top=20, margin_bottom=24, margin_start=28, margin_end=28)
        cuon.set_child(Adw.Clamp(child=cot, maximum_size=1100, tightening_threshold=900))
        dau = Gtk.Box(spacing=12)
        dau.append(Gtk.Label(label="Bộ não Axle", xalign=0, css_classes=["title-2"], hexpand=True))
        nut_mo = Gtk.Button(label="Mở thư mục", tooltip_text="Sửa tay trang wiki hay xem tệp gốc. Mọi lần ghi đều có trong git.")
        nut_mo.connect("clicked", lambda *_: subprocess.Popen(["xdg-open", BRAIN_DIR]))
        nut_lai = Gtk.Button(icon_name="view-refresh-symbolic", tooltip_text="Đọc lại")
        nut_lai.connect("clicked", lambda *_: self.nap_nao())
        dau.append(nut_mo)
        dau.append(nut_lai)
        cot.append(dau)
        self.nao_tom_tat = Gtk.Label(xalign=0, wrap=True, css_classes=["dim-label"],
                                     label="Gửi tài liệu qua Hỏi Axle (điện thoại) hay hỏi Bàn — tệp vào raw/, Claude tóm tắt thành trang wiki và tra lại được sau này.")
        cot.append(self.nao_tom_tat)
        # Sắp tới: mốc có ngày Claude rút từ giấy tờ — đứng đầu vì là thứ phải làm
        the_m, self.nao_moc = self.the("Sắp tới (60 ngày)")
        cot.append(the_m)
        the0, noi0 = self.the("Liên kết giữa các trang")
        self.nao_do_thi = DoThiBrain(self.chon_trang_nao) if CO_CAIRO else None
        if self.nao_do_thi:
            noi0.append(self.nao_do_thi)
        self.nao_chu_thich = Gtk.Box(spacing=12)   # chỉ những loại đang có trong đồ thị — vẽ lại mỗi lần nạp
        noi0.append(self.nao_chu_thich)
        self.nao_chon = Gtk.Label(label="Chấm một trang để xem nó nối với ai.", xalign=0, wrap=True, css_classes=["dim-label"])
        noi0.append(self.nao_chon)
        hang_nut = Gtk.Box(spacing=8)
        self.nao_nut_mo = Gtk.Button(label="Mở trang", visible=False)
        self.nao_nut_mo.connect("clicked", self.mo_trang_nao)
        self.nao_nut_hoi = Gtk.Button(label="Hỏi Bàn về trang này", visible=False)
        self.nao_nut_hoi.connect("clicked", self.hoi_trang_nao)
        hang_nut.append(self.nao_nut_mo)
        hang_nut.append(self.nao_nut_hoi)
        noi0.append(hang_nut)
        self.nao_trang_chon = None
        cot.append(the0)
        the1, noi1 = self.the("Danh mục (wiki/index.md)")
        self.nao_index = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR,
                                      top_margin=6, bottom_margin=6, left_margin=8, right_margin=8)
        noi1.append(Gtk.ScrolledWindow(child=self.nao_index, min_content_height=200, max_content_height=480,
                                       propagate_natural_height=True, css_classes=["ban-ket-qua"]))
        cot.append(the1)
        the2, self.nao_log = self.the("Nhật ký gần đây (wiki/log.md)")
        cot.append(the2)
        GLib.idle_add(self.nap_nao)
        return cuon

    def nap_nao(self, *_):
        index = doc(os.path.join(BRAIN_DIR, "wiki/index.md"), "")
        if not index:
            self.nao_tom_tat.set_label("Chưa có Bộ não trên máy này — gửi tài liệu đầu tiên qua Hỏi Axle, hay chạy: axle brain")
        else:
            n_tep = sum(1 for _r, _d, fs in os.walk(os.path.join(BRAIN_DIR, "raw")) for f in fs if not f.startswith(".") and ".doi" not in _r)
            n_trang = sum(1 for _r, _d, fs in os.walk(os.path.join(BRAIN_DIR, "wiki")) for f in fs if f.endswith(".md"))
            self.nao_tom_tat.set_label(f"{BRAIN_DIR} · {n_tep} tài liệu · {n_trang} trang wiki · git giữ lịch sử mọi lần ghi")
        buf = self.nao_index.get_buffer()
        buf.set_text("")
        self.ket_qua, cu = self.nao_index, self.ket_qua   # mượn bộ dựng Markdown gọn của Bàn cho ô này
        try:
            self.them_ket_qua(index or "(chưa có)\n")
        finally:
            self.ket_qua = cu
        self.don(self.nao_log)
        dong = [d for d in doc(os.path.join(BRAIN_DIR, "wiki/log.md"), "").splitlines() if d.startswith("- ")][-8:]
        if not dong:
            self.nao_log.append(self.dong_mo("Chưa có gì."))
        for d in reversed(dong):
            self.nao_log.append(Gtk.Label(label=d[2:], xalign=0, wrap=True, css_classes=["dim-label", "caption"]))
        self.nao_chon.set_label("Đang vẽ liên kết…")
        threading.Thread(target=self.nap_do_thi_nao, daemon=True).start()
        threading.Thread(target=lambda: GLib.idle_add(self.dat_moc_nao, sap_toi_brain()), daemon=True).start()
        return False

    def nap_do_thi_nao(self):
        """Luồng nền: hỏi brain.js rồi xếp — vài trăm trang cũng không làm Bàn khựng."""
        if not self.nao_do_thi:
            GLib.idle_add(self.nao_chon.set_label, "Bàn thiếu cầu nối vẽ (python3-gi-cairo) — chạy: sudo apt install python3-gi-cairo rồi mở lại Bàn.")
            return
        g = do_thi_brain()
        vt = xep_do_thi(g["nodes"], g.get("edges", []), *KHUNG_DO_THI) if g else {}
        GLib.idle_add(self.dat_do_thi_nao, g, vt)

    def dat_moc_nao(self, st):
        self.don(self.nao_moc)
        if st is None:
            self.nao_moc.append(self.dong_mo("Chưa đọc được mốc — cần bản Axle đầy đủ (node + brain.js)."))
            return False
        esc = lambda s: GLib.markup_escape_text(str(s), -1)   # noqa: E731
        if not st:
            self.nao_moc.append(self.dong_mo("Chưa có hạn nào trong 60 ngày tới.",
                                             "Claude tự rút hạn trả tiền, hết hạn, báo trước… khi đọc giấy tờ mới. Giấy tờ đã gửi trước đây thì bấm Quét."))
        for x in st[:12]:
            con = "hôm nay" if x["con"] == 0 else f"còn {x['con']} ngày"
            nhan = Gtk.Label(xalign=0, wrap=True, css_classes=[] if x.get("nhac") else ["dim-label"])
            nhan.set_markup(f"<b>{x['ngay'][8:10]}/{x['ngay'][5:7]}</b> · {esc(con)} · {esc(x['viec'])}"
                            + (f" · <i>{esc(x['ten_trang'])}</i>" if x.get("ten_trang") else ""))
            self.nao_moc.append(nhan)
        if len(st) > 12:
            self.nao_moc.append(self.dong_mo(f"và {len(st) - 12} lần nữa — xem đủ: axle brain moc"))
        nut = Gtk.Button(label="Quét giấy tờ cũ", halign=Gtk.Align.START,
                         tooltip_text="Nhờ Claude đọc lại giấy tờ đã gửi để rút hạn trả tiền, hết hạn… (điền sẵn vào ô Bảo Axle làm)")
        nut.connect("clicked", self.quet_moc)
        self.nao_moc.append(nut)
        return False

    def quet_moc(self, *_):
        self.o_lenh.set_text("Quét Bộ não tìm mốc có ngày trong giấy tờ đã gửi (hạn trả tiền, hết hạn, báo trước, tăng giá) và thêm bằng brain_moc_them.")
        self.mo_muc("ban")
        self.o_lenh.grab_focus()

    def kiem_moc(self):
        """Mỗi 30 phút: mốc nào vào khoảng nhắc thì bật thông báo GNOME (một lần; đúng ngày thêm một lần)."""
        def worker():
            st = sap_toi_brain()
            f = os.path.expanduser("~/.cache/axle/moc-da-bao.json")
            try:
                with open(f, encoding="utf-8") as h:
                    da = json.load(h)
            except (OSError, ValueError):
                da = {}
            bao = moc_can_bao(st, da)
            if not bao:
                return
            hom = datetime.date.today().isoformat()
            da.update({k: hom for k, _t, _n in bao})
            cu = (datetime.date.today() - datetime.timedelta(days=120)).isoformat()
            da = {k: v for k, v in da.items() if v >= cu}
            try:
                os.makedirs(os.path.dirname(f), exist_ok=True)
                with open(f, "w", encoding="utf-8") as h:
                    json.dump(da, h)
            except OSError:
                pass
            GLib.idle_add(self.gui_thong_bao, bao)
        threading.Thread(target=worker, daemon=True).start()
        return True

    def gui_thong_bao(self, bao):
        app = self.get_application()
        for khoa, tieu_de, noi_dung in bao:
            n = Gio.Notification.new(tieu_de)
            n.set_body(noi_dung)
            n.set_default_action_and_target_value("app.mo-muc", GLib.Variant.new_string("nao"))
            app.send_notification(f"moc-{khoa}", n)
        return False

    def dat_do_thi_nao(self, g, vt):
        self.nao_do_thi.dat(g, vt)
        self.don(self.nao_chu_thich)
        co = {n.get("loai") for n in (g or {}).get("nodes", [])}
        for loai in ("source", "entity", "project", "decision", "learning", "concept", "thieu"):
            if loai in co:
                c = MAU_LOAI[loai]
                self.nao_chu_thich.append(Gtk.Label(use_markup=True, css_classes=["dim-label", "caption"],
                                                    label=f'<span foreground="#{c[0]:02X}{c[1]:02X}{c[2]:02X}">●</span> {TEN_LOAI[loai]}'))
        self.chon_trang_nao(None)
        if g is None:
            self.nao_chon.set_label("Chưa vẽ được liên kết — máy cần node và /opt/axle/mcp/brain.js (bản Axle đầy đủ).")
        elif not g["nodes"]:
            self.nao_chon.set_label("Chưa có trang nào để nối — gửi tài liệu đầu tiên qua Hỏi Axle là có.")
        else:
            an = f" · ẩn {g['bo_bot']} trang ít liên kết" if g.get("bo_bot") else ""
            self.nao_chon.set_label(f"{len(g['nodes'])} trang · {len(g.get('edges', []))} liên kết{an}. Chấm một trang để xem nó nối với ai.")
        return False

    def chon_trang_nao(self, n):
        """Bàn gọi khi chủ chấm một chấm trên đồ thị (None = bỏ chọn)."""
        self.nao_trang_chon = n
        self.nao_nut_mo.set_visible(bool(n) and n["loai"] != "thieu")
        self.nao_nut_hoi.set_visible(bool(n))
        if not n:
            return
        self.nao_nut_hoi.set_label("Tạo trang này" if n["loai"] == "thieu" else "Hỏi Bàn về trang này")
        hx = [self.nao_do_thi.ten(h) for h in sorted(self.nao_do_thi.hang_xom(n["id"]))]
        chu = f"{n.get('ten_day') or n['ten']} · {TEN_LOAI.get(n['loai'], n['loai'])} · {n.get('so_link', 0)} liên kết"
        if n.get("mo_ta"):
            chu += f"\n{n['mo_ta']}"
        if hx:
            chu += "\nNối với: " + " · ".join(hx)
        self.nao_chon.set_label(chu)

    def mo_trang_nao(self, *_):
        n = self.nao_trang_chon
        if n and n.get("duong"):
            subprocess.Popen(["xdg-open", os.path.join(BRAIN_DIR, n["duong"])])

    def hoi_trang_nao(self, *_):
        n = self.nao_trang_chon
        if not n:
            return
        if n["loai"] == "thieu":
            cau = f"Trong Bộ não, trang [[{n['id']}]] đang được nhắc mà chưa có — tạo trang đó từ những gì đã biết."
        else:
            cau = f"Trong Bộ não, trang [[{n['id']}]] nói gì? Tóm tắt và các liên kết của nó."
        self.o_lenh.set_text(cau)
        self.tabs.set_visible_child_name("ban")
        self.o_lenh.grab_focus()

    def chao_hoi(self):
        u = pwd.getpwuid(os.getuid())
        ten = (u.pw_gecos or "").split(",")[0].strip() or u.pw_name
        now = datetime.datetime.now()
        self.chao.set_label(loi_chao(now.hour, ten))
        self.chao_phu.set_label(f"{THU[now.weekday()]}, {now:%d/%m/%Y} · {mot_dong(['hostname'])} · Axle {doc('/etc/axle/version', '?')}")

    def theo_doi_ban(self):
        """Bộ duyệt ghi ban.json bằng cách ghi tạm rồi đổi tên → theo dõi tệp là thấy ngay; vẫn đọc lại mỗi 10 giây
        cho tuổi việc chờ trôi và phòng khi bộ theo dõi tệp không bắn (tệp chưa tồn tại lúc mở Bàn)."""
        try:
            self.mon = Gio.File.new_for_path(BAN_FILE).monitor_file(Gio.FileMonitorFlags.NONE, None)
            self.mon.connect("changed", lambda *_: self.nap_ban())
        except GLib.Error:
            self.mon = None
        self.chao_hoi()
        self.nap_ban()
        self.nap_hom_nay()
        GLib.timeout_add_seconds(10, self.nap_ban)
        GLib.timeout_add_seconds(60, self.nap_hom_nay)

    def nap_ban(self, *_):
        chu = doc(BAN_FILE, "")
        b = doc_ban(chu) if chu else None
        self.don(self.noi_can)
        self.don(self.noi_dang)
        if b is None:
            self.noi_can.append(self.dong_mo("Chưa đọc được việc đang chờ.",
                                             "Bộ duyệt chưa chạy, hoặc máy đang chạy bản Axle cũ (sudo axle update)."))
            self.noi_dang.append(self.dong_mo("Chưa đọc được danh sách agent."))
            return True
        pend, hn, ag, so = b
        self.hom_nay_duyet = hn
        if hasattr(self, "so_viec"):
            self.ve_so(so)

        if not pend:
            self.noi_can.append(self.dong_mo("Không có việc nào chờ bạn.",
                                             "Agent xin gì thì hiện ở đây — và rung trên điện thoại."))
        else:
            ds = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
            for r in pend:
                viec, ai = tom_tat_viec(r)
                # use_markup=False: chữ trong tin xin duyệt (lệnh, đường dẫn) có thể chứa < > & — không cho Pango hiểu là thẻ
                row = Adw.ActionRow(title=viec, subtitle=f"{ai} · bậc {r['tier']} · {tuoi(r['ageSec'])}", use_markup=False)
                row.set_subtitle_lines(2)
                for c in r["buttons"]:
                    ten, css = NUT[c]
                    b2 = Gtk.Button(label=ten, valign=Gtk.Align.CENTER, css_classes=css)
                    b2.connect("clicked", self.duyet_tai_may, r["id"], c)
                    row.add_suffix(b2)
                ds.append(row)
            self.noi_can.append(ds)
            self.noi_can.append(Gtk.Label(label="Bấm là hiện hộp mật khẩu của hệ thống — cùng mức tin cậy với sudo.",
                                          xalign=0, wrap=True, css_classes=["dim-label", "caption"]))

        if not ag:
            self.noi_dang.append(self.dong_mo("Chưa có agent nào trên máy.", "Thêm ở mục Agent."))
        else:
            for a in ag:
                vai = "trợ lý chính · dùng quyền của bạn" if a.get("vai") == "chinh" else f"hộp cát {a.get('user') or ''}".strip()
                tt = "TẠM DỪNG" if a.get("tam_dung") else "sẵn sàng"
                self.noi_dang.append(Gtk.Label(label=f"{a['ten']} — {vai} · {tt}", xalign=0, wrap=True))
        self.noi_dang.append(self.o_gan_day())
        return True

    def o_gan_day(self):
        """Vài lần gọi công cụ gần nhất của trợ lý chính (audit.jsonl trong nhà chủ — đọc thẳng, không sudo)."""
        n, gan = doc_audit(doc_duoi(AUDIT), datetime.date.today().isoformat())
        self.so_goi_hom_nay = n
        hop = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, margin_top=6)
        hop.append(Gtk.Label(label="Gọi công cụ gần đây", xalign=0, css_classes=["caption-heading"]))
        if not gan:
            hop.append(Gtk.Label(label="chưa có", xalign=0, css_classes=["dim-label", "caption"]))
        for d in gan:
            hop.append(Gtk.Label(label=d, xalign=0, css_classes=["dim-label", "caption", "monospace"], ellipsize=3))
        return hop

    def nap_hom_nay(self, *_):
        self.don(self.noi_nay)
        hn = getattr(self, "hom_nay_duyet", None) or {}
        if hn:
            self.noi_nay.append(Gtk.Label(xalign=0, wrap=True, label=(
                f"Duyệt: {hn.get('chu_duyet', 0)} bạn duyệt · {hn.get('tu_duyet', 0)} tự duyệt theo luật · "
                f"{hn.get('tu_choi', 0)} từ chối · {hn.get('het_han', 0)} hết hạn")))
        else:
            self.noi_nay.append(self.dong_mo("Chưa có số duyệt hôm nay."))
        n, gan = doc_audit(doc_duoi(AUDIT), datetime.date.today().isoformat(), toi_da=30)
        self.so_goi_hom_nay = n
        self.noi_nay.append(Gtk.Label(label=f"Trợ lý chính gọi công cụ {n} lần", xalign=0))
        self.noi_nay.append(Gtk.Label(label=f"Máy chạy liên tục {self.chay_lau()}", xalign=0, css_classes=["dim-label"]))
        nut = Gtk.Button(label="Xem sổ", css_classes=["flat"], halign=Gtk.Align.START)
        nut.connect("clicked", lambda *_: self.chon_muc("so"))
        self.noi_nay.append(nut)
        if hasattr(self, "so_goi"):        # trang Sổ dùng cùng số và cùng danh sách — một nguồn, không hai con số
            duyet = (f"Hôm nay: {hn.get('chu_duyet', 0)} bạn duyệt · {hn.get('tu_duyet', 0)} tự duyệt theo luật · "
                     f"{hn.get('tu_choi', 0)} từ chối · {hn.get('het_han', 0)} hết hạn · trợ lý chính gọi công cụ {n} lần") if hn \
                else f"Hôm nay: trợ lý chính gọi công cụ {n} lần"
            self.so_tom_tat.set_label(duyet)
            self.don(self.so_goi)
            if not gan:
                self.so_goi.append(self.dong_mo("Chưa có."))
            for d in gan:
                self.so_goi.append(Gtk.Label(label=d, xalign=0, css_classes=["dim-label", "caption", "monospace"], ellipsize=3))
        return True

    def duyet_tai_may(self, _nut, ma, c):
        ten = NUT[c][0]
        self.chay_nen(("duyet", ma, c), True, f"Đã ghi: {ten.lower()} (#{ma})", sau=self.nap_ban)

    # "Bảo Axle làm": chạy `axle claude` (Claude Code trên máy, cổng xin phép là điện thoại / Cần bạn)
    def bao_lam(self, *_):
        cau = self.o_lenh.get_text().strip()
        if not cau or self.dang_lam:
            return
        self.dang_lam = True
        self.nut_lam.set_sensitive(False)
        self.nut_dung.set_visible(True)
        self.ket_qua_cuon.set_visible(True)
        self.them_ket_qua(f"› {cau}\n")
        self.lenh_trang_thai.set_label("Đang làm… việc hệ trọng sẽ hỏi bạn trước khi làm.")
        # --dong: chữ chảy ngay khi có + mỗi lần Claude dùng công cụ một dòng "→ …" (core/desktop/claude-dong.py)
        args = [AXLE, "claude", cau, "--dong", "--phien", self.phien] + (["--tiep"] if self.co_cuoc else [])

        def worker():
            try:
                p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                     text=True, bufsize=1)
            except OSError as e:
                GLib.idle_add(self.xong_lam, 1, str(e))
                return
            self.tien_trinh = p
            for dong in p.stdout:
                GLib.idle_add(self.them_ket_qua, dong)
            p.wait()
            GLib.idle_add(self.xong_lam, p.returncode, "")

        threading.Thread(target=worker, daemon=True).start()

    def them_ket_qua(self, chu):
        buf = self.ket_qua.get_buffer()
        if not getattr(self, "_tag_ok", False):     # tag tạo một lần: đậm / mã / mờ
            tb = buf.get_tag_table()
            for ten, kw in (("dam", {"weight": Pango.Weight.BOLD}), ("ma", {"family": "monospace"}), ("mo", {"foreground": "#8b93a1"})):
                if not tb.lookup(ten):
                    buf.create_tag(ten, **kw)
            self._tag_ok = True
        for dong in chu.splitlines(True):
            for phan, tags in md_lite(dong):
                buf.insert_with_tags_by_name(buf.get_end_iter(), phan, *sorted(tags)) if tags else buf.insert(buf.get_end_iter(), phan)
            if dong.endswith("\n"):
                buf.insert(buf.get_end_iter(), "\n")
        if chu.startswith("→ ") and self.dang_lam:          # dòng công cụ → cho thấy Claude đang làm tới đâu
            self.lenh_trang_thai.set_label(f"Đang: {chu[2:].strip()[:120]}")
        adj = self.ket_qua_cuon.get_vadjustment()
        GLib.idle_add(lambda: adj.set_value(adj.get_upper() - adj.get_page_size()) or False)
        return False

    def xong_lam(self, ma, loi):
        self.dang_lam = False
        self.tien_trinh = None
        self.nut_lam.set_sensitive(True)
        self.nut_dung.set_visible(False)
        if loi:
            self.them_ket_qua(loi + "\n")
        buf = self.ket_qua.get_buffer()
        chu = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), False)
        if ma == 0:
            self.co_cuoc = True
            self.nut_moi.set_visible(True)
            self.o_lenh.set_text("")
            self.lenh_trang_thai.set_label("Xong. Hỏi tiếp thì Axle nhớ mạch — hoặc bấm “Cuộc mới”.")
        elif ma == -15:
            self.lenh_trang_thai.set_label("Đã dừng.")
        else:
            self.lenh_trang_thai.set_label(f"Không làm được (mã {ma}). {goi_y_loi(chu)}".strip())
        self.them_ket_qua("\n")
        return False

    def dung_lam(self, *_):
        p = self.tien_trinh
        if p:
            try:
                p.terminate()
            except OSError:
                pass

    def cuoc_moi(self, *_):
        self.co_cuoc = False
        self.phien = str(uuid.uuid4())
        self.nut_moi.set_visible(False)
        self.ket_qua.get_buffer().set_text("")
        self.ket_qua_cuon.set_visible(False)
        self.lenh_trang_thai.set_label(LOI_DAN)

    # ---------- Máy ----------
    def trang_tong_quan(self):
        t = Trang("Máy", "computer-symbolic")
        # Mạng đứng đầu: mất mạng là thứ chủ máy cần biết ngay, và là thứ trước đây phải gõ lệnh + chụp màn hình gửi đi
        gm = Adw.PreferencesGroup(title="Mạng", description="Máy tự khám: dây, địa chỉ IP, router, Internet, DNS, Tailscale, trạm của app.")
        nut_kiem = Gtk.Button(label="Kiểm lại", valign=Gtk.Align.CENTER)
        nut_kiem.connect("clicked", self.kiem_mang)
        gm.set_header_suffix(nut_kiem)
        self.mang_dong = Adw.ActionRow(title="Đang khám mạng…", subtitle_lines=0, use_markup=False)
        self.mang_icon = Gtk.Image(icon_name="network-wired-symbolic")
        self.mang_dong.add_prefix(self.mang_icon)
        gm.add(self.mang_dong)
        self.mang_buoc = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, margin_top=10)
        gm.add(self.mang_buoc)
        t.add(gm)
        g = Adw.PreferencesGroup(title="Máy này")
        self.hang = {}
        for k, ten in [("host", "Tên máy"), ("os", "Hệ điều hành"), ("dia", "Ổ đĩa"),
                       ("ram", "RAM"), ("uptime", "Chạy liên tục"), ("hong", "Dịch vụ hỏng")]:
            r = Adw.ActionRow(title=ten)
            nhan = Gtk.Label(label="…", css_classes=["dim-label"], selectable=True)
            r.add_suffix(nhan)
            self.hang[k] = nhan
            g.add(r)
        t.add(g)

        g2 = Adw.PreferencesGroup()
        r = Adw.ActionRow(title="Cập nhật Axle",
                          subtitle="Tải bản mới nhất và cài. Máy tự chụp ảnh hệ thống trước, hỏng thì quay lại được.")
        nut = Gtk.Button(label="Cập nhật", valign=Gtk.Align.CENTER)
        nut.connect("clicked", self.cap_nhat)
        r.add_suffix(nut)
        g2.add(r)

        r2 = Adw.ActionRow(title="Chụp ảnh hệ thống ngay",
                           subtitle="Ghi lại trạng thái lúc này để lỡ hỏng thì quay về được.")
        nut2 = Gtk.Button(label="Chụp", valign=Gtk.Align.CENTER)
        nut2.connect("clicked", lambda *_: self.chay_nen(("snapshot", "từ cửa sổ Axle"), True, "Đã chụp ảnh hệ thống"))
        r2.add_suffix(nut2)
        g2.add(r2)
        t.add(g2)
        return t

    def mo_muc(self, ma):
        self.ds.select_row(self.ds.get_row_at_index(self.muc_ma.index(ma)))

    def mang_doi(self, *_):
        """Gio báo mạng đổi — gom các báo liên tiếp (cắm dây là cả loạt), 8 giây sau khám lại một lần."""
        if not self.hen_mang:
            self.hen_mang = GLib.timeout_add_seconds(8, self._mang_hen)

    def _mang_hen(self):
        self.hen_mang = 0
        self.kiem_mang()
        return False

    def kiem_mang(self, *_):
        """`axle net kiem --json` ở luồng nền (vài giây; mạng chết thì lâu hơn), xong thì vẽ kết quả + biểu ngữ."""
        if self.dang_kiem_mang:
            return False
        self.dang_kiem_mang = True
        self.mang_dong.set_title("Đang khám mạng…")
        self.mang_dong.set_subtitle("Mất vài giây")

        def worker():
            _ma, ra = chay("net", "kiem", "--json", timeout=45)
            dong = next((d for d in ra.splitlines() if d.startswith("{")), "")
            try:
                kq = json.loads(dong)
            except ValueError:
                kq = None
            GLib.idle_add(self.hien_mang, kq, ra)
        threading.Thread(target=worker, daemon=True).start()
        return False

    def hien_mang(self, kq, ra=""):
        self.dang_kiem_mang = False
        self.don(self.mang_buoc)
        if not kq:
            self.mang_icon.set_from_icon_name("dialog-question-symbolic")
            self.mang_dong.set_title("Chưa khám được mạng")
            self.mang_dong.set_subtitle(ra.strip().splitlines()[-1][:200] if ra.strip() else "Lệnh axle net kiem không trả lời")
            return False
        self.mang_icon.set_from_icon_name({"ok": "emblem-ok-symbolic", "canh_bao": "dialog-warning-symbolic"}.get(kq["muc"], "network-error-symbolic"))
        self.mang_dong.set_title(kq["tieu_de"])
        self.mang_dong.set_subtitle(f"khám lúc {(kq.get('luc') or '')[11:16] or datetime.datetime.now().strftime('%H:%M')}")
        # Lời giải thích là chỗ chủ máy cần đọc (lỗi ở đâu, sửa sao) → chữ thường, không để làm dòng phụ nhỏ mờ
        if kq.get("giai_thich"):
            self.mang_buoc.append(Gtk.Label(label=kq["giai_thich"], xalign=0, wrap=True, margin_bottom=6))
        ky = {"ok": "✓", "loi": "✗", "bo_qua": "·", "khong_ro": "–"}
        # Mạng ổn thì một dòng tóm tắt là đủ; có lỗi mới liệt kê từng bước
        for b in (kq.get("buoc", []) if kq["muc"] != "ok" else []):
            nhan = Gtk.Label(xalign=0, wrap=True, css_classes=[] if b["trang_thai"] in ("ok", "loi") else ["dim-label"])
            nhan.set_markup(f'{ky.get(b["trang_thai"], "?")} <b>{GLib.markup_escape_text(b["ten"], -1)}</b> · '
                            f'{GLib.markup_escape_text(b["chi_tiet"], -1)}')
            self.mang_buoc.append(nhan)
        if kq.get("lenh"):
            self.mang_buoc.append(Gtk.Label(label="Chạy trong Terminal (bôi đen để chép):", xalign=0, margin_top=6,
                                            css_classes=["dim-label", "caption"]))
            for l in kq["lenh"]:
                self.mang_buoc.append(Gtk.Label(label=l, xalign=0, wrap=True, selectable=True, css_classes=["monospace"]))
        loi = kq["muc"] == "loi"
        self.bn_mang.set_title(f"Máy đang mất mạng: {kq['tieu_de']}" if loi else "")
        self.bn_mang.set_revealed(loi)
        return False

    @staticmethod
    def chay_lau():
        """`uptime -p` trả tiếng Anh ("up 4 hours, 4 minutes") — đọc thẳng /proc/uptime rồi tự viết tiếng Việt."""
        try:
            giay = int(float(doc("/proc/uptime", "0").split()[0]))
        except (ValueError, IndexError):
            return "?"
        ngay, gio, phut = giay // 86400, (giay % 86400) // 3600, (giay % 3600) // 60
        if ngay:
            return f"{ngay} ngày {gio} giờ"
        if gio:
            return f"{gio} giờ {phut} phút"
        return f"{phut} phút"

    def lam_moi(self):
        ver = doc("/etc/axle/version", "?")
        self.hang["host"].set_label(f"{mot_dong(['hostname'])} · Axle {ver}")
        m = re.search(r'^PRETTY_NAME="(.*)"$', doc("/etc/os-release"), re.M)
        self.hang["os"].set_label(m.group(1) if m else "?")
        df = mot_dong(["df", "-h", "/"]).splitlines()
        if len(df) > 1:
            c = df[-1].split()
            self.hang["dia"].set_label(f"{c[2]} / {c[1]} ({c[4]})")
        fr = mot_dong(["free", "-h"]).splitlines()
        if len(fr) > 1:
            c = fr[1].split()
            self.hang["ram"].set_label(f"{c[2]} / {c[1]}")
        self.hang["uptime"].set_label(self.chay_lau())
        hong = mot_dong(["systemctl", "--failed", "--no-legend", "--plain"])
        so = len([l for l in hong.splitlines() if l.strip()])
        self.hang["hong"].set_label("không có" if so == 0 else f"{so} dịch vụ")
        return False

    def cap_nhat(self, *_):
        self.bao("Đang cập nhật… có thể mất vài phút")
        self.chay_nen(("update",), True, "Cập nhật xong", sau=self.lam_moi, timeout=900)

    def chay_nen(self, args, root, xong, sau=None, timeout=60):
        def worker():
            ma, ra = chay(*args, root=root, timeout=timeout)
            def ve():
                self.bao(xong if ma == 0 else (ra.splitlines()[-1] if ra else "Không làm được"))
                if sau:
                    sau()
                return False
            GLib.idle_add(ve)
        threading.Thread(target=worker, daemon=True).start()

    # ---------- Điện thoại ----------
    def trang_dien_thoai(self):
        t = Trang("Điện thoại", "phone-symbolic")
        # Máy VP 22/9: bản cài công khai không có địa chỉ trạm → bấm Ghép chỉ thấy "hết 10 phút", không hiểu vì sao.
        # Chưa có trạm thì hiện ô đặt trạm ngay đây, và lỗi thật của lệnh ghép phải được in ra chứ không nuốt.
        self.tram_g = Adw.PreferencesGroup(
            title="Trạm chuyển tiếp", visible=not os.path.exists(APP_JSON),
            description="Điện thoại và máy nói chuyện qua một trạm chuyển tiếp (Axle Cloud). Bản cài công khai chưa có "
                        "địa chỉ trạm — dán vào đây một lần rồi mới ghép được.")
        hang_tram = Gtk.Box(spacing=8, margin_top=8, margin_bottom=8)
        self.o_tram = Gtk.Entry(hexpand=True, placeholder_text="https://tram-cua-ban.example.com")
        self.o_tram.connect("activate", self.dat_tram)
        nut_tram = Gtk.Button(label="Đặt trạm", css_classes=["suggested-action"])
        nut_tram.connect("clicked", self.dat_tram)
        hang_tram.append(self.o_tram)
        hang_tram.append(nut_tram)
        self.tram_g.add(hang_tram)
        t.add(self.tram_g)
        g = Adw.PreferencesGroup(
            title="Ghép điện thoại",
            description="Điện thoại đã ghép là nơi duyệt mọi việc hệ trọng bằng Face ID, và xem được tình "
                        "trạng máy từ xa. Cần app Axle trên iPhone.")
        self.qr_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=12, margin_bottom=12)
        # Ẩn tới khi có mã thật: để sẵn một ô ảnh rỗng cao 260px là chừa một mảng trống to giữa thẻ
        self.qr_anh = Gtk.Picture(content_fit=Gtk.ContentFit.CONTAIN, height_request=260, visible=False)
        self.qr_chu = Gtk.Label(label="Bấm “Ghép điện thoại” rồi quét mã bằng app Axle.",
                                wrap=True, justify=Gtk.Justification.CENTER, css_classes=["dim-label"])
        self.qr_box.append(self.qr_anh)
        self.qr_box.append(self.qr_chu)
        self.nut_ghep = Gtk.Button(label="Ghép điện thoại", halign=Gtk.Align.CENTER, css_classes=["suggested-action"])
        self.nut_ghep.connect("clicked", self.ghep)
        self.qr_box.append(self.nut_ghep)
        self.nut_xacnhan = Gtk.Button(label="Mã khớp — ghép", halign=Gtk.Align.CENTER,
                                      css_classes=["suggested-action"], visible=False)
        self.qr_box.append(self.nut_xacnhan)
        g.add(self.qr_box)
        t.add(g)
        return t

    def dat_tram(self, *_):
        url = self.o_tram.get_text().strip().rstrip("/")
        if not re.match(r"^https?://[A-Za-z0-9.:-]+(/.*)?$", url):
            self.bao("Địa chỉ trạm phải dạng https://…")
            return
        self.chay_nen(("app", "setup", "--relay", url), True, "Đã đặt trạm — giờ bấm “Ghép điện thoại”",
                      sau=lambda: self.tram_g.set_visible(False))

    def ghep(self, *_):
        if not os.path.exists(APP_JSON):
            self.qr_chu.set_label("Chưa có địa chỉ trạm chuyển tiếp — điền ở ô “Trạm chuyển tiếp” phía trên trước.")
            self.tram_g.set_visible(True)
            return
        self.nut_ghep.set_sensitive(False)
        self.qr_chu.set_label("Đang mở phiên ghép…")
        self.pending = None

        def worker():
            # `--khong-hoi`: in mã QR ngay, chờ điện thoại quét, rồi in mã đối chiếu — không hỏi gì ở terminal
            try:
                p = subprocess.Popen(["pkexec", AXLE, "app", "pair", "--khong-hoi"],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            except OSError as e:
                GLib.idle_add(self.ghep_loi, str(e))
                return
            co_qr, cuoi = False, ""
            for dong in p.stdout:
                d = dong.strip()
                if d and not d.startswith("axle1:") and "█" not in d and "▀" not in d and "▄" not in d:
                    cuoi = d                      # dòng chữ cuối cùng = lỗi thật nếu không ra được mã
                if d.startswith("axle1:"):        # chuỗi ghép cặp thô, in ra ngay sau hình QR dạng chữ
                    co_qr = True
                    GLib.idle_add(self.ve_qr, d)
                m = re.search(r"Mã đối chiếu:\s*(\d{3})\s*(\d{3})", d)
                if m:
                    GLib.idle_add(self.hien_sas, f"{m.group(1)} {m.group(2)}")
                m2 = re.search(r"axle app confirm (\S+)", d)
                if m2:
                    self.pending = m2.group(1)
            p.wait()
            if not self.pending:
                if co_qr:
                    GLib.idle_add(self.ghep_loi, "Không có điện thoại nào quét mã (hết 10 phút)")
                else:
                    GLib.idle_add(self.ghep_loi, "Không mở được phiên ghép: " + (cuoi or f"lệnh thoát mã {p.returncode}"))

        threading.Thread(target=worker, daemon=True).start()

    def ve_qr(self, chuoi):
        f = os.path.join(tempfile.gettempdir(), "axle-pair-qr.png")
        try:
            subprocess.run(["qrencode", "-s", "6", "-m", "2", "-o", f, chuoi], check=True, timeout=10)
            self.qr_anh.set_filename(f)
            self.qr_anh.set_visible(True)
            self.qr_chu.set_label("Mở app Axle trên iPhone → Ghép máy → quét mã này (hạn 10 phút).")
        except (OSError, subprocess.SubprocessError):
            self.qr_chu.set_label(chuoi)
        return False

    def hien_sas(self, sas):
        self.qr_anh.set_visible(False)
        self.qr_chu.set_label(f"Điện thoại hiện mã nào?\n\nMáy này: <b>{sas}</b>\n\n"
                              "Khớp thì bấm nút dưới. Không khớp thì đóng cửa sổ — có người chen ngang.")
        self.qr_chu.set_use_markup(True)
        self.nut_ghep.set_visible(False)
        self.nut_xacnhan.set_visible(True)
        self.nut_xacnhan.connect("clicked", self.xac_nhan)
        return False

    def xac_nhan(self, *_):
        self.nut_xacnhan.set_sensitive(False)
        self.chay_nen(("app", "confirm", self.pending or ""), True, "Đã ghép điện thoại", sau=self.reset_ghep)

    def reset_ghep(self):
        self.nut_xacnhan.set_visible(False)
        self.nut_ghep.set_visible(True)
        self.nut_ghep.set_sensitive(True)
        self.qr_chu.set_label("Xong. Từ giờ yêu cầu duyệt sẽ hiện trên điện thoại đó.")
        return False

    def ghep_loi(self, chu):
        self.qr_chu.set_label(chu)
        self.nut_ghep.set_sensitive(True)
        return False

    # ---------- Tính năng ----------
    def trang_tinh_nang(self):
        t = Trang("Tính năng", "preferences-system-symbolic")
        g = Adw.PreferencesGroup(title="Điều khiển từ điện thoại")

        self.cong_tac = {}
        for khoa, ten, mo_ta, bat, tat, dang_bat in [
            ("dangnhap", "Đăng nhập bằng điện thoại",
             "Ngồi xuống máy, bấm tên mình, chạm duyệt trên điện thoại là vào — khỏi gõ mật khẩu. "
             "Không duyệt hay mất mạng thì vẫn hiện ô mật khẩu như cũ.",
             ("dangnhap", "on"), ("dangnhap", "off"),
             lambda: "ĐANG BẬT" in chay("dangnhap", "status")[1]),
            ("terminal", "Gõ lệnh từ app",
             "Gõ lệnh lên máy này từ app trên điện thoại, mỗi lệnh ký bằng Face ID. Chạy bằng tài khoản "
             "của bạn, không phải root. Đây là đường DUY NHẤT cho điện thoại gửi lệnh tuỳ ý — tắt nếu không cần.",
             ("app", "terminal", "on"), ("app", "terminal", "off"),
             lambda: "BẬT" in chay("app", "terminal", "status")[1]),
        ]:
            r = Adw.SwitchRow(title=ten, subtitle=mo_ta)
            r.set_active(dang_bat())
            r.connect("notify::active", self.doi_cong_tac, khoa, bat, tat)
            self.cong_tac[khoa] = (r, dang_bat)
            g.add(r)
        t.add(g)

        g2 = Adw.PreferencesGroup(
            title="Chia sẻ màn hình",
            description="Cho agent xem màn hình thật của bạn. Lần đầu GNOME sẽ hỏi ngay trên máy này; "
                        "đồng ý một lần rồi thì xem được từ xa.")
        r = Adw.ActionRow(title="Giấy phép đã nhớ", subtitle="Quên đi thì lần sau GNOME hỏi lại từ đầu.")
        nut = Gtk.Button(label="Quên giấy phép", valign=Gtk.Align.CENTER, css_classes=["destructive-action"])
        nut.connect("clicked", lambda *_: self.chay_nen(("screen", "quen"), True, "Đã quên giấy phép màn hình"))
        r.add_suffix(nut)
        g2.add(r)
        t.add(g2)
        return t

    def doi_cong_tac(self, row, _p, khoa, bat, tat):
        args = bat if row.get_active() else tat
        def sau():
            _r, doc_lai = self.cong_tac[khoa]
            that = doc_lai()
            if that != row.get_active():      # pkexec bị huỷ hay lệnh hỏng → trả công tắc về đúng sự thật
                row.handler_block_by_func(self.doi_cong_tac)
                row.set_active(that)
                row.handler_unblock_by_func(self.doi_cong_tac)
            return False
        self.chay_nen(args, True, "Đã đổi", sau=sau)


    # ---------- Agent ----------
    def trang_agent(self):
        """Agent là lý do Axle tồn tại, mà cửa sổ này lại chưa cho thấy máy đang có agent nào, nó được
        phép làm gì, và dừng nó ở đâu. Xem danh sách KHÔNG cần mật khẩu (cửa hẹp axle-agents lọc sạch,
        không bao giờ đưa token ra)."""
        t = Trang("Agent", "network-workgroup-symbolic")
        self.nhom_agent = Adw.PreferencesGroup(
            title="Agent trên máy này",
            description="Mỗi agent chạy bằng một tài khoản riêng trong hộp cát, chỉ dùng được những công cụ "
                        "bạn cấp, và mọi việc hệ trọng đều phải xin bạn duyệt.")
        t.add(self.nhom_agent)
        GLib.idle_add(self.nap_agent)
        return t

    def nap_agent(self):
        for cu in list(getattr(self, "_hang_agent", [])):
            self.nhom_agent.remove(cu)
        self._hang_agent = []

        def them(r):
            self.nhom_agent.add(r)
            self._hang_agent.append(r)

        ma, ra = chay("agents", "--json")
        try:
            ds = json.loads(ra) if ma == 0 else []
        except ValueError:
            ds = []
        if ma != 0:
            them(Adw.ActionRow(title="Chưa đọc được danh sách agent",
                               subtitle=(ra.splitlines()[-1] if ra else "")))
            return False
        if not ds:
            them(Adw.ActionRow(
                title="Chưa có agent nào",
                # KHÔNG dùng dấu ngoặc nhọn trong chữ của libadwaita: phụ đề chạy qua Pango markup nên
                # "<tên>" bị hiểu là thẻ và làm vỡ cả hàng
                subtitle="Thêm ở cửa sổ dòng lệnh:  sudo axle agent add TÊN --vai chinh\n"
                         "Trợ lý chính dùng quyền của bạn (trừ vùng bí mật); agent phụ sống trong hộp cát riêng."))
            return False

        for a in ds:
            ten = a.get("ten", "?")
            chinh = a.get("vai") == "chinh"
            dung = a.get("tam_dung")
            if chinh:
                phu_de = "trợ lý chính · dùng quyền của bạn, trừ vault"
            else:
                cc = a.get("cong_cu") or []
                phu_de = f"{a.get('user') or '?'} · {len(cc)} công cụ: {', '.join(cc[:4])}{'…' if len(cc) > 4 else ''}"
            r = Adw.ActionRow(title=ten, subtitle=phu_de)
            nhan = Gtk.Label(label="TẠM DỪNG" if dung else ("đang chạy" if a.get("dang_chay") else "sẵn sàng"),
                             css_classes=["dim-label"] if not dung else ["error"])
            r.add_suffix(nhan)
            nut = Gtk.Button(label="Mở lại" if dung else "Dừng khẩn cấp", valign=Gtk.Align.CENTER,
                             css_classes=[] if dung else ["destructive-action"])
            nut.connect("clicked", self.doi_agent, ten, bool(dung))
            r.add_suffix(nut)
            them(r)
        return False

    def doi_agent(self, _nut, ten, dang_dung):
        lenh = ("agent", "start" if dang_dung else "stop", ten)
        self.chay_nen(lenh, True, f"Đã {'mở lại' if dang_dung else 'dừng'} {ten}", sau=self.nap_agent)

    # ---------- Quay lại ----------
    def trang_quay_lai(self):
        """Thứ làm Axle khác một bản Ubuntu: máy quay ngược lại được. Trước giờ nó chỉ có trong dòng lệnh,
        nên chẳng ai biết mà dùng — mà đây chính là lý do người ta DÁM để agent đụng vào máy."""
        t = Trang("Quay lại", "edit-undo-symbolic")
        self.nhom_snap = Adw.PreferencesGroup(
            title="Ảnh hệ thống",
            description="Mỗi lần cài đặt hay làm việc hệ trọng, máy tự chụp lại một ảnh. Quay về ảnh nào là "
                        "các tệp hệ thống trở lại đúng lúc đó.\n\nKHÔNG bị đụng tới: thư mục nhà, nhật ký, "
                        "Docker, vault, Tailscale.")
        t.add(self.nhom_snap)
        GLib.idle_add(self.nap_snapshot)
        return t

    def nap_snapshot(self):
        for cu in list(getattr(self, "_hang_snap", [])):
            self.nhom_snap.remove(cu)
        self._hang_snap = []
        ma, ra = chay("snapshots", "--csv")
        if ma != 0:
            r = Adw.ActionRow(title="Chưa đọc được danh sách ảnh hệ thống", subtitle=ra.splitlines()[-1] if ra else "")
            self.nhom_snap.add(r)
            self._hang_snap.append(r)
            return False
        dong = [d for d in ra.splitlines() if re.match(r"^\s*\d+,", d)]
        for d in reversed(dong[-20:]):                       # mới nhất lên đầu
            phan = d.split(",", 2)
            if len(phan) < 3:
                continue
            so, ngay, mo_ta = phan[0].strip(), phan[1].strip(), phan[2].strip().strip('"')
            r = Adw.ExpanderRow(title=mo_ta or f"Ảnh #{so}", subtitle=f"#{so} · {ngay}")
            r.connect("notify::expanded", self.mo_snapshot, so)
            self.nhom_snap.add(r)
            self._hang_snap.append(r)
        if not self._hang_snap:
            r = Adw.ActionRow(title="Chưa có ảnh hệ thống nào")
            self.nhom_snap.add(r)
            self._hang_snap.append(r)
        return False

    def mo_snapshot(self, row, _p, so):
        if not row.get_expanded() or getattr(row, "_da_nap", False):
            return
        row._da_nap = True
        cho = Adw.ActionRow(title="Đang xem đã đổi những gì…")
        row.add_row(cho)

        def worker():
            ma, ra = chay("diff", so, timeout=60)
            def ve():
                row.remove(cho)
                dong = [d for d in ra.splitlines() if d.strip()] if ma == 0 else []
                if not dong:
                    row.add_row(Adw.ActionRow(title="Không có tệp hệ thống nào khác so với bây giờ"))
                else:
                    kho = Gtk.Label(label="\n".join(dong[:40]) + ("" if len(dong) <= 40 else f"\n… và {len(dong) - 40} tệp nữa"),
                                    xalign=0, wrap=True, selectable=True,
                                    css_classes=["dim-label", "monospace"], margin_start=12, margin_end=12, margin_bottom=8)
                    hop = Adw.ActionRow()
                    hop.set_child(kho)
                    row.add_row(hop)
                nut_row = Adw.ActionRow(title=f"Quay về ảnh #{so}",
                                        subtitle="Tệp hệ thống trở lại đúng lúc đó. Thư mục nhà và vault không bị đụng.")
                nut = Gtk.Button(label="Quay về", valign=Gtk.Align.CENTER, css_classes=["destructive-action"])
                nut.connect("clicked", self.hoi_undo, so, len(dong))
                nut_row.add_suffix(nut)
                row.add_row(nut_row)
                return False
            GLib.idle_add(ve)
        threading.Thread(target=worker, daemon=True).start()

    def hoi_undo(self, _nut, so, so_tep):
        hop = Adw.MessageDialog(
            transient_for=self, heading=f"Quay máy về ảnh #{so}?",
            body=f"{so_tep} tệp hệ thống sẽ trở lại như lúc đó. Máy tự chụp một ảnh mới TRƯỚC khi quay, "
                 "nên đổi ý vẫn quay ngược lại được.\n\nThư mục nhà, nhật ký, Docker, vault, Tailscale không bị đụng.")
        hop.add_response("thoi", "Thôi")
        hop.add_response("lam", "Quay về")
        hop.set_response_appearance("lam", Adw.ResponseAppearance.DESTRUCTIVE)
        hop.connect("response", lambda _d, tra: tra == "lam" and self.chay_nen(
            ("undo", so, "--yes"), True, f"Đã quay về ảnh #{so}", sau=self.nap_snapshot, timeout=600))
        hop.present()


class App(Adw.Application):
    """Một phiên duy nhất (application-id): Super+B hay autostart gọi lại thì chỉ đưa cửa sổ đang có lên trước.
    `--ban` (autostart sau đăng nhập, phím tắt) mở TO như một mặt tiền; mở từ trình đơn thì cỡ thường."""
    def __init__(self, ban=False):
        super().__init__(application_id="vn.axleos.Axle")
        self.ban = ban

    def do_activate(self):
        w = self.props.active_window or CuaSo(self)
        if self.ban and not getattr(w, "_da_mo_to", False):
            w._da_mo_to = True
            w.maximize()
        w.present()


if __name__ == "__main__":
    App(ban="--ban" in sys.argv[1:]).run(None)
