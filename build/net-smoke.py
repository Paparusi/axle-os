#!/usr/bin/env python3
"""Thử `axle net kiem` (core/lib/kiem-mang.py): phần kết luận bằng dữ kiện giả cho từng kiểu hỏng đã gặp thật,
rồi chạy thật trên máy này một lần (không được nổ, phải ra một kết luận).
    python3 build/net-smoke.py
"""
import importlib.util
import json
import os
import subprocess
import sys

GOC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUONG = os.path.join(GOC, "core/lib/kiem-mang.py")
spec = importlib.util.spec_from_file_location("kiem_mang", DUONG)
km = importlib.util.module_from_spec(spec)
spec.loader.exec_module(km)

fail = 0


def ok(c, m):
    global fail
    print(f"  {'✓' if c else '✗'} {m}")
    if not c:
        fail += 1


def may(**doi):
    """Máy khoẻ (Desktop, NetworkManager) rồi đè từng dữ kiện để tạo ca hỏng."""
    sk = {"card": [{"ten": "enp34s0", "wifi": False, "tin_hieu": True, "trang_thai": "up"}],
          "mac": {"enp34s0": "34:5a:60:35:44:0b"},
          "ipv4": {"enp34s0": ["192.168.1.216/24"]}, "ipv6": {"enp34s0": ["2001:ee0:51f6:8f00::5/64"]},
          "gw": "192.168.1.1", "gw_dev": "enp34s0", "gw_ping": True, "gw_lang_gieng": "REACHABLE",
          "internet": True, "dns": True, "quan_ly": "nm",
          "ket_noi": {"enp34s0": {"trang_thai": "connected", "ten": "netplan-enp34s0"}},
          "xin_ipv4": {"enp34s0": "dhcp"},
          "ts": {"trang_thai": "Running", "online": True, "ip": "100.66.109.71"},
          "tram": {"url": "https://tram.example.com", "ok": True}}
    sk.update(doi)
    return sk


def trang_thai(kq):
    return {b["id"]: b["trang_thai"] for b in kq["buoc"]}


kq = km.ket_luan(may())
ok(kq["muc"] == "ok" and kq["tieu_de"] == "Mạng ổn" and "192.168.1.216/24" in kq["giai_thich"] and "100.66.109.71" in kq["giai_thich"],
   f"máy khoẻ → Mạng ổn ({kq['giai_thich']})")
ok(all(v == "ok" for v in trang_thai(kq).values()) and not kq["lenh"], "máy khoẻ: mọi bước ✓, không đưa lệnh sửa")

kq = km.ket_luan(may(card=[{"ten": "enp34s0", "wifi": False, "tin_hieu": False, "trang_thai": "down"}], ipv4={}, ipv6={}, gw=None,
                     gw_dev=None, internet=False, dns=False, ts={"trang_thai": "Running", "online": False, "ip": "100.66.109.71"},
                     tram={"url": "https://tram.example.com", "ok": False}))
ok(kq["muc"] == "loi" and kq["tieu_de"] == "Chưa có dây mạng hay Wi-Fi", "rút dây → Chưa có dây mạng hay Wi-Fi")
ok(set(list(trang_thai(kq).values())[1:]) == {"bo_qua"}, "rút dây: các bước sau ghi · (chưa xét), không ghi ✗")

# 24/9 máy nhà ở văn phòng: dây vào cổng WAN cục mesh → có tín hiệu, DHCP im lặng, chỉ có IPv6 link-local
kq = km.ket_luan(may(ipv4={}, ipv6={}, gw=None, gw_dev=None, internet=False, dns=False,
                     ket_noi={"enp34s0": {"trang_thai": "connecting (getting IP configuration)", "ten": "netplan-enp34s0"}},
                     ts={"trang_thai": "Running", "online": False, "ip": None}, tram={"url": "https://tram.example.com", "ok": False}))
ok(kq["tieu_de"] == "Dây có tín hiệu nhưng không router nào cấp IP" and "cổng WAN" in kq["giai_thich"],
   "24/9 cổng WAN mesh → không router nào cấp IP, nhắc cổng WAN")
ok(kq["lenh"] == ['sudo nmcli con up "netplan-enp34s0"'], f"… lệnh xin lại IP đúng tên kết nối ({kq['lenh']})")
ok(trang_thai(kq)["internet"] == "bo_qua" and trang_thai(kq)["dns"] == "bo_qua", "… Internet/DNS ghi · chứ không ✗")

# 22/9 máy bi: netplan thiếu dhcp4 → chỉ có IPv6 VNPT, bản Server (networkd)
kq = km.ket_luan(may(ipv4={}, gw=None, gw_dev=None, internet=False, dns=False, quan_ly="networkd", ket_noi={},
                     xin_ipv4={"enp34s0": "khong"}))
ok(kq["tieu_de"] == "Máy chưa bật xin địa chỉ IPv4" and "chỉ có IPv6" in kq["giai_thich"], "22/9 máy bi → chưa bật xin IPv4, nói rõ chỉ có IPv6")
ok(kq["lenh"] == ["sudo netplan set ethernets.enp34s0.dhcp4=true && sudo netplan apply"], f"… lệnh netplan đúng card ({kq['lenh']})")
ok("chỉ có IPv6 2001:ee0:51f6:8f00::5" in next(b["chi_tiet"] for b in kq["buoc"] if b["id"] == "ip"), "… bước IPv4 ghi địa chỉ IPv6 đang có")

# 24/9 lượt hai: đặt IP tĩnh .250 mà router không đáp ARP
kq = km.ket_luan(may(ipv4={"enp34s0": ["192.168.1.250/24"]}, gw_ping=False, gw_lang_gieng="INCOMPLETE", internet=False, dns=False,
                     ket_noi={"enp34s0": {"trang_thai": "connected", "ten": "vp"}}, xin_ipv4={"enp34s0": "tinh"},
                     ts={"trang_thai": "Running", "online": False, "ip": None}, tram={"url": "https://tram.example.com", "ok": False}))
ok(kq["tieu_de"] == "Không thấy router 192.168.1.1" and "INCOMPLETE" in next(b["chi_tiet"] for b in kq["buoc"] if b["id"] == "router"),
   "IP tĩnh + router không đáp (INCOMPLETE) → Không thấy router")
ok(len(kq["lenh"]) == 1 and 'ipv4.method auto ipv4.addresses ""' in kq["lenh"][0] and '"vp"' in kq["lenh"][0],
   "… IP tĩnh thì bảo về tự xin IP, xoá sạch địa chỉ tĩnh")
kq = km.ket_luan(may(gw_ping=False, gw_lang_gieng="STALE"))
ok(kq["muc"] == "ok", "router chặn ping nhưng có trong bảng láng giềng → vẫn tính là có router")

kq = km.ket_luan(may(internet=False, dns=False))
ok(kq["tieu_de"] == "Router có, nhưng không ra được Internet" and "34:5a:60:35:44:0b" in kq["giai_thich"],
   "router đáp mà không ra Internet → nói router mất mạng/chặn theo MAC, kèm MAC")

kq = km.ket_luan(may(dns=False))
ok(kq["tieu_de"].startswith("Ra Internet được nhưng không tra được tên miền") and 'ipv4.dns "1.1.1.1 8.8.8.8"' in kq["lenh"][0],
   "hỏng DNS → lệnh đổi DNS trên đúng kết nối NetworkManager")
kq = km.ket_luan(may(dns=False, quan_ly="networkd", ket_noi={}))
ok(kq["lenh"][0].startswith("sudo resolvectl dns enp34s0 1.1.1.1 8.8.8.8"), "hỏng DNS bản Server → resolvectl")

kq = km.ket_luan(may(ts={"trang_thai": "NeedsLogin", "online": False, "ip": None}))
ok(kq["muc"] == "canh_bao" and kq["lenh"] == ["axle net up"], "có mạng mà chưa vào Tailscale → cảnh báo + axle net up")
kq = km.ket_luan(may(tram={"url": "https://tram.example.com", "ok": False}))
ok(kq["muc"] == "canh_bao" and "tram.example.com" in kq["giai_thich"], "có mạng mà không tới trạm → cảnh báo, nêu tên trạm")
kq = km.ket_luan(may(ts=None, tram=None))
ok(kq["muc"] == "ok" and trang_thai(kq)["tailscale"] == "khong_ro" and trang_thai(kq)["tram"] == "khong_ro",
   "chưa cài Tailscale / chưa đặt trạm → không tính là hỏng")

kq = km.ket_luan(may(card=[{"ten": "wlp2s0", "wifi": True, "tin_hieu": True, "trang_thai": "up"}], gw_dev="wlp2s0",
                     ipv4={"wlp2s0": ["192.168.1.30/24"]}, ket_noi={}, xin_ipv4={}))
ok(kq["muc"] == "ok" and "(Wi-Fi)" in kq["buoc"][0]["chi_tiet"], "máy chạy Wi-Fi → nhận ra Wi-Fi")
kq = km.ket_luan({})
ok(kq["muc"] == "loi" and kq["tieu_de"] == "Máy không thấy card mạng nào", "dữ kiện rỗng → không nổ, báo không thấy card")

# Chạy thật trên máy này: không nổ, JSON đúng khuôn, mã thoát khớp mức
r = subprocess.run([sys.executable, DUONG, "--json"], capture_output=True, text=True, timeout=60)
try:
    that = json.loads(r.stdout)
except ValueError:
    that = None
ok(that is not None and that["muc"] in ("ok", "loi", "canh_bao") and len(that["buoc"]) == 7 and r.returncode == {"ok": 0, "loi": 1, "canh_bao": 2}[that["muc"]],
   f"chạy thật: {that and that['tieu_de']} · mã thoát {r.returncode}{' · ' + r.stderr.strip()[:200] if r.stderr.strip() else ''}")
r2 = subprocess.run([sys.executable, DUONG], capture_output=True, text=True, timeout=60)
ok(r2.stdout.startswith("Khám mạng ·") and "Dây / Wi-Fi" in r2.stdout and not r2.stderr.strip(), "chạy thật: bảng chữ in đủ, không lỗi ra stderr")

if fail:
    print(f"✗ {fail} mục hỏng")
    sys.exit(1)
print("✓ khám mạng đạt")
