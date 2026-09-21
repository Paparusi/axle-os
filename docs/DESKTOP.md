# Axle Desktop — thiết kế

Mục tiêu: máy để ngồi làm việc hằng ngày, và là chỗ **agent nhìn được màn hình và tự thao tác** — nhưng chủ máy
luôn thấy agent đang làm gì và cắt được bất cứ lúc nào.

## Nền

Axle Desktop = **Axle Server + lớp giao diện**, không phải hệ điều hành khác. Máy đang chạy Server nâng lên Desktop
bằng một lệnh (`sudo axle desktop on`), chụp bản btrfs trước nên hỏng thì `axle undo`. Mọi thứ của Server giữ nguyên:
cổng MCP, duyệt 4 bậc, vault, nhật ký lệnh, dừng khẩn cấp.

Đo trên Ubuntu 26.04 (máy thật axle-office, 20/9/2026):

| Gói | Bản trong kho chính thức | Ghi chú |
|---|---|---|
| `ubuntu-desktop-minimal` | 1.570.3 | GNOME 50 |
| `gnome-shell` / `gdm3` | 50.1 | **Chỉ còn Wayland** — `gnome-session-xsession` KHÔNG còn trong kho |
| `fcitx5` + `fcitx5-bamboo` | 5.1.19 + 1.0.9 | gõ tiếng Việt, không cần kho ngoài |
| `gnome-remote-desktop` | 50.2 | máy chủ RDP + chia sẻ màn hình |
| `xdg-desktop-portal-gnome`, `pipewire` | 50.0, 1.6.2 | cổng xin phép + luồng hình |
| `libreoffice-writer` | 26.2 | văn phòng tại chỗ |
| `kde-plasma-desktop`, `xfce4` | 5:166, 4.20.1 | phương án dự phòng (còn chạy X11) |
| `ydotool` | 1.0.4 | tiêm phím/chuột ở tầng nhân |

GNOME 50 bỏ hẳn phiên X11 → mọi cách "chụp màn hình + giả lập chuột" kiểu cũ (xdotool, scrot) **không dùng được**
trên màn hình thật. Đây là điều quyết định thiết kế bên dưới.

## Agent nhìn và điều khiển màn hình

Ba đường, Axle dùng cả ba nhưng cho việc khác nhau:

### 1. Màn hình RIÊNG của agent (mặc định) — ĐÃ LÀM (D2)

Agent phụ có sẵn tài khoản riêng trong hộp cát; `sudo axle agent screen <tên> on` thêm cho nó **một màn hình X ảo
riêng, không gắn màn hình thật** (Xvfb + openbox, dịch vụ `axle-display@<tên>`, chạy bằng chính user `ag-<tên>`).

- Agent **không thấy** màn hình của chủ: cửa sổ ngân hàng, tin nhắn, mật khẩu của chủ nằm ngoài tầm với.
- Chụp màn hình và bấm phím trong màn hình này không cần xin phép ai, vì đó là máy của chính agent → agent làm
  được việc thật mà không chạm vào đời sống riêng của chủ. Công cụ MCP: `screen_shot`, `screen_windows`,
  `screen_open`, `screen_click`, `screen_type`, `screen_key`, `screen_scroll`.
- Chủ xem được: `sudo axle agent screen <tên> anh` chụp lại màn hình của agent (xem trực tiếp: nhịp D2.1).

**Vì sao X11 (Xvfb) chứ không phải Wayland**: màn hình của agent là hộp cát riêng, ở đó *cần* chụp ảnh và tiêm
phím thoải mái — đúng thứ Wayland cố tình chặn. Xvfb + xdotool + ImageMagick chạy chắc, nhẹ, không cần portal.
Màn hình của chủ vẫn là Wayland như GNOME mặc định; hai đường không dính nhau.

**Ba cái chốt để màn hình riêng không thành cửa sau**:

1. **Không có cửa sổ dòng lệnh.** Agent chỉ mở được app trong danh sách chủ cho phép
   (`/etc/axle/screen-apps.json`: soạn thảo, tệp, văn bản, ảnh). Chạy lệnh vẫn phải qua `run_command` để chủ duyệt.
2. **App do dịch vụ màn hình mở, không phải agent.** Agent gửi *tên* app qua ống `~/.axle/screen-launch`; dịch vụ
   đọc danh sách cho phép rồi mới chạy. App nằm trong cgroup của màn hình nên không chết theo máy chủ MCP.
3. **Trình duyệt phải chủ nói rõ** (`--trinh-duyet`): có trình duyệt là agent nhìn thẳng ra internet, không đi qua
   vault và không vào nhật ký `http_request` nữa.

Vé vào màn hình là cookie trong `~/.Xauthority` (0600) của từng agent → agent này không ngó được màn hình agent kia.

### 2. Màn hình THẬT của chủ — chỉ khi chủ cho phép từng lần

Dùng **xdg-desktop-portal** (`RemoteDesktop` + `ScreenCast`): GNOME hiện hộp thoại xin phép của hệ thống, chủ chọn
màn hình/cửa sổ được chia sẻ. Axle coi đây là **bậc 3**: phải duyệt trên điện thoại (Face ID), cấp có hạn giờ
(`axle agent grant <tên> man-hinh --han 30m`), hiện thanh "agent đang xem màn hình" và `axle agent stop` cắt ngay.

Không dùng D-Bus riêng của Mutter (`org.gnome.Mutter.RemoteDesktop`) để lách hộp thoại xin phép: lách được một lần
là mất luôn thứ khiến người ta dám cài Axle.

### 3. Tiêm phím/chuột ở tầng nhân (`ydotool`/uinput)

Không qua compositor nên không xin phép được và **không** chụp được màn hình. Chỉ cho phép **trong màn hình riêng
của agent** (mục 1) khi cần gõ vào phần mềm không nhận sự kiện của portal. Không bao giờ bật trên màn hình chủ.

## Nhận diện (dùng bộ của Bi trong `branding/`)

Màn khởi động (Plymouth) logo Axle · GDM nền tối + logo · hình nền · màu nhấn Axle Blue `#3B82F6` · thanh dock.
Ghi rõ "dựa trên Ubuntu" ở màn giới thiệu; không dùng logo Ubuntu làm nhận diện của Axle.

## Nhịp làm

- **D1 ✔** Lớp Desktop: `sudo axle desktop on` — GNOME + gõ tiếng Việt (IBus Unikey, Telex) + nhận diện + LibreOffice.
  Thử trên máy ảo: cài xong chụp màn hình thật bằng QEMU để nhìn tận mắt.
  Bài học: đổi ảnh nền thôi thì **vẫn ra Ubuntu**. Phải đụng thêm: `/etc/os-release` (tệp thật, giữ `ID=ubuntu`),
  tắt `gnome-initial-setup-{first,upgrade}-login` (cửa sổ chào mừng Ubuntu phủ kín màn hình lần đăng nhập đầu),
  icon `hicolor/*/apps/axle.png` cho màn "Giới thiệu", và `view-app-grid-ubuntu-symbolic` (logo Ubuntu ở nút
  "Hiện ứng dụng") — chặn bằng `dpkg-divert` để nâng cấp gói không ghi đè lại.
- **D2 ✔** Màn hình riêng của agent: Xvfb + openbox cho từng agent phụ (`axle agent screen`), 7 công cụ MCP
  `screen_*`, ống mở app có danh sách trắng. Còn nợ (D2.1): xem trực tiếp màn hình agent (VNC tại chỗ) thay vì
  chỉ chụp ảnh.
- **D3 ✔** Chia sẻ màn hình thật qua portal. Bốn lớp chặn, mất bất kỳ lớp nào là agent không thấy gì:
  1. **Quyền có hạn giờ** (`grants/<tên>.json` → `screen.until`) — không có kiểu cấp vĩnh viễn.
  2. **Duyệt bậc 3** trên điện thoại (Face ID) hoặc `sudo axle duyet` tại máy; luôn hỏi từng lần, không nhớ.
  3. **Hộp thoại của GNOME** — chủ chọn màn hình; không đi D-Bus riêng của Mutter để lách.
  4. **Màn hình khoá thì không chụp** (hỏi `org.gnome.ScreenSaver`), và GNOME giữ biểu tượng "đang chia sẻ".
  Bộ phận: `core/desktop/portal/` (thư viện + dịch vụ chạy trong phiên của chủ), đường `/screen/shot` trong
  dịch vụ duyệt (root, nơi kiểm quyền), công cụ MCP `owner_screen_shot`, `build/owner-screen-smoke.mjs` 8/8.
  Còn nợ: agent BẤM vào màn hình chủ (RemoteDesktop) — chưa làm, và sẽ là quyền riêng chứ không đi kèm quyền xem.
  Đường đi đã chốt: dịch vụ `axle-portal` chạy TRONG phiên của chủ (`systemd --user`, không phải root) gọi
  `org.freedesktop.portal.RemoteDesktop`: CreateSession → SelectDevices → SelectSources → Start (GNOME hiện hộp
  thoại xin phép, chủ chọn màn hình/cửa sổ) → OpenPipeWireRemote lấy fd hình; ảnh lấy qua `pipewiresrc` của
  GStreamer, phím/chuột qua `NotifyPointerMotionAbsolute` / `NotifyKeyboardKeysym`. Gói cần:
  `xdg-desktop-portal-gnome`, `gstreamer1.0-pipewire`, `python3-gi`. Thứ tự duyệt: điện thoại (bậc 3, có hạn giờ)
  TRƯỚC, rồi mới tới hộp thoại của GNOME — hai lớp, không lớp nào thay được lớp nào.
- **D4** ISO Desktop công khai: **một ISO, hai mục cài**. Mục "Cài Axle Desktop" thêm `axle.edition=desktop`
  vào dòng lệnh nhân của trình cài → late-command ghi `/etc/axle/edition` sang máy đích → `axle-firstboot`
  cài Axle từ gói trong ISO rồi chạy luôn `axle desktop on`, xong tự khởi động lại vào màn đăng nhập.
  ISO không to thêm; đổi lại lần khởi động đầu cần mạng và lâu hơn 10–25 phút. Mất mạng giữa chừng thì
  vẫn còn một máy chủ Axle chạy được, firstboot giữ lại để thử tiếp lần sau.
  Còn nợ: driver GPU/Wi-Fi, đo RAM thật (máy văn phòng 5 GB chạy GNOME có đủ không).

## Phong cách (Bi 20/9: "tinh chỉnh lại phong cách như Mac")

Chỉ dùng thứ GNOME có sẵn — KHÔNG tải theme ngoài, KHÔNG nhái icon/phông của Apple. Tất cả là **mặc định
hệ thống** (dconf), người dùng đổi lại trong Cài đặt là xong:

| | Ubuntu mặc định | Axle |
|---|---|---|
| Thanh ứng dụng | dọc bên trái, luôn hiện | dưới đáy, co giữa, tự ẩn khi cửa sổ chạm (intellihide) |
| Nút cửa sổ | bên phải | bên trái (đóng · thu nhỏ · phóng to) |
| Màn hình nền | Home + Thùng rác | để trống |
| Chữ | Ubuntu Sans | Inter (phông nhận diện Axle, có sẵn trong kho) |
| Software Updater | tự nhảy lên | tắt (dpkg-divert + `Hidden=true`); bản vá bảo mật vẫn tự cài |

Hai thứ **không** làm được sạch sẽ trên GNOME Wayland: thanh menu chung của app ở đỉnh màn hình, và đồng hồ
dồn sang góc phải — cả hai đều cần tiện ích ngoài kho.

## Đăng nhập bằng điện thoại (nhịp D5)

Bi hỏi 20/9: *"sao không cho xác nhận đăng nhập qua app"*. Máy đã có sẵn đường duyệt bậc 3 qua điện thoại
(Face ID) cho mấy việc như xem màn hình hay undo hệ thống — đăng nhập chỉ là thêm một loại yêu cầu nữa.

```
sudo axle dangnhap on      # gắn vào màn đăng nhập
axle dangnhap status
sudo axle dangnhap off     # gỡ, quay lại gõ mật khẩu
```

Ngồi xuống máy, bấm vào tên mình → điện thoại đổ chuông *"ĐĂNG NHẬP vào máy bằng tài khoản admin_1
(/dev/tty1)"* → chạm duyệt là vào, **không gõ mật khẩu**.

**Vì sao không khoá chết máy được.** Dòng gắn vào PAM là `sufficient`, không phải `required`:

| Chuyện xảy ra | Kết quả |
|---|---|
| Chủ chạm duyệt | vào thẳng |
| Chủ bấm từ chối | hiện ô mật khẩu như cũ |
| Không ai chạm (25 giây) | hiện ô mật khẩu như cũ |
| Điện thoại hết pin, mất mạng, bộ duyệt chết | hiện ô mật khẩu **ngay** (không chờ) |
| Script hỏng, thiếu node, sai cú pháp | hiện ô mật khẩu như cũ |

Chèn **ngay trước `@include common-auth`**, nên `pam_nologin` và lớp chặn root vẫn nguyên. File PAM nào
không có `common-auth` thì `pam-edit.py` **từ chối sửa** thay vì đoán — thà không bật còn hơn hỏng file PAM.

**Bốn cổng chặn** (`core/login/pam-approve.mjs`): chỉ `PAM_TYPE=auth`; chỉ dịch vụ `gdm-password` (không
sshd, không sudo); không có `PAM_RHOST` (không phải máy khác gọi vào); chỉ tài khoản chủ máy (không root,
không tài khoản agent). Thêm van chống dội chuông: tối đa 3 lần hỏi trong 1 phút — người lạ ngồi trước máy
không bấm gọi điện thoại liên tục được.

Bậc 3 và **không bao giờ nhớ**: không có nút "1 giờ" hay "luôn việc này", vì người xin chưa chứng minh được
mình là ai.

**Đổi lại:** vào bằng điện thoại thì GNOME keyring không tự mở (nó mở bằng chính mật khẩu đăng nhập), nên
lần đầu dùng Wi-Fi đã lưu hay mật khẩu trong trình duyệt, GNOME sẽ hỏi mật khẩu một lần.

Thử: `node build/login-approve-smoke.mjs` (18 mục, không cần máy ảo — dựng bộ duyệt giả trên unix socket).

## Claude trên máy, cổng là điện thoại (nhịp D6)

Bi chọn hướng **C** (20/9): Claude chạy trên máy có tay chân thật. Cách làm cho đúng là **cầu xin phép**:

```
axle claude "log worker tối qua có lỗi gì, sửa giúp"
axle claude "tiếp đi" --tiep
```

Bên dưới là `claude -p … --mcp-config <axle> --permission-prompt-tool mcp__axle__duyet_quyen`:

| Việc | Chuyện gì xảy ra |
|---|---|
| Đọc, tìm, xem log, tra web | chạy thẳng — không hỏi, không thì chủ bị dội chuông |
| Ghi tệp, chạy lệnh, xoá | Claude gọi `duyet_quyen` → **điện thoại rung** → chủ duyệt mới làm |
| Lệnh nguy hiểm (`sudo`, `rm -r`, `mkfs`, ghi vào `/etc`, đụng vault) | **bậc 3**: luôn hỏi, không có nút "nhớ" |
| Bị từ chối / hết 10 phút | Claude nhận `deny` kèm lý do, và được dặn **không thử lại bằng cách khác** |

Bậc 2 nhớ được: **"1 giờ"** = cùng công cụ trong cùng thư mục; **"Luôn việc này"** = đúng lệnh (Bash) hoặc đúng
tệp (Edit/Write). Luật nằm chung `/luat`, `/quen` với mọi loại việc khác.

Hợp đồng với Claude Code (đọc từ chính bản cài, không đoán): vào `{tool_name, input, permission_suggestions?}`,
ra `{"behavior":"allow","updatedInput":…}` hoặc `{"behavior":"deny","message":…}`. Nhật ký duyệt ghi
`Agent: ssh:claude`. Bài thử: `node approve/test-rules.mjs` (9 ca cho `claude_tool`).

Chưa làm: Claude Code trên máy còn phải **đăng nhập OAuth một lần** (`~/.local/bin/claude`, chọn Claude
account) — việc của chủ máy, không tự làm hộ được.

## Bàn Axle làm mặt tiền (nhịp D7)

Bi (21/9): *"hiện tại thì Axle không khác gì Ubuntu cho lắm, t muốn có sự khác biệt hoàn toàn"*. Khác biệt không
nằm ở kernel hay desktop — iPhone chạy Darwin, Android chạy Linux — mà ở **mô hình dùng máy**: Ubuntu là máy cho
người dùng, Axle là máy cho **agent làm việc, người làm chủ**. Hai hàng đầu của mô hình đó là thứ người ta nhìn
thấy trong 5 phút đầu, và tới 21/9 Axle chưa có: mặt tiền và tay cho ứng dụng. D7 làm hàng thứ nhất.

**Đăng nhập xong là vào Bàn** (cửa sổ Axle mở to, mục Bàn), không rơi vào màn hình nền trống:

| Vùng | Trả lời câu | Lấy từ đâu (không root, không sudo) |
|---|---|---|
| Bảo Axle làm | "làm việc này giúp" bằng tiếng Việt | `axle claude "…"` (D6): đọc thì làm ngay, ghi/chạy/xoá thì xin phép; hỏi tiếp nối mạch (`--tiep`), "Cuộc mới" để quên |
| Cần bạn | có gì đang chờ mình | `/run/axle/ban.json` — **bộ duyệt tự công bố** (root:chủ 0640) mỗi khi trạng thái đổi; nút Lần này / 1 giờ / Luôn / Từ chối → `pkexec axle duyet <id> <d>` (hộp mật khẩu hệ thống, cùng đường với `sudo axle duyet`) |
| Đang làm | máy có agent nào, đang gọi gì | `ban.json` (agent, tạm dừng) + `~/.local/state/axle/audit.jsonl` của trợ lý chính |
| Hôm nay | hôm nay máy đã làm gì | `ban.json` (số duyệt, cùng cách đếm với tin tóm tắt tối) + audit + uptime |

Ubuntu-desktop vẫn ở ngay dưới: nút **"Chế độ tay"** thu Bàn xuống để tự tay làm Excel, in ấn; **Super+B** gọi
Bàn về (cửa sổ một phiên: gọi lại chỉ đưa lên trước). Autostart hệ thống `/etc/xdg/autostart/vn.axleos.Ban.desktop`,
phím tắt là custom-keybinding trong dconf mặc định (`99-axle`).

**Vì sao công bố ra tệp thay vì thêm một cửa hẹp sudo:** Bàn hỏi "việc đang chờ" mỗi 5–10 giây; đi qua `sudo -n`
là ~17.000 dòng nhật ký sudo một ngày, và mỗi cửa hẹp là thêm một chỗ phải canh. Tệp chỉ đọc, đường *duyệt* vẫn
chỉ có socket quản trị root 0600 và điện thoại. Bàn theo dõi tệp (GFileMonitor) nên đổi là thấy ngay.

**`axle update` giờ làm mới cả lớp giao diện** (`AXLE_DESKTOP_REFRESH=1 provision-desktop.sh`: chỉ chép tệp, ghi
mặc định, không tải gói) — trước đó update chỉ chạy provision.sh nên máy có giao diện giữ cửa sổ Axle cũ mãi.

Thử không cần máy ảo: `python3 build/gui-shot.py out/ban.png --ban` mở cửa sổ với dữ liệu giả (2 việc chờ, 2 agent,
vài lần gọi công cụ) rồi tự vẽ ra PNG để nhìn bố cục; `python3 build/gui-logic-smoke.py` thử phần thuần (đọc
ban.json hỏng/thiếu, tóm tắt tin xin duyệt, đếm audit, gợi ý lỗi đăng nhập Claude).

Chưa làm (nhịp sau): tay cho mọi ứng dụng qua cây trợ năng AT-SPI (`axle tay`) — hàng thứ hai của mô hình.

## Tay cho mọi ứng dụng — `axle tay` (nhịp D8)

Hàng thứ hai của mô hình "agent làm việc, người làm chủ": **ứng dụng là công cụ có tay**, không phải đích đến để
người bấm. `web` (D6) đã làm việc đó cho trang web bằng Playwright; `tay` làm cho *cả desktop* bằng cây trợ năng
AT-SPI — thứ mà GTK4, GNOME, LibreOffice, hộp thoại in/chọn tệp đều tự khai: vai trò + tên + trạng thái của từng
phần tử, và hành động phần tử đó nhận.

```
axle tay cuaso                 ▶#1  libreoffice  "Bảng lương T9.ods — LibreOffice Calc" · frame · pid 4211
axle tay chup --loc "Lưu"      #37  nút  "Lưu"
axle tay bam 37                ✓ click #37 nút "Lưu"
axle tay go 12 "500000"        ✓ gõ vào #12 "B4": "500000"     (đọc lại kiểm tra)
axle tay mo libreoffice-calc   ✓ mở …: cửa sổ "Không tên 1 — LibreOffice Calc"
```

**Ba luật:**
1. **Chỉ hành động qua trợ năng** (Action `click/press/activate/toggle`, EditableText, lấy tiêu điểm). Không
   ydotool, không tiêm phím lên màn hình chủ — đúng mục 3 ở trên. Phần tử không nhận hành động thì máy nói thẳng
   `(không có hành động)`, không đoán toạ độ.
2. **Số chỉ có nghĩa với bảng vừa chụp**: bảng lưu kèm *đường đi trong cây* (`~/.cache/axle-tay/bang.json`); lúc
   bấm, đi lại đường đó và kiểm vai trò + tên còn khớp mới làm — lệch là "chụp lại", hết 10 phút cũng "chụp lại".
3. **Bảng gọn**: bỏ phần tử ẩn (thẻ chưa mở, menu chưa xổ), bỏ nhãn con lặp tên nút, ≤400 phần tử / ≤80 con mỗi
   nút (Calc có hàng nghìn ô: dùng `--loc`), ô trống hiện chữ gợi ý.

**Ai dùng được:** trợ lý chính chạy bằng tài khoản chủ (`axle claude`, MCP `tay_*` — đọc thì tự do, bấm/gõ/mở đi
qua cầu xin phép D6). Qua SSH cũng chạy: `tay` tự lấy bus phiên `/run/user/<uid>/bus`. Agent phụ trong hộp cát có
màn X riêng nhưng *chưa* có bus trợ năng → chưa đăng ký, nhịp sau (chạy `at-spi-bus-launcher` trong
`axle-display@`). Mặc định dconf `toolkit-accessibility=true` để Chromium/LibreOffice cũng khai cây.

**Đã thử thật** (`build/tay-smoke.sh`, không cần máy ảo): dựng phiên D-Bus riêng + bus trợ năng, mở chính cửa sổ
Bàn, `cuaso` thấy "Bàn Axle", `chup` ra nút "Làm"/"Chế độ tay"/ô nhập/nút duyệt "Lần này", `go` đặt chữ vào ô
"Bảo Axle làm" qua EditableText rồi `doc` đọc lại đúng, `bam` bấm nút qua Action, số ngoài bảng → báo rõ.

Chưa làm: Chromium qua AT-SPI (đã có `web` tốt hơn), gõ phím tổ hợp (không có đường trợ năng — cố ý), tay cho
agent phụ.

## Sổ + nhãn cho phản xạ (nhịp D9)

Hàng thứ tư và thứ năm của mô hình: **máy có ký ức** và **máy có phản xạ**. Ubuntu không bao giờ kể nó đã làm
gì; Axle thì mọi việc agent xin và chủ quyết đều có dòng ghi — và đó cũng chính là dữ liệu để máy học tay chủ.

**Sổ** (mục thứ hai trong cửa sổ Axle, nút "Xem sổ" trên Bàn): tóm tắt hôm nay (một nguồn, cùng số với Bàn),
"Việc đã hỏi bạn" (~40 việc gần nhất: ai xin · việc gì · chủ quyết ra sao — lần này / 1 giờ / luôn / từ chối,
qua app hay tại máy · kết quả), "Công cụ trợ lý chính đã gọi" (30 lần gần nhất), và chỉ sang mục Quay lại cho ảnh
hệ thống. Nguồn: bộ duyệt công bố thêm `so` vào `/run/axle/ban.json` (gộp đuôi nhật ký `approvals.jsonl` theo id,
`approve/mota.js`), **không đưa `params`** (lệnh đầy đủ) ra tệp — Sổ chỉ cần một dòng mô tả.

**Chữ quyết định giờ được ghi**: `applyDecision` ghi `{id, decision: a|h|l|r, via}` — trước đây nhật ký chỉ có
trạng thái (running/rejected), không biết chủ đã bấm "1 giờ" hay "luôn".

**Nhãn cho phản xạ**: `sudo axle phanxa xuat [--tu 2026-09-01] > nhan.jsonl` — mỗi việc chủ đã quyết thành một mẫu
`{state, questions, gold}` đúng khuôn laya/typed-decisions (`quyet_dinh`: cho_phep/tu_choi; `nho`: lan_nay/mot_gio/
luon/khong khi có chữ quyết định). Bỏ việc tự duyệt (không phải quyết định mới) và hết hạn (chủ không quyết).
Hôm nay chỉ xuất; chưa có model nào đọc — quyết định laya đã chốt: đủ ≥1.000 nhãn mới cân nhắc fine-tune
(`reference-laya`). Không byte nào rời máy.

**Sổ trên điện thoại** (0.1.121 + app): tab Lịch sử thành **Sổ** — app hỏi `query so`, máy trả cùng nội dung công bố cho
Bàn (bỏ pending, cắt vừa hộp ≤64KB); danh sách cục bộ "điện thoại này đã nhận" giữ ở dưới cho lúc mất mạng.

## Siết và tối ưu sau ngày đầu (nhịp D10)

- **"Luôn việc này" cho web_*/tay_* nhớ theo ĐÍCH, không theo tên công cụ.** Trước: Claude xin `tay_click {so: 37}`,
  chủ bấm "Luôn" → luật `{tool: tay_click}` tự duyệt *mọi* cú bấm về sau. Giờ `approve/mota.js lenhCongCu()` dựng
  dòng lệnh từ đích thật — `tay_click libreoffice "Bảng lương — Calc": push button "Lưu"` (đổi số qua bảng vừa
  chụp của chủ, chỉ đọc) — tin duyệt đọc được, luật khớp đúng nút đó. Số không tra được / bảng quá 10 phút → `mo`
  (không rõ đích) = bậc 3, luôn hỏi, không nhớ. Thử: `approve/test-mota.mjs`, `approve/test-rules.mjs`.
- **Chảy chữ cho "Bảo Axle làm":** `axle claude --dong` = `--output-format stream-json` qua `core/desktop/claude-dong.py`:
  chữ trả lời hiện ngay khi có, mỗi lần dùng công cụ một dòng `→ Read /etc/hostname`, kết thúc `— xong (5,5 giây)`
  hoặc `✗ …`. Bàn hiện dòng `→` ở trạng thái để thấy Claude đang làm tới đâu. `</dev/null` vì claude chờ stdin 3 giây
  khi thấy ống dẫn.
- **Dặn Claude trên máy** (Bi: "dùng Claude có cần tay gì đâu cũng chạy ầm ầm"): có lệnh hay API thì dùng lệnh; chỉ
  động tới cửa sổ khi việc chỉ tồn tại dưới dạng cửa sổ.
- **Daemon:** số hôm nay đọc đuôi 1MB nhật ký thay vì cả tệp; nhiều lần đổi trạng thái trong 150ms gộp thành một
  lần ghi ban.json. Provision: lint `build/provision-lint.sh` bắt dấu huyền/`$(` trong heredoc không bọc nháy (một
  dấu huyền trong comment đã chạy nhầm `axle tay` lúc cập nhật máy thật 21/9).

## Hỏi Axle trên điện thoại (nhịp D11)

Bi (21/9): *"trên app t có hỏi được Axle không? chứ t có thấy chỗ nào để t chat với Axle đâu?"* — "Bảo Axle làm"
mới có trên Bàn ở máy; giờ là thẻ đầu tiên trên app: **Hỏi Axle**.

Đường đi: app ký băm câu hỏi bằng khoá Face ID (`hoi`, cùng khuôn với Gõ lệnh) → máy chạy `axle claude "<câu>"
--dong [--tiep]` bằng tài khoản chủ → chữ chảy về app từng khúc (`hoi-chunk`, dòng `→ …` = đang dùng công cụ) →
`hoi-result`. Việc ghi tệp / chạy lệnh / xoá mà Claude xin thì đi qua `duyet_quyen` như thường → **rung chính điện
thoại đó** (thẻ Chờ duyệt). Mặc định BẬT (khác Gõ lệnh) vì Claude chỉ đọc tự do, còn ghi/chạy đều phải qua duyệt;
`sudo axle app hoi off` để tắt. Một điện thoại hỏi một câu một lúc; hạn 10 phút; trả lời quá 60.000 ký tự thì cắt.

Máy chưa đăng nhập Claude (OAuth) thì app nhận đúng câu: *"Máy chưa đăng nhập Claude — ngồi vào máy, mở
Terminal, gõ claude và đăng nhập một lần."*

Thử: vector Node ⇄ Swift thêm hộp `hoi` (6 hộp) + chuỗi `hoiString`; CI iOS biên dịch HoiView.

**Nâng cấp 21/9 tối (0.1.129):** mỗi cuộc có **id phiên riêng** (`axle claude --phien <uuid>`: app một, Bàn một — trước
đây `--tiep` = `--continue` "cuộc gần nhất trong thư mục", hai bên hỏi chen nhau là lẫn mạch); Claude được dặn trả lời
tiếng Việt ngắn, gạch đầu dòng; app dựng Markdown gọn (đậm, mã, tiêu đề, đầu dòng), nhớ cuộc chat khi tắt app, có gợi
ý câu hỏi; Bàn dựng đậm/mã/mờ bằng tag TextView (`md_lite`, thử trong gui-logic-smoke).

## Gửi ảnh cho Axle từ điện thoại (nhịp D12)

Chụp hoá đơn / giấy tờ / màn hình lỗi → chọn ở nút ảnh trong thẻ Hỏi Axle → app nén (cạnh dài ≤1600px, JPEG ≤ ~900KB),
**niêm phong cho máy** bằng đúng hộp X25519+ChaCha20 của giao thức rồi đưa lên trạm (`POST /v1/blob`, ≤3MB, giữ 1 giờ,
trong bộ nhớ); tin `hoi` chỉ mang id tệp. Máy lấy tệp (chỉ người nhận lấy được, một lần là trạm xoá), mở hộp ra byte
(`openBytes`), ghi vào `~/.cache/axle-hoi/` của chủ (0600, dọn sau 1 ngày) và nhắc Claude đọc bằng công cụ Read (đọc
được ảnh). Trạm không bao giờ thấy ảnh. Thử: `build/relay-blob-smoke.mjs` (trạm thật ở cổng rỗi, 10 mục), vector
Node ⇄ Swift thêm hộp byte hai chiều. Chưa có: chụp thẳng bằng camera trong app (chọn từ thư viện trước).

**Tệp văn phòng (21/9 tối, 0.1.133):** ngoài ảnh, app gửi được Excel / Word / PowerPoint / PDF / văn bản ≤12MB (nút
tệp cạnh nút ảnh, từ Files/iCloud/Zalo đã lưu). Máy giữ tên gốc (đã làm an toàn: bỏ dấu, chỉ [A-Za-z0-9._-]) và đổi
sẵn bằng LibreOffice dưới tài khoản chủ: Excel → mỗi sheet một CSV, Word → txt, PowerPoint → PDF, PDF → txt
(pdftotext) rồi nhắc Claude đọc bản đã đổi. Trạm chở tới 16MB thân, vẫn mù nội dung.

## Bộ não Axle (nhịp D13)

Bi (21/9): *"không thể tạo 1 wiki - brain cho Axle sao?"* — theo đúng khuôn brain của Bi (`~/brain/CLAUDE.md`):
**raw/ bất biến → wiki/ Claude tự bảo trì → index.md luôn đọc đầu → INGEST / QUERY / LINT / log**, git giữ lịch sử.

```
~/Axle/Brain/                      (nhà chủ, 0700; core/desktop/brain-init.sh dựng, chạy nhiều lần vô hại)
├── QUY-UOC.md                     quy ước — Claude đọc trước khi tra/ghi (brain_index trả về cùng index.md)
├── raw/YYYY-MM/<ts>-<tên>         tệp chủ gửi qua Hỏi Axle (vĩnh viễn, không dọn; trùng sha256 → dùng lại)
│   └── <tệp>.doi/                 bản đã đổi: CSV từng sheet / văn bản / PDF→txt (doi-tep.sh)
├── raw/.index.jsonl               máy ghi: sha, đường, tên, lúc, thiết bị, câu hỏi
└── wiki/ index.md log.md sources/ entities/ projects/ decisions/ learnings/ concepts/
```

**Công cụ cho Claude** (`mcp/brain.js`, chỉ ngữ cảnh chủ): `brain_index` (quy ước + danh mục), `brain_tim` (từ khoá
qua wiki + tệp đã đổi, xếp hạng, trích dòng), `brain_doc`, `brain_tai_lieu`, và `brain_ghi` — ghi/nối trang **chỉ trong
wiki/*.md**, mỗi lần ghi một commit git. Vì khoanh vùng + quay lại được nên `axle claude` cho `brain_ghi` dùng thẳng,
không hỏi (mọi tool `brain_*` đọc cũng nằm trong danh sách chỉ đọc tự sinh). System prompt dặn: hỏi về tài liệu/khách/
dự án → `brain_index` trước, trả lời kèm tên trang/tệp; có tệp mới → INGEST sau khi trả lời.

**Nhìn:** Bàn có trang **Tri thức** (danh mục, nhật ký, mở thư mục); `axle brain ds | tim <từ> | mo`.

Thử: `node mcp/test-brain.mjs` (15 ca: dựng, chặn đường dẫn lạ, không ghi raw/, chỉ .md, tìm wiki + CSV, git commit,
index tài liệu). **Không phải NotebookLM:** không embedding, không app riêng — trang Markdown người đọc được, Claude
vừa viết vừa đọc; cần tìm ngữ nghĩa thì thêm sau. Notion: có thể soi gương sang một database Notion khi Bi đưa token
(chưa làm).

**Bộ não sống (21/9 đêm, 0.1.136 + app):** (1) app: nút 📚 trong Hỏi Axle → `query brain` (danh mục, tài liệu đã gửi,
nhật ký, đếm) và `query brain-tim` (tìm từ khoá; máy chạy `brain.tim` trong nhà chủ, chỉ đọc) — bấm một tài liệu / kết
quả là điền sẵn câu hỏi về nó; (2) Claude được dặn ghi vào Brain cả khi chủ **nói** ra điều đáng nhớ (khách, hẹn, số
liệu, quyết định), không chỉ khi có tệp; (3) **dọn đêm**: `axle brain lint` = Claude làm LINT theo QUY-UOC (link hỏng,
trang mồ côi, trang mỏng, thiếu trang, sửa được thì sửa, ghi log) — timer hệ thống `axle-brain-lint.timer` 21:30 chạy
bằng tài khoản chủ, không cần ai đăng nhập; chưa có Brain/token thì tự thoát 0.

**Kiểm định máy móc (21/9 đêm, 0.1.138):** lần ingest thật đầu tiên (hợp đồng Omron–HRVN, 21:42) cho thấy Claude "nối"
cả khối vào index.md (6 mục trống + 3 mục trùng, LINT phải dọn) và LINT bằng mắt không đáng tin. Thêm `brain_index_them`
(một dòng vào đúng mục, idempotent theo [[slug]]), `brain_log` (dòng có giờ), `brain_kiem` (máy móc: link hỏng, mồ côi,
mỏng, thiếu YAML, tài liệu chưa có trang; bỏ link trong dấu `, nhận cả tên tệp raw) — lời dặn INGEST/LINT đổi theo;
`axle brain lint` bắt Claude gọi brain_kiem trước và sau khi sửa. Thử: test-brain 27 ca.

**Đồ thị liên kết (22/9, 0.1.139 + app):** Bi hỏi "trên app có thể thấy Brain liên kết như thế nào không?" → `brain.doThi()`
đọc mọi trang wiki (bỏ index/log), nút = trang (tên + loại từ YAML, số link), cạnh = mỗi cặp [[link]] gộp hai chiều,
link tới trang chưa có thành nút loại `thieu` (vẽ đứt nét đỏ; bấm là điền sẵn câu "tạo trang đó"); gói ≤40KB JSON
(hộp trạm 64KB đã mã hoá) — wiki lớn thì giữ trang nhiều liên kết nhất, `bo_bot` = số trang bị ẩn (0.1.140).
App: `query brain-graph` → tấm **Liên kết trong Bộ não** trong 📚: xếp lực (đẩy–kéo, 200 vòng ngay trên điện thoại),
màu theo loại, chạm chấm → thấy nó nối với ai + nút "Hỏi về trang này". Thử: test-brain 32 ca (5 ca đồ thị).
**Trên Bàn (22/9, 0.1.142):** trang Tri thức có thẻ **Liên kết giữa các trang** — `Gtk.DrawingArea` vẽ bằng cairo, dữ liệu
lấy đúng hàm `doThi` của brain.js qua node (`do_thi_brain`, cũng là `axle brain dothi`), xếp lực thuần Python ở luồng nền
(`xep_do_thi`, khung 1000×500 rồi co đều khi vẽ nên đổi cỡ cửa sổ không xếp lại); bấm chấm → "Mở trang" (xdg-open) /
"Hỏi Bàn về trang này" (điền sẵn vào ô Bảo Axle làm). Cần gói `python3-gi-cairo` (provision-desktop cài cả lúc làm mới;
thiếu thì thẻ báo cách cài, Bàn vẫn chạy). Bài học vẽ-ra-mới-thấy: (1) sau `PangoCairo.show_layout` cairo còn điểm hiện
tại → `arc` kéo một vạch lạ từ nhãn tới chấm, phải `new_path()`; (2) nút rời bay xa vì chỉ có lực đẩy → cụm bị ép thành
một nhúm, phải kẹp toạ độ trong khung (sửa cả bản Swift). Thử: `build/gui-logic-smoke.py` (+5 ca) và
`build/gui-shot.py out/tri-thuc.png --trang nao` (Bộ não giả 8 trang; WSL thiếu python3-gi-cairo thì chồng
`_gi_cairo.so` + `cairo/` lấy từ .deb qua PYTHONPATH, không cần sudo).
