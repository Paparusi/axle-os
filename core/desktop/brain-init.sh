#!/usr/bin/env bash
# Dựng Bộ não Axle (~/Axle/Brain) cho tài khoản đang chạy — theo khuôn brain của Bi: raw/ bất biến, wiki/ do Claude
# tự bảo trì, index.md luôn đọc đầu tiên, git giữ lịch sử mọi lần ghi. Chạy nhiều lần vô hại (chỉ tạo thứ còn thiếu).
#   brain-init.sh [thư mục]     (mặc định ~/Axle/Brain)
set -euo pipefail
B="${1:-${AXLE_BRAIN_DIR:-$HOME/Axle/Brain}}"
mkdir -p "$B/raw" "$B/wiki/sources" "$B/wiki/entities" "$B/wiki/projects" "$B/wiki/decisions" "$B/wiki/learnings" "$B/wiki/concepts"
chmod 0700 "$B"
[ -f "$B/QUY-UOC.md" ] || cat > "$B/QUY-UOC.md" <<'EOF'
# Bộ não Axle — quy ước (LUÔN đọc trước khi tra hay ghi)

Kho tri thức của chủ máy, do Claude trên máy (qua `axle claude` / Hỏi Axle) tự bảo trì. Người đọc được, sửa tay được,
git giữ lịch sử mọi lần ghi (mỗi lần ghi = một commit — quay lại được).

## Cấu trúc
```
Brain/
├── raw/                 # Nguồn gốc — BẤT BIẾN: tệp chủ gửi lên (ảnh, Excel, Word, PDF…) theo tháng raw/YYYY-MM/
│   └── <ts>-<tên>.doi/  # bản đã đổi sang dạng đọc được (CSV từng sheet, văn bản, PDF→txt) — máy tự tạo
├── raw/.index.jsonl     # máy ghi: mỗi tệp một dòng {sha, duong, ten, luc, thiet_bi, cau}
├── wiki/
│   ├── index.md         # DANH MỤC trang (LUÔN đọc đầu tiên khi tra)
│   ├── log.md           # dòng thời gian: ngày · việc · trang đã ghi
│   ├── sources/         # mỗi tài liệu một trang tóm tắt (ý chính, số liệu, thực thể, đường dẫn raw)
│   ├── entities/        # khách hàng, đối tác, người, công ty, thiết bị
│   ├── projects/        # dự án / mảng việc của chủ
│   ├── decisions/       # quyết định + lý do
│   ├── learnings/       # bài học, lỗi đã gặp
│   └── concepts/        # khái niệm, quy trình, cách làm
└── QUY-UOC.md           # tệp này
```

## Khuôn trang (YAML đầu trang)
```yaml
---
title: Tên trang
type: source | entity | project | decision | learning | concept
sources: [raw/2026-09/…, hoặc "hỏi 2026-09-21"]
related: [[trang-khac]]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: high | medium | low
---
```
Tên tệp: chữ thường không dấu, gạch nối (vd `wiki/sources/hop-dong-abc-2026-09.md`). Liên kết bằng `[[tên-trang]]`
(không kèm đường dẫn). Quan hệ ghi trong nội dung: `[[trang]] — depends_on | built_with | supersedes | contradicts |
related | caused | fixed_by`.

## 4 thao tác
**INGEST** (có tệp mới trong raw/): (1) đọc bản đã đổi, (2) tạo/cập nhật `wiki/sources/<slug>.md` — tóm tắt 3–8 câu,
ý chính, số liệu đáng nhớ, thực thể, đường dẫn raw, (3) cập nhật trang entity/project liên quan (tạo nếu chưa có),
(4) thêm dòng vào `index.md` đúng mục, (5) thêm dòng `log.md`, (6) kiểm [[link]] hỏng.
**QUERY** (chủ hỏi): đọc `index.md` → tìm trang liên quan → đọc trang, theo [[link]] → trả lời KÈM trích dẫn tên
trang/tệp → câu trả lời đáng giữ thì thành trang mới (comparison/learning).
**LINT**: link hỏng, trang mồ côi, trang mỏng (<3 câu), khái niệm được nhắc mà chưa có trang, nội dung cũ, mâu
thuẫn — sửa được thì sửa.
**LOG**: mọi lần ghi thêm một dòng `log.md`: `- YYYY-MM-DD HH:MM · <việc> · [[trang]]`.

## Công cụ (Claude trên máy)
`brain_index` (quy ước + danh mục) · `brain_tim` (tìm) · `brain_doc` (đọc) · `brain_tai_lieu` (tệp đã gửi) · `brain_ghi`
(ghi/nối trang wiki/*.md) · `brain_index_them` (đặt MỘT dòng trang vào đúng mục của index.md — dùng cái này, đừng nối tay)
· `brain_log` (một dòng nhật ký có giờ) · `brain_kiem` (kiểm định máy móc — LINT phải gọi trước).

## Luật
- Không sửa, không xoá gì trong `raw/`. Không ghi ngoài `wiki/`. Không chép bí mật (mật khẩu, token, số thẻ) vào wiki.
- Số liệu lấy từ tài liệu thì ghi kèm nguồn; suy đoán thì ghi `confidence: low`.
- Trả lời chủ bằng tiếng Việt; trang wiki cũng tiếng Việt, ngắn, có số.
EOF
[ -f "$B/wiki/index.md" ] || cat > "$B/wiki/index.md" <<'EOF'
# Danh mục Bộ não Axle

(Claude đặt dòng vào đúng mục bằng brain_index_them. Một dòng một trang: gạch đầu dòng, tên trang trong ngoặc vuông kép, gạch dài, một câu nói nó là gì.)

## Dự án / mảng việc

## Khách hàng, đối tác, thực thể

## Tài liệu (sources)

## Quyết định

## Bài học

## Khái niệm, quy trình
EOF
[ -f "$B/wiki/log.md" ] || printf '# Nhật ký Bộ não Axle\n\n' > "$B/wiki/log.md"
[ -f "$B/raw/.index.jsonl" ] || : > "$B/raw/.index.jsonl"
if [ ! -d "$B/.git" ] && command -v git >/dev/null; then
  git -C "$B" init -q
  git -C "$B" config user.name "Axle Brain"
  git -C "$B" config user.email "brain@axle.local"
  git -C "$B" add -A && git -C "$B" commit -qm "Dựng Bộ não Axle" || true
fi
echo "$B"
