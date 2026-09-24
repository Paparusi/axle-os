#!/usr/bin/env python3
"""Axle tự khám mạng: chạy đúng mấy bước người ta hay bắt chủ máy gõ rồi chụp màn hình gửi đi, rồi nói thẳng lỗi nằm
ở đâu và sửa thế nào. Sinh ra từ ngày 24/9: mười mấy vòng ảnh chụp chỉ để ra được "dây cắm vào cổng WAN của cục mesh".
    axle net kiem            bảng từng bước + kết luận (không cần sudo, vài giây)
    axle net kiem --json     cho Bàn (và cho máy khác đọc)
Mã thoát: 0 mạng ổn · 1 hỏng (không ra được Internet) · 2 có Internet nhưng Tailscale/trạm của app có vấn đề.
thu_thap() đọc máy thật; ket_luan() là hàm thuần — build/net-smoke.py thử mọi kiểu hỏng bằng dữ kiện giả.
"""
import concurrent.futures as cf
import datetime
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request

# Card ảo không phải đường ra Internet: bỏ qua cả khi đếm card lẫn khi đếm địa chỉ
AO = ("lo", "docker", "veth", "br-", "virbr", "tailscale", "tun", "tap", "wg", "zt", "vnet", "lxc", "cni", "flannel")
# Router có mặt trong bảng láng giềng (kể cả khi nó chặn ping) — INCOMPLETE/FAILED là hỏi mà không ai đáp
CO_MAT = ("REACHABLE", "STALE", "DELAY", "PROBE", "PERMANENT")
KY = {"ok": "✓", "loi": "✗", "bo_qua": "·", "khong_ro": "–"}


def _chay(cmd, timeout=5):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.SubprocessError):
        return 127, ""


def _doc(p, mac=""):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return mac


def _ao(ten):
    return ten.startswith(AO)


def _tcp(host, port=443, t=3):
    try:
        with socket.create_connection((host, port), timeout=t):
            return True
    except OSError:
        return False


def _router(gw):
    rc, _ = _chay(["ping", "-c1", "-W1", gw], 3)
    _, ra = _chay(["ip", "neigh", "show", gw])
    m = re.search(r"\b(REACHABLE|STALE|DELAY|PROBE|PERMANENT|NOARP|INCOMPLETE|FAILED)\b", ra)
    return rc == 0, (m.group(1) if m else None)


def _tailscale():
    if not shutil.which("tailscale"):
        return None
    _, ra = _chay(["tailscale", "status", "--json"], 6)
    try:
        d = json.loads(ra)
    except ValueError:
        return {"trang_thai": "loi", "online": False, "ip": None}
    s = d.get("Self") or {}
    return {"trang_thai": d.get("BackendState"), "online": bool(s.get("Online")), "ip": (s.get("TailscaleIPs") or [None])[0]}


def _tram(app_json):
    try:
        with open(app_json, encoding="utf-8") as f:
            url = json.load(f).get("relay")
    except (OSError, ValueError, AttributeError):
        return None
    if not url:
        return None
    try:
        urllib.request.urlopen(url, timeout=6)
        ok = True
    except urllib.error.HTTPError:
        ok = True                     # trạm trả lời (401, 404…) nghĩa là tới được
    except (urllib.error.URLError, OSError, ValueError):
        ok = False
    return {"url": url, "ok": ok}


def _xin_ipv4(sk, nic):
    """Card này được cấu hình xin IPv4 thế nào: 'dhcp' · 'tinh' · 'khong' (không xin IPv4) · None (không rõ)."""
    if sk.get("quan_ly") == "nm":
        con = (sk["ket_noi"].get(nic) or {}).get("ten")
        if not con or con == "--":
            return None
        _, ra = _chay(["nmcli", "-g", "ipv4.method", "con", "show", con])
        return {"auto": "dhcp", "manual": "tinh", "disabled": "khong"}.get(ra.strip())
    if sk.get("quan_ly") == "networkd":
        txt = _doc(f"/run/systemd/network/10-netplan-{nic}.network")
        if not txt:
            return None
        if re.search(r"^DHCP=(yes|ipv4|true)\s*$", txt, re.M):
            return "dhcp"
        return "tinh" if re.search(r"^Address=\d", txt, re.M) else "khong"
    return None


def thu_thap(app_json="/etc/axle/app.json"):
    sk = {"card": [], "mac": {}, "ipv4": {}, "ipv6": {}, "gw": None, "gw_dev": None, "gw_ping": None, "gw_lang_gieng": None,
          "internet": None, "dns": None, "quan_ly": None, "ket_noi": {}, "xin_ipv4": {}, "ts": None, "tram": None}
    try:
        ds = sorted(os.listdir("/sys/class/net"))
    except OSError:
        ds = []
    for ten in ds:
        if _ao(ten):
            continue
        g = f"/sys/class/net/{ten}"
        wifi = os.path.isdir(f"{g}/wireless") or os.path.isdir(f"{g}/phy80211")
        if not wifi and not os.path.exists(f"{g}/device"):        # bridge, dummy… không phải card thật
            continue
        sk["card"].append({"ten": ten, "wifi": wifi, "tin_hieu": _doc(f"{g}/carrier", "0") == "1",
                           "trang_thai": _doc(f"{g}/operstate", "?")})
        sk["mac"][ten] = _doc(f"{g}/address")
    for ho, khoa in ((4, "ipv4"), (6, "ipv6")):
        _, ra = _chay(["ip", "-o", f"-{ho}", "addr", "show", "scope", "global"])
        for dong in ra.splitlines():
            f = dong.split()
            if len(f) >= 4 and not _ao(f[1]):
                sk[khoa].setdefault(f[1], []).append(f[3])
    _, ra = _chay(["ip", "-4", "route", "show", "default"])
    m = re.search(r"default via (\S+) dev (\S+)", ra)
    if m:
        sk["gw"], sk["gw_dev"] = m.group(1), m.group(2)
    # Ai quản mạng: NetworkManager (bản Desktop) hay systemd-networkd (bản Server) — lệnh sửa khác nhau
    if shutil.which("nmcli"):
        _, ra = _chay(["nmcli", "-t", "-f", "DEVICE,STATE,CONNECTION", "dev"])
        for dong in ra.splitlines():
            p = re.split(r"(?<!\\):", dong)
            if len(p) >= 3 and p[1] != "unmanaged":
                sk["ket_noi"][p[0]] = {"trang_thai": p[1], "ten": p[2].replace("\\:", ":")}
        if any(c["ten"] in sk["ket_noi"] for c in sk["card"]):
            sk["quan_ly"] = "nm"
    if not sk["quan_ly"] and shutil.which("networkctl"):
        sk["quan_ly"] = "networkd"
    for c in sk["card"]:
        sk["xin_ipv4"][c["ten"]] = _xin_ipv4(sk, c["ten"])
    # Phần cần mạng chạy song song: mạng chết thì phép nào cũng chờ tới hết hạn, nối đuôi nhau là cả chục giây
    with cf.ThreadPoolExecutor(max_workers=5) as ex:
        f_gw = ex.submit(_router, sk["gw"]) if sk["gw"] else None
        f_net = ex.submit(lambda: _tcp("1.1.1.1") or _tcp("8.8.8.8"))
        f_dns = ex.submit(lambda: _chay(["getent", "hosts", "github.com"], 6)[0] == 0)
        f_ts = ex.submit(_tailscale)
        f_tram = ex.submit(_tram, app_json)
        if f_gw:
            sk["gw_ping"], sk["gw_lang_gieng"] = f_gw.result()
        sk["internet"], sk["dns"], sk["ts"], sk["tram"] = f_net.result(), f_dns.result(), f_ts.result(), f_tram.result()
    return sk


# ---------- kết luận (hàm thuần) ----------

def _con(sk, nic):
    con = ((sk.get("ket_noi") or {}).get(nic) or {}).get("ten")
    return con if con and con != "--" else None


def _lenh_xin_lai(sk, nic):
    con = _con(sk, nic)
    if sk.get("quan_ly") == "nm" and con:
        return f'sudo nmcli con up "{con}"'
    if sk.get("quan_ly") == "networkd" and nic:
        return f"sudo networkctl renew {nic}"
    return None


def _lenh_bat_dhcp(sk, nic):
    con = _con(sk, nic)
    if sk.get("quan_ly") == "nm" and con:
        return f'sudo nmcli con mod "{con}" ipv4.method auto && sudo nmcli con up "{con}"'
    return f"sudo netplan set ethernets.{nic or '<card>'}.dhcp4=true && sudo netplan apply"


def _lenh_ve_dhcp(sk, nic):
    """Bỏ IP tĩnh, về tự xin IP — xoá luôn địa chỉ/gateway/DNS tĩnh kẻo netplan gộp lại (bài học 24/9)."""
    con = _con(sk, nic)
    if sk.get("quan_ly") == "nm" and con:
        return (f'sudo nmcli con mod "{con}" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" '
                f'&& sudo nmcli con up "{con}"')
    return f"sudo netplan set ethernets.{nic or '<card>'}.dhcp4=true && sudo netplan apply"


def _lenh_dns(sk, nic):
    con = _con(sk, nic)
    if sk.get("quan_ly") == "nm" and con:
        return f'sudo nmcli con mod "{con}" ipv4.dns "1.1.1.1 8.8.8.8" && sudo nmcli con up "{con}"'
    return f"sudo resolvectl dns {nic or '<card>'} 1.1.1.1 8.8.8.8   # tạm, tới lần khởi động sau"


def ket_luan(sk):
    """Dữ kiện → {muc: ok|loi|canh_bao, tieu_de, giai_thich, lenh[], buoc[]}. Kết luận theo bước hỏng ĐẦU TIÊN
    (dây → IPv4 → router → Internet → DNS → Tailscale → trạm); bước sau đó nếu hỏng thì ghi "·" (chưa xét được)
    chứ không ghi ✗, kẻo chủ tưởng hỏng một lúc năm chỗ."""
    card = sk.get("card") or []
    ipv4, ipv6 = sk.get("ipv4") or {}, sk.get("ipv6") or {}
    co_tin_hieu = [c for c in card if c.get("tin_hieu")]
    nic = sk.get("gw_dev") or next((k for k in ipv4 if any(c["ten"] == k for c in card)), None) \
        or (co_tin_hieu[0]["ten"] if co_tin_hieu else (card[0]["ten"] if card else None))
    dia_chi = (ipv4.get(nic) or next(iter(ipv4.values()), [None]))[0] if ipv4 else None
    xin = (sk.get("xin_ipv4") or {}).get(nic)
    gw = sk.get("gw")
    ts, tram = sk.get("ts"), sk.get("tram")
    buoc, hong = [], [None]

    def them(id_, ten, ok, chi_tiet_ok, chi_tiet_loi, khong_ro=None):
        if ok is None:
            buoc.append({"id": id_, "ten": ten, "trang_thai": "khong_ro", "chi_tiet": khong_ro or "không rõ"})
        elif ok:
            buoc.append({"id": id_, "ten": ten, "trang_thai": "ok", "chi_tiet": chi_tiet_ok})
        elif hong[0] is None:
            hong[0] = id_
            buoc.append({"id": id_, "ten": ten, "trang_thai": "loi", "chi_tiet": chi_tiet_loi})
        else:
            buoc.append({"id": id_, "ten": ten, "trang_thai": "bo_qua", "chi_tiet": "chưa xét được — bước trên đang hỏng"})

    c0 = co_tin_hieu[0] if co_tin_hieu else None
    them("day", "Dây / Wi-Fi", bool(co_tin_hieu),
         f"{c0['ten']} có tín hiệu ({'Wi-Fi' if c0 and c0.get('wifi') else 'dây'})" if c0 else "",
         "không thấy card mạng nào" if not card else "không card nào có tín hiệu (" + ", ".join(c["ten"] for c in card) + ")")
    v6 = next(iter(ipv6.values()), [None])[0] if ipv6 else None
    them("ip", "Địa chỉ IPv4", bool(ipv4), f"{dia_chi} ({nic})",
         "không có" + (f" — chỉ có IPv6 {v6.split('/')[0]}" if v6 else ""))
    router_ok = bool(gw) and (bool(sk.get("gw_ping")) or sk.get("gw_lang_gieng") in CO_MAT)
    them("router", "Router", router_ok, f"{gw} trả lời",
         "không có gateway (đường ra)" if not gw else f"{gw} không trả lời ({sk.get('gw_lang_gieng') or 'không có trong bảng láng giềng'})")
    them("internet", "Internet", sk.get("internet"), "tới được 1.1.1.1", "không tới được 1.1.1.1 và 8.8.8.8")
    them("dns", "Tên miền (DNS)", sk.get("dns"), "tra được github.com", "không tra được github.com")
    if ts is None:
        them("tailscale", "Tailscale", None, "", "", "chưa cài")
    else:
        them("tailscale", "Tailscale", ts.get("trang_thai") == "Running" and ts.get("online"),
             f"đang chạy · {ts.get('ip') or '?'}",
             {"NeedsLogin": "chưa đăng nhập", "NoState": "chưa đăng nhập", "Stopped": "đang tắt"}.get(ts.get("trang_thai"),
                                                                                                     "chưa nối được"))
    host = urllib.parse.urlparse(tram["url"]).hostname if tram else None
    them("tram", "Trạm (app điện thoại)", None if tram is None else tram.get("ok"), f"tới được {host}",
         f"không tới được {host}", "chưa đặt trạm (Bàn → Điện thoại)")

    muc, tieu_de, giai_thich, lenh = "ok", "Mạng ổn", "", []
    h = hong[0]
    if h == "day":
        muc = "loi"
        if not card:
            tieu_de, giai_thich = "Máy không thấy card mạng nào", "Hệ điều hành chưa nhận card mạng: thiếu driver hoặc card hỏng."
        else:
            tieu_de = "Chưa có dây mạng hay Wi-Fi"
            giai_thich = ("Không card nào có tín hiệu: dây chưa cắm chặt, dây hỏng, hoặc cổng bên kia đang tắt. "
                          "Cắm vào một cổng LAN của router (đèn ở cổng phải sáng), hoặc bắt Wi-Fi.")
    elif h == "ip":
        muc = "loi"
        if xin == "khong":
            tieu_de = "Máy chưa bật xin địa chỉ IPv4"
            giai_thich = ("Dây có tín hiệu nhưng cấu hình mạng không xin IPv4 (DHCP)"
                          + (". Máy chỉ có IPv6 do router tự phát, mà github.com và nhiều trang không có IPv6 nên như mất mạng."
                             if v6 else "."))
            lenh = [_lenh_bat_dhcp(sk, nic)]
        else:
            tieu_de = "Dây có tín hiệu nhưng không router nào cấp IP"
            giai_thich = ("Máy đã xin địa chỉ IP mà không ai trả lời. Hay gặp nhất: dây cắm nhầm cổng — ví dụ cổng WAN "
                          "của cục mesh hay router phụ — hoặc router không phát DHCP. Cắm sang một cổng LAN khác, hoặc mượn "
                          "dây đang chạy tốt của máy khác, rồi xin lại IP.")
            lenh = [x for x in [_lenh_xin_lai(sk, nic)] if x]
    elif h == "router":
        muc = "loi"
        if not gw:
            tieu_de = "Có địa chỉ IP nhưng không có đường ra"
            giai_thich = f"Máy có {dia_chi} mà không có gateway" + (" — IP tĩnh đang thiếu gateway." if xin == "tinh" else ".")
            lenh = [_lenh_ve_dhcp(sk, nic)] if xin == "tinh" else [x for x in [_lenh_xin_lai(sk, nic)] if x]
        else:
            tieu_de = f"Không thấy router {gw}"
            giai_thich = (f"Máy có {dia_chi} nhưng hỏi router {gw} không ai trả lời: dây đang ở sai đoạn mạng (cắm nhầm "
                          "cổng — ví dụ cổng WAN của cục mesh) hoặc router đang tắt"
                          + (", hoặc IP tĩnh đặt sai gateway. Thử cho máy về tự xin IP." if xin == "tinh" else
                             ". Kiểm đèn ở cổng router, thử cổng LAN khác hoặc dây đang chạy tốt của máy khác."))
            lenh = [_lenh_ve_dhcp(sk, nic)] if xin == "tinh" else []
    elif h == "internet":
        muc = "loi"
        tieu_de = "Router có, nhưng không ra được Internet"
        mac = (sk.get("mac") or {}).get(nic)
        giai_thich = (f"Router {gw} trả lời nhưng không tới được 1.1.1.1 hay 8.8.8.8: router đang mất Internet (xem đèn "
                      "Internet/PON trên modem), hoặc router chặn riêng máy này"
                      + (f" — lọc theo địa chỉ MAC {mac}." if mac else "."))
    elif h == "dns":
        muc = "loi"
        tieu_de = "Ra Internet được nhưng không tra được tên miền (DNS)"
        giai_thich = "Máy tới được Internet bằng địa chỉ số nhưng không đổi được tên như github.com ra địa chỉ. Đổi sang DNS công cộng:"
        lenh = [_lenh_dns(sk, nic)]
    elif h == "tailscale":
        muc = "canh_bao"
        tt = (ts or {}).get("trang_thai")
        if tt in ("NeedsLogin", "NoState"):
            tieu_de, lenh = "Có mạng, nhưng máy chưa vào Tailscale", ["axle net up"]
            giai_thich = "Chưa vào được máy này từ xa (SSH, Claude ở máy khác) cho tới khi đăng nhập Tailscale."
        elif tt == "Stopped":
            tieu_de, lenh = "Có mạng, nhưng Tailscale đang tắt", ["sudo tailscale up"]
            giai_thich = "Chưa vào được máy này từ xa cho tới khi bật lại."
        else:
            tieu_de, lenh = "Có mạng, nhưng Tailscale chưa nối được", ["sudo systemctl restart tailscaled"]
            giai_thich = "Tailscale đang chạy mà chưa nối được máy chủ điều phối. Thường tự hết sau vài chục giây."
    elif h == "tram":
        muc = "canh_bao"
        tieu_de = "Có mạng, nhưng không tới được trạm của app"
        giai_thich = (f"App điện thoại sẽ thấy máy mất kết nối. Trạm: {host}. Có thể trạm đang bảo trì; "
                      "nếu mạng văn phòng chặn thì hỏi người quản mạng.")
    else:
        giai_thich = f"IP {dia_chi} · router {gw} · Internet · DNS" + (
            f" · Tailscale {ts.get('ip')}" if ts and ts.get("trang_thai") == "Running" and ts.get("ip") else "")
    return {"muc": muc, "tieu_de": tieu_de, "giai_thich": giai_thich, "lenh": [x for x in lenh if x], "buoc": buoc,
            "card": nic}


def in_bang(kq, may, luc):
    print(f"Khám mạng · {may} · {luc}")
    rong = max(len(b["ten"]) for b in kq["buoc"])
    for b in kq["buoc"]:
        print(f"  {KY[b['trang_thai']]} {b['ten'].ljust(rong)}  {b['chi_tiet']}")
    print()
    print({"ok": "✓", "loi": "✗", "canh_bao": "!"}[kq["muc"]] + " " + kq["tieu_de"])
    if kq["giai_thich"] and kq["muc"] != "ok":
        print(textwrap.fill(kq["giai_thich"], width=100, initial_indent="  ", subsequent_indent="  "))
    elif kq["giai_thich"]:
        print("  " + kq["giai_thich"])
    for l in kq["lenh"]:
        print(f"  Thử:  {l}")


def main(argv):
    sk = thu_thap(os.environ.get("AXLE_APP_JSON", "/etc/axle/app.json"))
    kq = ket_luan(sk)
    luc = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    if "--json" in argv:
        print(json.dumps({**kq, "may": socket.gethostname(), "luc": luc, "su_kien": sk}, ensure_ascii=False))
    else:
        in_bang(kq, socket.gethostname(), luc[11:16])
    return {"ok": 0, "loi": 1, "canh_bao": 2}[kq["muc"]]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
