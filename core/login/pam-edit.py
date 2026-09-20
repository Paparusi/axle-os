#!/usr/bin/env python3
"""Gắn/gỡ dòng "duyệt đăng nhập bằng điện thoại" vào PAM của màn đăng nhập (docs/DESKTOP.md D5).

    pam-edit.py on|off|status <tệp pam>

Tách riêng khỏi `axle dangnhap` để thử được không cần máy thật: đây là chỗ nguy hiểm nhất của cả tính năng —
viết sai một chữ (`required` thay vì `sufficient`, hay chèn sai chỗ) là khoá chết máy, không ai đăng nhập được.

Luật bất di bất dịch:
  * LUÔN là `sufficient` — thất bại thì PAM chạy tiếp xuống mật khẩu.
  * Chèn NGAY TRƯỚC `@include common-auth`, để mấy lớp chặn trước đó (pam_nologin, chặn root) vẫn còn nguyên.
  * Không thấy `common-auth` thì KHÔNG sửa mò — thà không bật còn hơn hỏng file PAM.
"""
import sys

DAU = "pam-approve.mjs"
DONG = "auth\tsufficient\tpam_exec.so quiet /opt/axle/core/login/pam-approve.mjs"


def doc(f):
    with open(f, encoding="utf-8") as fh:
        return fh.read().splitlines()


def ghi(f, lines):
    with open(f, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def bat(f):
    src = doc(f)
    if any(DAU in l for l in src):
        return "đã gắn từ trước"
    for i, l in enumerate(src):
        if "common-auth" in l and not l.lstrip().startswith("#"):
            src.insert(i, DONG)
            ghi(f, src)
            return f"đã chèn vào dòng {i + 1}, ngay trước common-auth"
    raise SystemExit("✗ không thấy common-auth trong file PAM — không dám sửa mò")


def tat(f):
    src = doc(f)
    con = [l for l in src if DAU not in l]
    if len(con) == len(src):
        return "vốn không có gì để gỡ"
    ghi(f, con)
    return f"đã gỡ {len(src) - len(con)} dòng"


def trangthai(f):
    co = [f"{i + 1}: {l}" for i, l in enumerate(doc(f)) if DAU in l]
    return "\n".join(co) if co else ""


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("on", "off", "status"):
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    lenh, tep = sys.argv[1], sys.argv[2]
    if lenh == "status":
        ra = trangthai(tep)
        print(ra)
        sys.exit(0 if ra else 1)
    print(" ", (bat if lenh == "on" else tat)(tep))
