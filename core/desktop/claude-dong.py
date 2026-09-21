#!/usr/bin/env python3
"""Lọc luồng `claude -p --output-format stream-json --verbose` thành chữ CHẢY cho Bàn và terminal: chữ trả lời hiện
ngay khi có, mỗi lần Claude dùng công cụ hiện một dòng "→ Read /etc/hostname"; suy nghĩ (thinking), kết quả công cụ,
đếm token thì bỏ. Kết thúc: "— xong (5,5 giây)" hoặc "✗ …". Không có cái này thì Bàn ngồi nhìn vòng quay tới khi
Claude làm xong cả việc (đo 21/9: một việc đọc log cũng 5–20 giây im lặng).

Định dạng bắt THẬT ngày 21/9/2026 (Claude Code 2.1.278), một sự kiện một dòng JSON:
  system{subtype: init | thinking_tokens} · assistant{message.content[ {type: thinking|text|tool_use} ]}
  · user{message.content[tool_result]} · rate_limit_event · result{is_error, duration_ms, result, permission_denials}
"""
import json
import sys


def tom_tat(inp):
    """Một mẩu đầu vào đáng nhìn của công cụ: lệnh, tệp, mẫu tìm, URL, app/nút (tay/web)…"""
    if not isinstance(inp, dict):
        return ""
    for k in ("command", "file_path", "path", "pattern", "url", "query", "app", "ten", "so", "phim", "cau_hoi", "prompt"):
        v = inp.get(k)
        if v not in (None, ""):
            v = str(v).replace("\n", " ")
            return v[:100] + ("…" if len(v) > 100 else "")
    return ""


def chay(vao=sys.stdin, ra=sys.stdout):
    for line in vao:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get("type")
        if t == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text" and c.get("text"):
                    ra.write(c["text"].rstrip() + "\n")
                elif c.get("type") == "tool_use":
                    ten = str(c.get("name", "?"))
                    if ten == "ToolSearch":            # cơ chế nội bộ của Claude Code (nạp mô tả công cụ) — không phải việc
                        continue
                    ten = ten.replace("mcp__axle__", "")
                    ra.write(f"→ {ten} {tom_tat(c.get('input'))}".rstrip() + "\n")
            ra.flush()
        elif t == "result":
            if e.get("is_error"):
                ra.write(f"✗ {str(e.get('result') or e.get('subtype') or 'lỗi')[:2000]}\n")
            else:
                giay = (e.get("duration_ms") or 0) / 1000
                ra.write(f"— xong ({giay:.1f} giây)\n".replace(".", ","))
            tu_choi = e.get("permission_denials") or []
            if tu_choi:
                ra.write(f"  ({len(tu_choi)} việc không được cấp quyền)\n")
            ra.flush()


if __name__ == "__main__":
    chay()
