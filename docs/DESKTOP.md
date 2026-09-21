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
