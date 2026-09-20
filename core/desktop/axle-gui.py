#!/usr/bin/env python3
"""Cửa sổ "Axle" trên desktop — chỗ chủ máy nhìn thấy và bật/tắt Axle mà không cần biết một dòng lệnh nào.

Vì sao có file này: tới 20/9/2026 mọi sức mạnh của Axle đều nằm sau `sudo axle …`. Người cài xong mà không
có ai chỉ thì ngồi nhìn một bản Ubuntu đổi màu. Việc đáng làm không phải thêm tính năng, mà là đưa tính
năng đã có ra khỏi terminal.

Nguyên tắc:
  * Đọc trạng thái KHÔNG cần quyền root — mở app ra là thấy ngay, không hỏi mật khẩu.
  * Chỉ lúc ĐỔI thứ gì mới gọi `pkexec axle …` → hộp thoại mật khẩu chuẩn của hệ thống.
  * Mỗi công tắc kèm một câu nói rõ đánh đổi. Không có nút nào mà người dùng phải đoán nó làm gì.
"""
import os
import re
import subprocess
import tempfile
import threading

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk  # noqa: E402

AXLE = "/usr/local/bin/axle"


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


def mot_dong(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


class Trang(Adw.PreferencesPage):
    def __init__(self, tieu_de, icon):
        super().__init__(title=tieu_de, icon_name=icon)


class CuaSo(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Axle", default_width=640, default_height=720)
        self.toast = Adw.ToastOverlay()
        view = Adw.ToolbarView()
        self.tabs = Adw.ViewStack()
        chuyen = Adw.ViewSwitcher(stack=self.tabs, policy=Adw.ViewSwitcherPolicy.WIDE)
        dau = Adw.HeaderBar(title_widget=chuyen)   # giữ tham chiếu; ToolbarView không cho lấy lại thanh đã thêm
        view.add_top_bar(dau)
        view.set_content(self.tabs)
        self.toast.set_child(view)
        self.set_content(self.toast)

        # add_titled() KHÔNG nhận icon — dùng nó thì thanh chuyển tab hiện ô vuông rỗng thay cho biểu tượng
        self.tabs.add_titled_with_icon(self.trang_tong_quan(), "may", "Máy", "computer-symbolic")
        self.tabs.add_titled_with_icon(self.trang_dien_thoai(), "dt", "Điện thoại", "phone-symbolic")
        self.tabs.add_titled_with_icon(self.trang_tinh_nang(), "tn", "Tính năng", "preferences-system-symbolic")
        self.tabs.add_titled_with_icon(self.trang_quay_lai(), "ql", "Quay lại", "edit-undo-symbolic")
        self.lam_moi()

    def bao(self, chu):
        self.toast.add_toast(Adw.Toast(title=chu, timeout=4))

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
    def __init__(self):
        super().__init__(application_id="vn.axleos.Axle")

    def do_activate(self):
        (self.props.active_window or CuaSo(self)).present()


if __name__ == "__main__":
    App().run(None)
