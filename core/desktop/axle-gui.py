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
import os
import pwd
import re
import subprocess
import sys
import tempfile
import threading

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk  # noqa: E402

AXLE = os.environ.get("AXLE_BIN", "/usr/local/bin/axle")
BAN_FILE = os.environ.get("AXLE_BAN_FILE", "/run/axle/ban.json")
AUDIT = os.environ.get("AXLE_AUDIT_FILE", os.path.expanduser("~/.local/state/axle/audit.jsonl"))
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


class CuaSo(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Bàn Axle", default_width=1000, default_height=740)
        self.toast = Adw.ToastOverlay()
        self.tabs = Adw.ViewStack()
        self.dang_lam = False        # đang chạy một việc "bảo Axle làm"
        self.co_cuoc = False         # đã có mạch hội thoại → lần sau nối tiếp (--tiep)
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
        noi_dung.set_content(self.tabs)

        chia = Adw.NavigationSplitView(
            sidebar=Adw.NavigationPage(child=ben, title="Axle"),
            content=Adw.NavigationPage(child=noi_dung, title="Axle"),
            min_sidebar_width=200, max_sidebar_width=240)
        self.toast.set_child(chia)
        self.set_content(self.toast)
        self.lam_moi()
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
        args = [AXLE, "claude", cau, "--dong"] + (["--tiep"] if self.co_cuoc else [])

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
        buf.insert(buf.get_end_iter(), chu)
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
        self.nut_moi.set_visible(False)
        self.ket_qua.get_buffer().set_text("")
        self.ket_qua_cuon.set_visible(False)
        self.lenh_trang_thai.set_label(LOI_DAN)

    # ---------- Máy ----------
    def trang_tong_quan(self):
        t = Trang("Máy", "computer-symbolic")
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

    def ghep(self, *_):
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
            for dong in p.stdout:
                d = dong.strip()
                if d.startswith("axle1:"):        # chuỗi ghép cặp thô, in ra ngay sau hình QR dạng chữ
                    GLib.idle_add(self.ve_qr, d)
                m = re.search(r"Mã đối chiếu:\s*(\d{3})\s*(\d{3})", d)
                if m:
                    GLib.idle_add(self.hien_sas, f"{m.group(1)} {m.group(2)}")
                m2 = re.search(r"axle app confirm (\S+)", d)
                if m2:
                    self.pending = m2.group(1)
            p.wait()
            if not self.pending:
                GLib.idle_add(self.ghep_loi, "Không có điện thoại nào quét mã (hết 10 phút)")

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
