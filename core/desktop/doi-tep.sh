#!/usr/bin/env bash
# Đổi tệp đính kèm (gửi từ điện thoại) sang dạng Claude ĐỌC ĐƯỢC. Công cụ Read đọc văn bản, PDF, ảnh — KHÔNG đọc
# được .xlsx/.docx nhị phân, nên máy đổi sẵn (chạy bằng tài khoản chủ, không cần Claude xin phép chạy lệnh):
#   Excel / ODS  → mỗi sheet một CSV (bộ lọc StarCalc, tham số cuối -1 = mọi sheet)
#   Word / ODT / RTF → .txt (UTF-8)          PowerPoint / ODP → PDF          PDF → .txt (pdftotext -layout, để tìm nhanh)
#   doi-tep.sh <tệp> <thư mục ra>   → in mỗi dòng một tệp kết quả; không đổi được thì im (Claude đọc bản gốc nếu được)
set -u
f="${1:?tệp}"; out="${2:?thư mục ra}"
mkdir -p "$out"
ext="${f##*.}"; ext="${ext,,}"
lo() { timeout 90 soffice --headless --norestore --convert-to "$1" --outdir "$out" "$f" >/dev/null 2>&1; }
case "$ext" in
  xlsx|xls|xlsm|ods) command -v soffice >/dev/null && lo 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1' ;;
  docx|doc|odt|rtf)  command -v soffice >/dev/null && lo 'txt:Text (encoded):UTF8' ;;
  pptx|ppt|odp)      command -v soffice >/dev/null && lo pdf ;;
  pdf)               command -v pdftotext >/dev/null && timeout 60 pdftotext -layout "$f" "$out/$(basename "${f%.*}").txt" >/dev/null 2>&1 ;;
esac
find "$out" -maxdepth 1 -type f -newer "$f" 2>/dev/null | sort
