---
name: kiyohara-engineering
description: Kiến trúc và cơ chế của KIYOHARA — luồng dữ liệu, bất biến của lớp tài chính, các bẫy đã sập và cách chúng đã bị chặn. Bắt buộc đọc TRƯỚC khi sửa src/lib/screen/, thêm route, hoặc đổi scanner.
---

# KIYOHARA — kiến trúc và bất biến

`CLAUDE.md` nói **luật**. File này nói **cơ chế**: hệ thống nối với nhau bằng
cách nào, chỗ nào đã gãy, và cái gì đang giữ cho nó không gãy lại.

**Trình tự bắt buộc: đọc cấu trúc → xác minh bằng lệnh → mới code.**

---

## 1. Luồng dữ liệu

```
JPX data_j.xlsx ──(scripts/build_universe.py, hàng tháng)──> src/lib/screen/universe.ts
                                                                      │ 492 mã, commit
                                                                      ▼
Yahoo chart ──(scripts/scan.ts, hàng tuần, ~5 phút)──> data/flow-latest.json
                                                                      │ commit
                                                                      ▼
                                              store.ts ──> server.ts getTrade ──> route /trade
Yahoo USDJPY ──(trade.ts fetchUsdJpyWeekly, cache 6h)─────────────────┤
                                                                      │
EDINET 有報 ──(build_fx_roles.py + Jev, hàng tháng)──> fx-roles.ts ────┘
                                                        492 mã, commit
```

Ba tầng nối bằng **hình dạng dữ liệu**, không bằng lời hứa:

- `universe.ts` là artifact **sinh ra rồi commit** — thêm/bớt mã thấy trong diff
  PR, không âm thầm đổi dưới chân.
- `data/flow-latest.json` cũng commit. Lịch sử scan nằm trong git log.
- `store.ts` cố tình mang hình dạng bảng DB (`latestFlowRun` / `flowStocksForRun`)
  để thêm Neon sau chỉ là đổi thân hàm.

Logic tài chính ở `src/lib/screen/` được **dùng chung** giữa scanner và app.
Đừng viết bản thứ hai của một công thức ở scripts/ — hai bản sẽ lệch nhau và
không ai biết bản nào đúng.

---

## 2. Bất biến của lớp tài chính

Mỗi cái dưới đây đều có test. Phá là đỏ.

| Bất biến | Vì sao | Chặn ở |
|---|---|---|
| Tuần đầu chuỗi → `signedFlowYen = null`, không phải `0` | Không có tuần trước để so. `0` là khẳng định "dòng ròng bằng không" | `toWeeklyPoints` |
| Cộng theo **ngày**, không theo vị trí mảng | Mã niêm yết muộn/tạm ngừng có chuỗi ngắn hơn → trộn tuần này với tuần khác, tổng vẫn hợp lý | `alignToWeeks`, ±3 ngày |
| `sumOrNull([null,null]) === null` | Không mã nào có số thì tổng không phải 0 | `sumOrNull` |
| FX dùng `completedFxWeekly`, KHÔNG dùng `completedWeekly` | FX luôn `volume = 0` → hàm cổ phiếu xoá sạch chuỗi | test đối chứng trực tiếp |
| FX lệch > 4 ngày → `null` | Ghép tuần cổ phiếu với tuần FX khác | `fxChangeNearDate` |
| `flat`/`unknown` **không** tính là `tradeIn` | Không biết tỷ giá thì không được nói "tiền vào hai phía" | `tradeBucket` |
| Mã `neutral` bị loại và **đếm** (`skipped`) | Không bịa vai trò 輸出/輸入 cho ngân hàng, BĐS | `buildTradeView` |
| Mọi tổng kèm `contributors` / `coverage` | Tổng 300/492 và 492/492 nhìn không phân biệt được | `RoleRow`, `TradeView.coverage` |
| Jev `unclear` **không** tính là bất đồng | Không kết luận được thì im lặng, không được mượn sự im lặng để phản đối phân loại đang có | `disagrees` |
| So ngưỡng Jev phải làm tròn trước | `0.82−0.67` = `0.1499…` trượt 0,15 còn `0.87−0.72` thì lọt — 4/15 cặp cùng khoảng cách cho hai kết quả | `gap()` trong `jev.ts` |
| `none_of_these` bắt buộc ở mọi câu `choice` | Thiếu nó thì model chọn cái gần nhất và tự tin: セブン&アイ nhận `domestic_wholesale` conf 0,97 | `jev-questions.json` |
| Phán đoán Jev không vào bất kỳ tổng yen nào | Model *"is not a calculator"*; tổng vẫn do sector map quyết | `fx-roles.ts` chỉ chú thích |

---

## 3. Cổng của scanner

`scripts/scan.ts` **từ chối ghi** trong những trường hợp sau:

1. Không dựng được lưới tuần
2. Độ phủ < `MIN_COVERAGE_PCT` (80%) — thà giữ tuần trước có nhãn cũ còn hơn
   công bố tổng thiếu mã như thể đủ
3. Gross turnover ngoài dải `GROSS_MIN_YEN`…`GROSS_MAX_YEN` — cổng chống sai
   bậc đơn vị. Chạy **sau** cổng độ phủ có chủ đích: thiếu mã cũng làm gross
   thấp, và khi đó nguyên nhân thật là độ phủ, không phải đơn vị.
4. Tuần lấy được **cũ hơn** lần trước — nguồn trục trặc, không phải kỳ mới
5. Mã lỗi thì bỏ và ghi vào `failures` kèm lý do, không thay bằng số nào

`--limit N` là chế độ thử và ghi ra `data/flow-sample.json`, **không** đụng
`flow-latest.json`: quét 20 mã vẫn cho độ phủ 20/20 = 100%, nên nó lọt mọi cổng
và sẽ thay một bảng 492 mã bằng một bảng 20 mã mà vẫn tự ghi là "100%".

`build_fx_roles.py` cũng vậy: `--limit N` ghi `data/fx-roles.sample.json`, và
từ chối ghi khi phủ bằng chứng EDINET < 60% hoặc < 400 mã. Một bảng nửa dựa
有報 nửa dựa mỗi cái tên thì hai loại trông giống hệt nhau trên UI.

### Đường đối chiếu bên ngoài

`grossTurnoverYen` và `topTurnover` được ghi vào output để đối chiếu **bằng mắt**
với bảng công khai 売買代金上位:
`https://finance.yahoo.co.jp/stocks/ranking/tradingValueHigh?market=all`

Mốc đo 2026-09-21 (tuần 2026-09-13):

| đại lượng | giá trị |
|---|---|
| gross universe 492 mã | 37,1兆円/tuần ≈ 7,4兆円/phiên |
| toàn thị trường (4.287 mã, phiên 09-18) | ~10兆円/phiên |
| tỷ trọng universe | ~74% — đúng bậc cho 492 mã lớn nhất |
| mã #1 | 285A キオクシア, 1,82兆円/phiên |

Lưới tuần dựng **theo số phiếu** (ngày nào được nhiều mã ghi nhận nhất), không
lấy lưới của một mã bất kỳ — mã đó nghỉ giao dịch một tuần là kéo cả bảng lệch.

---

## 4. Bốn kiểu lỗi đã thực sự xảy ra trong hệ này

Cả bốn đều cho ra số **trông hợp lý**, nên không ai soi ra:

1. **Cộng theo vị trí mảng** — tuần 3 của mã này vào cột tuần 4 của mã kia.
2. **`0` giả làm "không biết"** — tuần đầu chuỗi gán 0 rồi bị cộng vào tổng ngành.
3. **Sai bậc đơn vị** — thứ hạng không đổi nên nhìn danh sách không phát hiện.
   Luôn đối chiếu với một đường tính khác cùng bậc độ lớn.
4. **Dòng tổng hợp lẫn dòng chi tiết** — trước khi `sum()`, hỏi "mỗi dòng ở đây
   là một cái gì?".

Và một kiểu thứ năm không phải lỗi dữ liệu mà lỗi đặt tên: **hai đại lượng khác
nhau dùng chung một key**. Chúng lệch vài phần trăm — đủ nhỏ để không ai nghi.

Kiểu thứ sáu, và là kiểu nguy hiểm nhất vì nó làm hỏng **dữ liệu đúng**:
**phép kiểm hỏng bị tin là bằng chứng**. 2026-09-21: 285A có turnover
7,9兆円/tuần, gần một nửa tổng 輸出 — trông vô lý, và regex dò bảng xếp hạng
báo "285A không có trong 389 mã đầu bảng". Hai dấu hiệu chỉ cùng một hướng nên
suýt đi tới kết luận "nguồn hỏng, phải loại mã này". Thực tế 285A đứng **#1
toàn thị trường**; regex mới là thứ hỏng — nó không khớp được đúng hàng #1 nên
âm thầm bỏ qua. **"Không tìm thấy" chưa phải "không tồn tại" cho tới khi phép
kiểm được chứng minh là bắt được thứ nó phải bắt.** Cách chặn: trước khi tin
một phép dò trả về rỗng, cho nó dò một thứ đã biết chắc là có.

---

## 5. Quy ước UI

- Token Tailwind v4 trong `src/styles.css` `@theme`. **Cấm hex rời trong JSX**,
  cấm `text-white`, cấm gradient blob, cấm emoji làm icon.
- `h-11` cho tab và nút.
- Thiếu dữ liệu render `—`. Không bao giờ `0`, `null`, `NaN`, `undefined` lọt DOM.
- **Màu FX ngược màu cổ phiếu có chủ đích**: bar USDJPY tăng (円安) dùng
  `bg-down`, giảm (円高) dùng `bg-up`. Tone KPI theo **hướng số**, không theo
  "tốt/xấu" — 円安 tốt cho xuất khẩu và xấu cho nhập khẩu, nên không có màu nào
  là "tốt".
- Mỗi con số trên UI phải có **kỳ dữ liệu** và **nguồn** nhìn thấy được.

---

## 6. Trước khi gõ dòng code đầu tiên

1. Số này lấy từ đâu, ai sinh ra nó, kỳ nào?
2. Trường nào có thể thiếu, thiếu thì hiện gì? (phải là `—`)
3. Có phép cộng nào không? Nếu có: cộng đúng cùng một kỳ chưa, và có công bố
   số phần tử đóng góp chưa?
4. Có đổi công thức tài chính / hình dạng `weeklyJson` / >3 file không?
   → Plan mode, chờ duyệt.

---

## 7. Định nghĩa "xong"

```bash
npm test          # xanh, VÀ có test mới cho hành vi mới
npm run typecheck # sạch
npm run build && npm start   # bản production thật, không chỉ `npm run dev`
node --experimental-strip-types scripts/scan.ts --limit 20   # nếu đụng scanner
```

`npm run dev` và `npm start` đi hai đường khác nhau — dev qua Vite, production
qua `server/node.mjs`. Lỗi chỉ xuất hiện ở một phía là chuyện thường (đã gặp:
`import()` đường dẫn tuyệt đối Windows chạy được ở dev, ném
`ERR_UNSUPPORTED_ESM_URL_SCHEME` ở production).

Rồi tự soi: `—` đúng chỗ · kỳ dữ liệu hiện ra · tổng có contributors · không
chuỗi khuyến nghị mua bán.
