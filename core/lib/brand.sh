#!/usr/bin/env bash
# Nhận diện Axle ở tầng hệ thống. Dùng chung cho bản Server và lớp Desktop.

# Đổi tên hệ điều hành trong /etc/os-release (vốn là liên kết tới /usr/lib/os-release của Ubuntu).
# GIỮ NGUYÊN ID, VERSION_ID, VERSION_CODENAME: apt, PPA, kho Docker/Tailscale và phần mềm bên thứ ba
# đều dò theo mấy khoá đó — đổi là gãy kho gói. Chỉ đổi phần tên hiển thị cho người đọc.
#   brand_os_release [bản Axle]
brand_os_release() {
  local ver="${1:-$(cut -d' ' -f1 < /etc/axle/version 2>/dev/null || echo 0)}" base ubu
  base=/usr/lib/os-release
  [ -f "$base" ] || base=/etc/os-release
  [ -f "$base" ] || return 0
  ubu="$(. "$base" 2>/dev/null; echo "${PRETTY_NAME:-Ubuntu}")"
  { grep -vE '^(NAME|PRETTY_NAME|LOGO|ANSI_COLOR|HOME_URL|SUPPORT_URL|BUG_REPORT_URL|PRIVACY_POLICY_URL|AXLE_VERSION)=' "$base"
    cat <<EOF
NAME="Axle OS"
PRETTY_NAME="Axle OS $ver (dựa trên $ubu)"
LOGO=axle
ANSI_COLOR="1;34"
HOME_URL="https://github.com/Paparusi/axle-os"
SUPPORT_URL="https://github.com/Paparusi/axle-os"
BUG_REPORT_URL="https://github.com/Paparusi/axle-os/issues"
AXLE_VERSION="$ver"
EOF
  } > /etc/os-release.axle-new
  # /etc/os-release đang là liên kết → phải xoá rồi thay, chứ ghi đè là ghi thẳng vào tệp của Ubuntu
  rm -f /etc/os-release
  mv /etc/os-release.axle-new /etc/os-release
  chmod 0644 /etc/os-release
}
