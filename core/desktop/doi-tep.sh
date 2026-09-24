#!/usr/bin/env bash
# Đổi tệp đưa vào Bộ não (gửi từ điện thoại, hay từ Bàn / Files trên máy) sang dạng Claude ĐỌC ĐƯỢC. Công cụ Read đọc văn bản, PDF, ảnh — KHÔNG đọc
# được .xlsx/.docx nhị phân, nên máy đổi sẵn (chạy bằng tài khoản chủ, không cần Claude xin phép chạy lệnh):
#   Excel / ODS  → mỗi sheet một CSV (bộ lọc StarCalc, tham số cuối -1 = mọi sheet)
#   Word / ODT / RTF → .txt (UTF-8)          PowerPoint / ODP → PDF          PDF → .txt (pdftotext -layout, để tìm nhanh)
#   doi-tep.sh <tệp> <thư mục ra>   → in mỗi dòng một tệp kết quả; không đổi được thì im (Claude đọc bản gốc nếu được)
set -u
f="${1:?tệp}"; out="${2:?thư mục ra}"
mkdir -p "$out"
ext="${f##*.}"; ext="${ext,,}"
# Hồ sơ LibreOffice RIÊNG: dùng hồ sơ mặc định thì lúc chủ đang mở LibreOffice, soffice --convert-to chuyển việc cho
# cửa sổ đang mở rồi thoát → không ra tệp nào (Claude phải đọc .xlsx/.docx nhị phân). Hồ sơ riêng = tiến trình riêng.
HS="${AXLE_LO_PROFILE:-${XDG_CACHE_HOME:-$HOME/.cache}/axle/lo-doi-tep}"
mkdir -p "$HS" 2>/dev/null || HS="/tmp/axle-lo-$(id -u)"
lo() { timeout 90 soffice "-env:UserInstallation=file://$HS" --headless --norestore --convert-to "$1" --outdir "$out" "$f" >/dev/null 2>&1; }
case "$ext" in
  xlsx|xls|xlsm|ods) command -v soffice >/dev/null && lo 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1' ;;
  docx|doc|odt|rtf)  command -v soffice >/dev/null && lo 'txt:Text (encoded):UTF8' ;;
  pptx|ppt|odp)      command -v soffice >/dev/null && lo pdf ;;
  pdf)               command -v pdftotext >/dev/null && timeout 60 pdftotext -layout "$f" "$out/$(basename "${f%.*}").txt" >/dev/null 2>&1 ;;
esac
find "$out" -maxdepth 1 -type f -newer "$f" 2>/dev/null | sort
