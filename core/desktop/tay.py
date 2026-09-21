#!/usr/bin/env python3
"""`axle tay` — tay cho MỌI ứng dụng trên desktop, theo cây trợ năng (AT-SPI), không chụp ảnh, không bấm mò toạ độ.

Cùng ý với `web` (bảng phần tử đánh số của trang web qua Playwright) nhưng cho cả máy: LibreOffice, hộp thoại in,
chọn tệp, Cài đặt, cửa sổ Axle… — mọi cửa sổ GTK/GNOME/LibreOffice đều tự mô tả mình qua AT-SPI: vai trò + tên +
trạng thái của từng phần tử, và HÀNH ĐỘNG mà phần tử đó nhận (click, press, activate).

    axle tay cuaso                       cửa sổ nào đang mở (ứng dụng · tiêu đề · pid)
    axle tay chup [--cuaso N] [--loc CHỮ] [--sau D]
                                         bảng phần tử đánh số của cửa sổ đang có tiêu điểm (hay cửa sổ N)
    axle tay bam N                       làm hành động của phần tử N (click / press / activate…)
    axle tay go N "chữ"                  đặt chữ vào ô N rồi đọc lại kiểm tra
    axle tay doc N                       đọc chữ / giá trị của phần tử N
    axle tay chon N                      đưa tiêu điểm tới phần tử N
    axle tay mo <ứng dụng>               mở ứng dụng theo tên .desktop (vn.axleos.Axle, libreoffice-calc…) rồi chờ cửa sổ
    axle tay lam "chup" "go 3 abc" …     nhiều bước một tiến trình (mỗi tham số là một lệnh)

Luật: chỉ hành động QUA trợ năng — không ydotool, không tiêm phím lên màn hình chủ (docs/DESKTOP.md mục 3).
Phần tử nào không nhận hành động trợ năng thì nói thẳng, không đoán toạ độ.
Số thứ tự chỉ có nghĩa với bảng vừa chụp: bảng được lưu kèm ĐƯỜNG ĐI trong cây; lúc bấm, máy đi lại đường đó và
kiểm vai trò + tên còn khớp không — khớp mới làm, lệch thì báo "chụp lại".
"""
import json
import os
import subprocess
import sys
import time
import warnings

import gi

warnings.filterwarnings("ignore", category=DeprecationWarning)   # libatspi 2.52 đánh dấu get_text/get_action_name cũ; bản thay chưa có trong GI

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

BANG = os.path.expanduser("~/.cache/axle-tay/bang.json")
TOI_DA_NUT = 400           # phần tử tối đa trong một bảng (LibreOffice Calc có hàng nghìn ô)
TOI_DA_CON = 80            # con tối đa xét ở một nút (bảng lớn: chỉ 80 ô đầu)
SAU_MAC_DINH = 30

# Vai trò đáng đưa vào bảng (vai trò trợ năng → chữ ngắn tiếng Việt). Thứ khác chỉ là hộp chứa → đi xuyên.
VAI = {
    "push button": "nút", "toggle button": "nút bật/tắt", "button": "nút",
    "check box": "ô đánh dấu", "radio button": "nút chọn", "check menu item": "mục menu ✓", "radio menu item": "mục menu ○",
    "menu": "menu", "menu item": "mục menu", "menu bar": None,
    "combo box": "hộp chọn", "entry": "ô chữ", "text": "ô chữ", "password text": "ô mật khẩu",
    "spin button": "ô số", "slider": "thanh trượt", "scroll bar": None, "page tab": "thẻ", "page tab list": None,
    "list item": "dòng", "tree item": "dòng cây", "table cell": "ô bảng", "table column header": "đầu cột",
    "link": "liên kết", "label": "nhãn", "heading": "tiêu đề", "static": None, "image": None, "icon": None,
    "document text": "văn bản", "document frame": "văn bản", "paragraph": "đoạn", "table": "bảng",
    "dialog": "hộp thoại", "alert": "hộp thoại", "frame": "cửa sổ", "window": "cửa sổ", "file chooser": "chọn tệp",
    "color chooser": "chọn màu", "tool bar": None, "status bar": None, "list box": "danh sách", "list": "danh sách",
    "tree": "cây", "tree table": "bảng cây", "section": None, "panel": None, "filler": None, "scroll pane": None,
    "viewport": None, "layered pane": None, "root pane": None, "split pane": None, "canvas": None, "separator": None,
    "unknown": None, "invalid": None, "redundant object": None, "application": None, "embedded": None,
    "notification": "thông báo", "info bar": "thanh báo", "level bar": "mức", "progress bar": "tiến độ",
    "date editor": "ô ngày", "calendar": "lịch", "switch": "công tắc", "editbar": "ô chữ", "autocomplete": "ô chữ",
}
# Vai trò LUÔN có tên đáng đọc dù không "hành động" được (để agent biết đang ở màn nào)
CHI_DOC = {"nhãn", "tiêu đề", "đoạn", "văn bản", "thông báo", "thanh báo", "mức", "tiến độ", "hộp thoại", "cửa sổ", "chọn tệp"}


def loi(chu):
    print(f"✗ {chu}", file=sys.stderr)
    sys.exit(1)


def khoi_dong():
    """Nối vào bus trợ năng của phiên đang đăng nhập. Qua SSH thì không có DBUS_SESSION_BUS_ADDRESS —
    lấy bus mặc định của user (/run/user/<uid>/bus), Atspi tự hỏi org.a11y.Bus lấy địa chỉ bus trợ năng."""
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        bus = f"/run/user/{os.getuid()}/bus"
        if os.path.exists(bus):
            os.environ["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus}"
    if Atspi.init() != 0:
        loi("không nối được bus trợ năng (chưa đăng nhập giao diện, hay thiếu at-spi2-core)")
    Atspi.set_timeout(1500, 15000)       # ứng dụng treo thì 1,5 giây là bỏ, không treo theo


def an_toan(f, mac=None):
    try:
        return f()
    except Exception:            # ứng dụng vừa đóng, D-Bus hết giờ — coi như không có
        return mac


def trang_thai(acc):
    st = an_toan(acc.get_state_set)
    if st is None:
        return set()
    co = set()
    for ten, kind in (("hiện", Atspi.StateType.SHOWING), ("thấy", Atspi.StateType.VISIBLE), ("sống", Atspi.StateType.SENSITIVE),
                      ("tiêu điểm", Atspi.StateType.FOCUSED), ("✓", Atspi.StateType.CHECKED), ("chọn", Atspi.StateType.SELECTED),
                      ("mở", Atspi.StateType.EXPANDED), ("sửa được", Atspi.StateType.EDITABLE), ("hoạt động", Atspi.StateType.ACTIVE)):
        if st.contains(kind):
            co.add(ten)
    return co


def ten_cua(acc):
    return (an_toan(acc.get_name, "") or "").strip()


def vai_cua(acc):
    return (an_toan(acc.get_role_name, "") or "").strip()


# BẪY PyGObject: get_text_iface()/get_action_iface()… trả về CHÍNH đối tượng Accessible, nên `t.get_text(0, n)`
# bị trỏ vào Accessible.get_text (hàm cũ, 1 tham số) → TypeError → đọc ra rỗng (21/9 mất một giờ vì thế).
# Luôn gọi hàm của giao diện tường minh: Atspi.Text.get_text(acc, a, b).
def doc_chu(acc, dau=0, cuoi=-1):
    if "Text" not in (an_toan(acc.get_interfaces) or []):
        return None
    n = an_toan(lambda: Atspi.Text.get_character_count(acc), 0) or 0
    if cuoi < 0 or cuoi > n:
        cuoi = n
    return (an_toan(lambda: Atspi.Text.get_text(acc, dau, cuoi), "") or "") if n else ""


def chu_cua(acc, toi_da=80):
    """Chữ đang có trong phần tử (ô chữ, nhãn, ô bảng) hoặc giá trị số (ô số, thanh trượt)."""
    chu = doc_chu(acc, 0, toi_da + 1)
    if chu is not None:
        if not chu:
            return ""
        return chu.replace("\n", "⏎")[:toi_da] + ("…" if len(chu) > toi_da else "")
    if "Value" in (an_toan(acc.get_interfaces) or []):
        gt = an_toan(lambda: Atspi.Value.get_current_value(acc))
        if gt is not None:
            return f"{gt:g}"
    return ""


def hanh_dong(acc):
    if "Action" not in (an_toan(acc.get_interfaces) or []):
        return []
    n = an_toan(lambda: Atspi.Action.get_n_actions(acc), 0) or 0
    return [(an_toan(lambda i=i: Atspi.Action.get_action_name(acc, i), "") or "?") for i in range(n)]


# ---------- cửa sổ ----------
def cac_ung_dung():
    desk = Atspi.get_desktop(0)
    ra = []
    for i in range(an_toan(desk.get_child_count, 0) or 0):
        app = an_toan(lambda: desk.get_child_at_index(i))
        if app:
            ra.append(app)
    return ra


def cac_cua_so():
    """[(app, cửa sổ, chỉ số con trong app)] — chỉ cửa sổ đang HIỆN (SHOWING); cửa sổ có tiêu điểm lên đầu."""
    ra = []
    for app in cac_ung_dung():
        for j in range(an_toan(app.get_child_count, 0) or 0):
            w = an_toan(lambda: app.get_child_at_index(j))
            if not w:
                continue
            tt = trang_thai(w)
            if "hiện" not in tt and "hoạt động" not in tt:
                continue
            ra.append((app, w, j, tt))
    ra.sort(key=lambda x: ("hoạt động" not in x[3], ten_cua(x[0])))
    return ra


def lenh_cuaso():
    ds = cac_cua_so()
    if not ds:
        print("Không thấy cửa sổ nào (ứng dụng chưa bật trợ năng, hay chưa đăng nhập giao diện)")
        return
    for n, (app, w, _j, tt) in enumerate(ds, 1):
        dau = "▶" if "hoạt động" in tt else " "
        print(f"{dau}#{n}  {ten_cua(app) or '?':<22} \"{ten_cua(w)}\"  · {vai_cua(w)} · pid {an_toan(app.get_process_id, '?')}")


def chon_cua_so(so=None):
    ds = cac_cua_so()
    if not ds:
        loi("không thấy cửa sổ nào đang mở")
    if so is None:
        return ds[0]
    if not 1 <= so <= len(ds):
        loi(f"chỉ có {len(ds)} cửa sổ (xem: axle tay cuaso)")
    return ds[so - 1]


# ---------- bảng phần tử ----------
def duyet(goc, duong_goc, sau_toi_da):
    """Đi cây từ `goc`, trả [(đường đi, phần tử, vai VN, tên, chữ, trạng thái, hành động)] cho phần tử đáng liệt kê."""
    ra = []
    bo_sot = 0

    def di(acc, duong, sau, cha_vn="", cha_ten=""):
        nonlocal bo_sot
        if len(ra) >= TOI_DA_NUT:
            bo_sot += 1
            return
        vai = vai_cua(acc)
        tt = trang_thai(acc)
        vn = VAI.get(vai, "phần tử")
        if vai and "hiện" not in tt and "thấy" not in tt and vai not in ("application",):
            return                                   # phần tử ẩn (thẻ chưa mở, menu chưa xổ) — không liệt kê, không đi xuống
        ten = ten_cua(acc)
        hd = hanh_dong(acc)
        n = an_toan(acc.get_child_count, 0) or 0
        # Nhãn con của nút/dòng mang đúng chữ của cha (GTK đặt tên nút theo nhãn bên trong) → thừa, bỏ.
        # Ô lưới/dòng CHỨA con mà không có hành động (FlowBox, ListBox của GTK) chỉ là hộp gộp tên các con → bỏ, đi xuống.
        thua = (vn == "nhãn" and (ten == cha_ten or cha_vn in ("nút", "nút bật/tắt", "hộp chọn", "thẻ", "mục menu"))) \
            or (vn in ("ô bảng", "dòng", "dòng cây") and n > 0 and not hd)
        if vn and duong and not thua and (hd or ten or vn in CHI_DOC or "sửa được" in tt):
            ra.append((duong, acc, vn, ten, chu_cua(acc), tt, hd))
        if sau >= sau_toi_da:
            return
        if n > TOI_DA_CON:
            bo_sot += n - TOI_DA_CON
        for i in range(min(n, TOI_DA_CON)):
            con = an_toan(lambda: acc.get_child_at_index(i))
            if con:
                di(con, duong + [i], sau + 1, vn or cha_vn, ten or cha_ten)

    di(goc, duong_goc, 0)
    return ra, bo_sot


def lenh_chup(so=None, loc="", sau=SAU_MAC_DINH):
    app, w, j, tt = chon_cua_so(so)
    pid = an_toan(app.get_process_id, 0) or 0
    ds, bo_sot = duyet(w, [j], sau)
    print(f"Cửa sổ: \"{ten_cua(w)}\" · {ten_cua(app) or '?'} (pid {pid}) · {an_toan(app.get_toolkit_name, '?') or '?'}"
          + (" · đang có tiêu điểm" if "hoạt động" in tt else ""))
    bang = {"pid": pid, "app": ten_cua(app), "cua_so": ten_cua(w), "luc": time.time(), "muc": {}}
    dem = 0
    for duong, acc, vn, ten, chu, st, hd in ds:
        dem += 1
        bang["muc"][str(dem)] = {"duong": duong, "vai": vai_cua(acc), "ten": ten}
        if loc and loc.lower() not in (ten + " " + chu + " " + vn).lower():
            continue
        co = [x for x in ("tiêu điểm", "✓", "chọn", "mở") if x in st]
        if "sống" not in st and vn not in CHI_DOC:
            co.append("tắt")
        # Ô chữ trống thì đưa chữ gợi ý (placeholder) ra để biết ô đó để làm gì
        if vn in ("ô chữ", "ô mật khẩu", "ô số") and not ten and not chu:
            goi_y = (an_toan(acc.get_attributes) or {}).get("placeholder-text", "")
            phu = f"  (gợi ý: {goi_y[:60]})" if goi_y else ""
        else:
            phu = f" = \"{chu}\"" if chu and chu != ten and not ten.startswith(chu.rstrip("…")) else ""
        nhan = f"  [{', '.join(co)}]" if co else ""
        hanh = "" if (hd or vn in CHI_DOC) else "  (không có hành động)"
        print(f"#{dem:<4}{vn:<12} \"{ten}\"{phu}{nhan}{hanh}")
    os.makedirs(os.path.dirname(BANG), exist_ok=True)
    with open(BANG, "w", encoding="utf-8") as f:
        json.dump(bang, f, ensure_ascii=False)
    if bo_sot:
        print(f"… còn {bo_sot} phần tử không liệt kê (bảng to: dùng --loc CHỮ để tìm, hay --sau nhỏ hơn)")
    if dem == 0:
        print("(cửa sổ này không mô tả được gì qua trợ năng — ứng dụng chưa bật AT-SPI?)")


# ---------- tìm lại phần tử theo bảng ----------
def tim_lai(so):
    try:
        with open(BANG, encoding="utf-8") as f:
            bang = json.load(f)
    except (OSError, ValueError):
        loi("chưa có bảng nào — chụp trước: axle tay chup")
    m = bang["muc"].get(str(so))
    if not m:
        loi(f"bảng vừa chụp chỉ có {len(bang['muc'])} phần tử")
    if time.time() - bang.get("luc", 0) > 600:
        loi("bảng đã quá 10 phút — chụp lại: axle tay chup")
    app = next((a for a in cac_ung_dung() if (an_toan(a.get_process_id, 0) or 0) == bang["pid"]), None)
    if not app:
        loi(f"ứng dụng {bang['app']} (pid {bang['pid']}) không còn — chụp lại")
    acc = app
    for i in m["duong"]:
        acc = an_toan(lambda: acc.get_child_at_index(i))
        if not acc:
            loi(f"phần tử #{so} không còn ở chỗ cũ (màn hình đã đổi) — chụp lại: axle tay chup")
    if vai_cua(acc) != m["vai"] or ten_cua(acc) != m["ten"]:
        loi(f"phần tử #{so} giờ là {vai_cua(acc)} \"{ten_cua(acc)}\", không còn là {m['vai']} \"{m['ten']}\" — chụp lại")
    return acc, m


def lenh_bam(so):
    acc, m = tim_lai(so)
    hd = hanh_dong(acc)
    if "sống" not in trang_thai(acc):
        loi(f"#{so} {m['vai']} \"{m['ten']}\" đang tắt (không nhận thao tác)")
    if not hd:
        loi(f"#{so} {m['vai']} \"{m['ten']}\" không có hành động trợ năng nào — thử `chon {so}` để lấy tiêu điểm, hoặc dùng phần tử cha")
    # ưu tiên đúng "bấm"; còn lại lấy hành động đầu (menu: "click", thẻ: "activate", ô đánh dấu: "toggle")
    uu_tien = ["click", "press", "activate", "toggle", "select", "open", "expand"]
    i = next((k for u in uu_tien for k, h in enumerate(hd) if h.lower() == u), 0)
    ok = an_toan(lambda: Atspi.Action.do_action(acc, i), False)
    if not ok:
        loi(f"ứng dụng từ chối hành động '{hd[i]}' trên #{so} \"{m['ten']}\"")
    print(f"✓ {hd[i]} #{so} {VAI.get(m['vai'], m['vai'])} \"{m['ten']}\"")


def lenh_go(so, chu):
    acc, m = tim_lai(so)
    if "EditableText" not in (an_toan(acc.get_interfaces) or []):
        loi(f"#{so} {m['vai']} \"{m['ten']}\" không nhận chữ qua trợ năng (không phải ô nhập)")
    if "sống" not in trang_thai(acc):
        loi(f"#{so} \"{m['ten']}\" đang tắt")
    an_toan(lambda: Atspi.Component.grab_focus(acc))
    if not an_toan(lambda: Atspi.EditableText.set_text_contents(acc, chu), False):
        loi(f"ứng dụng từ chối đặt chữ vào #{so} \"{m['ten']}\"")
    time.sleep(0.15)
    lai = doc_chu(acc) or ""
    if lai != chu:                      # đọc lại phải ĐÚNG y chữ vừa đặt — rỗng cũng là hỏng
        loi(f"đặt xong nhưng đọc lại thấy \"{lai[:120]}\" chứ không phải \"{chu[:120]}\"")
    print(f"✓ gõ vào #{so} \"{m['ten']}\": \"{chu}\"")


def lenh_doc(so):
    acc, m = tim_lai(so)
    chu = doc_chu(acc)
    if chu is not None:
        print(chu)
        return
    if "Value" in (an_toan(acc.get_interfaces) or []):
        print(f"{an_toan(lambda: Atspi.Value.get_current_value(acc), 0):g}")
        return
    print(m["ten"])


def lenh_chon(so):
    acc, m = tim_lai(so)
    if not an_toan(lambda: Atspi.Component.grab_focus(acc), False):
        loi(f"không đưa được tiêu điểm tới #{so} \"{m['ten']}\"")
    print(f"✓ tiêu điểm ở #{so} \"{m['ten']}\"")


def lenh_mo(ten):
    """Mở theo tên .desktop (không cần .desktop ở cuối) rồi chờ tới 20 giây cho cửa sổ hiện."""
    ten = ten[:-8] if ten.endswith(".desktop") else ten
    if not all(ch.isalnum() or ch in "._-" for ch in ten):
        loi("tên ứng dụng chỉ gồm chữ, số, . _ -")
    truoc = {(an_toan(a.get_process_id, 0), ten_cua(w)) for a, w, _j, _t in cac_cua_so()}
    try:
        subprocess.Popen(["gtk-launch", ten], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        loi(f"không mở được {ten}: {e}")
    for _ in range(40):
        time.sleep(0.5)
        moi = [(a, w) for a, w, _j, _t in cac_cua_so() if (an_toan(a.get_process_id, 0), ten_cua(w)) not in truoc]
        if moi:
            a, w = moi[0]
            print(f"✓ mở {ten}: cửa sổ \"{ten_cua(w)}\" ({ten_cua(a)}, pid {an_toan(a.get_process_id, '?')}) — chụp: axle tay chup")
            return
    loi(f"đã gọi {ten} nhưng 20 giây chưa thấy cửa sổ mới")


# ---------- dòng lệnh ----------
def so_nguyen(chu, ten="số phần tử"):
    try:
        return int(chu)
    except (TypeError, ValueError):
        loi(f"{ten} phải là số (xem bảng: axle tay chup)")


def chay(args):
    if not args:
        print(__doc__.strip().split("\n\n")[1])
        return
    lenh, rest = args[0], args[1:]
    if lenh == "cuaso":
        lenh_cuaso()
    elif lenh == "chup":
        so, loc, sau = None, "", SAU_MAC_DINH
        i = 0
        while i < len(rest):
            if rest[i] == "--cuaso":
                so = so_nguyen(rest[i + 1] if i + 1 < len(rest) else None, "số cửa sổ"); i += 2
            elif rest[i] == "--loc":
                loc = rest[i + 1] if i + 1 < len(rest) else ""; i += 2
            elif rest[i] == "--sau":
                sau = so_nguyen(rest[i + 1] if i + 1 < len(rest) else None, "độ sâu"); i += 2
            else:
                loi(f"không hiểu {rest[i]}")
        lenh_chup(so, loc, sau)
    elif lenh == "bam":
        lenh_bam(so_nguyen(rest[0] if rest else None))
    elif lenh == "go":
        if len(rest) < 2:
            loi('axle tay go N "chữ"')
        lenh_go(so_nguyen(rest[0]), " ".join(rest[1:]))
    elif lenh == "doc":
        lenh_doc(so_nguyen(rest[0] if rest else None))
    elif lenh == "chon":
        lenh_chon(so_nguyen(rest[0] if rest else None))
    elif lenh == "mo":
        lenh_mo(rest[0] if rest else loi("axle tay mo <tên .desktop>"))
    elif lenh == "lam":
        import shlex
        for buoc in rest:
            print(f"› {buoc}")
            chay(shlex.split(buoc))
    else:
        loi(f"không có lệnh '{lenh}' — cuaso · chup · bam · go · doc · chon · mo · lam")


if __name__ == "__main__":
    khoi_dong()
    chay(sys.argv[1:])
