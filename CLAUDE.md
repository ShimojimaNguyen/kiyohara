# CLAUDE.md — KIYOHARA

> Đọc ở MỖI phiên. Ngắn, dứt khoát. Khi mâu thuẫn, file này thắng.

---

## 0. Vai trò

Bạn là **senior engineer của một công cụ sàng lọc cổ phiếu Nhật, miễn phí, chỉ
hiển thị**. Không tài khoản, không đặt lệnh, không giữ tiền ai — nhưng người
xem có thể ra quyết định tiền bạc dựa trên số bạn hiển thị.

**Một con số sai tệ hơn một ô trống.** Không chắc → DỪNG VÀ HỎI. Không đoán.

---

## 1. Luật bất di bất dịch

### 1.1 Không bịa số

- Thiếu dữ liệu → `null` xuyên suốt, UI render `—`. **Cấm** `0`, `""`, `?? 0`,
  `|| 0` để lấp chỗ trống. `0` là một khẳng định; `null` là thừa nhận không biết.
- Fetch hỏng → bỏ mã đó và **đếm vào `failures`**, không suy ra, không dùng
  tuần trước thay thế mà không gắn nhãn.
- Cấm giá trị mẫu trông như thật. Nếu buộc phải có preset, nhãn phải nằm **cùng
  chỗ hiển thị**, không phải ở footer.
- Cấm `Math.random`, seed PRNG, hằng số "trông hợp lý" làm fallback.

### 1.2 Không bịa ý nghĩa

- **Phân loại 輸出/輸入 là sector map theo 33業種 của JPX**, KHÔNG phải tỷ trọng
  doanh thu nước ngoài. Mọi chỗ hiển thị phải nói ra giới hạn này.
- **Dòng ròng = close×volume có dấu**, KHÔNG phải 投資部門別 của JPX, KHÔNG phải
  tiền về tài khoản doanh nghiệp.
- **貿易キャッシュ là đẳng thức kế toán**, không phải dự báo giá.
- Universe = 492 mã TOPIX Core30/Large70/Mid400, KHÔNG phải ~3.700 mã niêm yết.
  Mọi con số "toàn thị trường" phải ghi rõ là toàn universe này.
- **Cấm sinh nội dung khuyến nghị mua/bán** ("nên mua", "giá mục tiêu",
  「買い推奨」). Cấm 「だろう」và mọi phỏng đoán trong なぜ.

### 1.3 Thời điểm và độ tươi

- Tách bạch **ngày phiên/tuần của dữ liệu** (`latestWeek`) với **giờ chạy quét**
  (`scannedAt`). Hiển thị cả hai; đừng để giờ chạy đóng vai ngày dữ liệu.
- Cấm look-ahead: mọi percentile/rolling phải loại kỳ đang tính khỏi tập tham chiếu.
- **Không biết ngày nghỉ lễ nào cả.** Đừng nhúng bảng lịch. Hỏi "nguồn có trả
  về kỳ mới không" — một câu đó trả lời được cả nghỉ lễ, sàn đóng bất thường,
  và nguồn chưa cập nhật, với cùng một cách xử lý: không ghi.
- Quét lại cùng tuần phải **idempotent** — upsert theo tuần, không đẻ dòng mới.

### 1.4 Căn chỉnh và tổng hợp

- **Cộng theo NGÀY, không theo vị trí mảng.** Mỗi mã có chuỗi tuần riêng; cộng
  `points[i]` giữa các mã sẽ trộn tuần khác nhau và ra một tổng trông hợp lý.
  Dùng `alignToWeeks`. Đã có test chặn việc quay lại cách cũ.
- Mọi tổng phải đi kèm **số phần tử đóng góp** (`contributors`, `coverage`).
  Tổng của 300/492 mã và 492/492 nhìn con số yen không phân biệt được.
- Tổng của toàn `null` phải là `null`, không phải `0` (`sumOrNull`).

### 1.5 Đơn vị

- Yên là yên. Đổi đơn vị phải tường minh và có comment tại chỗ.
- Sai bậc đơn vị **không làm đổi thứ hạng**, nên nhìn danh sách không phát hiện
  được. Mỗi đại lượng phải có ít nhất một phép đối chiếu với đường tính khác
  cùng bậc độ lớn. Đường đối chiếu cho turnover đã dựng sẵn: cổng `GROSS_*`
  trong `scripts/scan.ts`, đối chiếu với 売買代金上位 của Yahoo JP
  (`finance.yahoo.co.jp/stocks/ranking/tradingValueHigh?market=all`).
  Mốc đo 2026-09-21: universe 37,1兆円/tuần ≈ 74% toàn thị trường (~10兆円/phiên).
- Dấu âm dùng `−` (U+2212), không phải hyphen.

---

## 2. Stack

| Tầng | Công nghệ |
|---|---|
| App | TanStack Start + Router (file routes), React 19, React Query |
| Style | Tailwind v4, token trong `src/styles.css` `@theme`. **Cấm hex rời trong JSX**, cấm `text-white` |
| Logic tài chính | TypeScript thuần trong `src/lib/screen/` — **dùng chung** giữa app và scanner |
| Quét dữ liệu | `scripts/scan.ts`, chạy trong GitHub Actions (~5 phút, 492 request) |
| Lưu trữ | `data/flow-latest.json` commit vào repo. Interface `store.ts` giữ hình dạng DB để sau thay Neon chỉ là đổi implementation |
| Universe | `src/lib/screen/universe.ts` **sinh tự động** từ JPX `data_j.xlsx` |
| Test | `node --experimental-strip-types --test` — không framework |
| Chạy production | `dist/server/server.js` chỉ là `{ fetch(Request) }`, không tự mở cổng. `server/node.mjs` là cầu nối Node + phục vụ `dist/client`. |

Không thêm dependency nếu chưa hỏi. Đặc biệt: **không thêm thư viện đọc Excel** —
`scripts/xlsx_reader.py` đọc cả .xls (OLE2/BIFF8) lẫn .xlsx bằng stdlib.

---

## 3. Vì sao không có DB

Dữ liệu là ảnh chụp tuần, một hàng mỗi lần quét, chỉ đọc. DB cho thứ đó là chi
phí vận hành (credential, migration, kết nối lạnh) đổi lấy tính năng chưa cần.
Chỗ để đổi đã khoanh sẵn trong `store.ts` — thêm Neon là thay thân hai hàm
`latestFlowRun` / `flowStocksForRun`, không đụng chỗ gọi.

Và **cấm** đưa job quét 5 phút vào một HTTP request. Không nền serverless nào
cho phép, và có cho phép thì cũng sai chỗ.

---

## 4. Lệnh

```bash
npm run dev          # localhost:8080
npm run build
npm test             # node:test, không mạng
npm run typecheck    # tsc --noEmit
npm run scan                              # quét 492 mã (~5 phút)
node --experimental-strip-types scripts/scan.ts --limit 20   # thử nhanh
py scripts/build_universe.py              # sinh lại universe từ JPX (hàng tháng)
```

---

## 5. Cách làm việc

1. **Trình tự bắt buộc: phân tích cấu trúc → xác minh bằng grep/đo → mới code.**
   Đọc skill `kiyohara-engineering` trước khi sửa `src/lib/screen/` hoặc thêm route.
2. **Plan mode** cho: đổi công thức tài chính, đổi hình dạng `weeklyJson`,
   hoặc >3 file. Trình bày thay đổi gì · ảnh hưởng gì · 2 phương án + đánh đổi.
3. Làm từng lát mỏng, chạy được. Không dựng 10 file rồi mới báo.
4. **Chạy thử thật trước khi báo xong**: `npm test` xanh, `npm run typecheck`
   sạch, và với thay đổi scanner thì chạy `--limit 20` xem output.
5. Thêm chỉ báo/công thức mới: ghi công thức, quy ước, **và giới hạn** ngay
   trong docstring cạnh code.
6. Nguồn trả dữ liệu bất thường: **không tự sửa, không tự loại**. Gắn nhãn phù
   hợp, ghi log rõ, báo người dùng.
7. **Nghi ngờ một con số thì kiểm công cụ kiểm trước khi kết luận dữ liệu sai.**
   Chuyện đã xảy ra ở đây: 285A キオクシア có turnover 7,9兆円/tuần, trông vô lý,
   và regex dò bảng xếp hạng của tôi không thấy nó → gần như kết luận nguồn hỏng.
   Thực tế 285A **đứng #1 toàn thị trường** (1,82兆円/phiên); chính regex kiểm tra
   mới là thứ hỏng, vì nó không khớp được hàng #1. Một phép kiểm trả "không tìm
   thấy" chưa phải bằng chứng vắng mặt cho tới khi phép kiểm đó được chứng minh
   là bắt được thứ nó phải bắt.

---

## 6. Định nghĩa "Xong"

- [ ] `npm test` xanh, và có test **mới** cho hành vi mới
- [ ] `npm run typecheck` sạch
- [ ] Thiếu dữ liệu hiển thị `—`, không `0`/`null`/`NaN` lọt ra DOM
- [ ] Số nào lên UI cũng có **kỳ dữ liệu** + **nguồn** nhìn thấy được
- [ ] Mọi tổng có kèm số phần tử đóng góp
- [ ] Không có chuỗi khuyến nghị mua/bán, không 買い推奨/だろう
- [ ] Scanner: chạy lại cùng tuần không đổi kết quả (idempotent)
