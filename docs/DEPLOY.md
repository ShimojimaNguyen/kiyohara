# Vận hành & triển khai

Trạng thái ghi ở đây là **trạng thái đã kiểm chứng**, không phải dự định.
Mục nào chưa chạy thật thì nói rõ là chưa.

---

## 1. Hai đường chạy

| | lệnh | đường đi | đã kiểm chứng |
|---|---|---|---|
| Dev | `npm run dev` | Vite dev server, cổng 8080 | ✅ 2026-09-21 |
| Production local | `npm run build && npm start` | `server/node.mjs` → `dist/server/server.js` | ✅ 2026-09-21 |
| Vercel | — | xem §4 | ❌ **chưa deploy lần nào** |

`dist/server/server.js` chỉ export `{ fetch(Request): Promise<Response> }` — nó
không tự mở cổng. `server/node.mjs` làm ba việc: phục vụ `dist/client` (chặn
path traversal, cache `assets/` vĩnh viễn vì tên có hash), chuyển
`node:http` ⇄ fetch API, và trả 500 không kèm chi tiết lỗi ra ngoài.

---

## 2. Dữ liệu tới từ đâu

```
.github/workflows/weekly-scan.yml   thứ Sáu 21:00 UTC (= thứ Bảy 06:00 JST)
        │  node scripts/scan.ts · 492 request Yahoo · ~150s
        ▼
data/flow-latest.json  ──commit vào repo──> app đọc qua store.ts
```

Job **không commit** nếu `latestWeek` không đổi. Đó cũng là toàn bộ cách xử lý
ngày nghỉ lễ: không có bảng lịch nào trong repo, chỉ một câu hỏi "nguồn có trả
về tuần mới không". Nghỉ lễ, sàn đóng bất thường, nguồn chậm — cùng một cách xử lý.

Chạy tay: tab Actions → `weekly-scan` → Run workflow.

### Sinh lại universe (hàng tháng)

```bash
py scripts/build_universe.py     # JPX data_j.xlsx → src/lib/screen/universe.ts
```

Script **từ chối ghi đè** nếu ra < 400 mã hoặc thiếu cột header — JPX đổi bố cục
file thì thà đỏ còn hơn lặng lẽ thu nhỏ universe.

---

## 3. Khi job đỏ

| dấu hiệu trong log | nghĩa là gì | làm gì |
|---|---|---|
| `độ phủ dưới 80%` | Yahoo chặn hoặc mạng CI kém | chạy lại; đỏ hai lần liên tiếp thì mới là nguồn đổi |
| `gross … ngoài dải hợp lý` | **nghi sai bậc đơn vị**, không phải thị trường biến động | đối chiếu 売買代金上位 (§5) trước khi nới dải |
| `tuần lấy được cũ hơn lần trước` | nguồn trả dữ liệu cũ | không làm gì; tuần sau chạy lại |
| `không dựng được lưới tuần` | hầu hết request hỏng | kiểm Yahoo còn trả `v8/finance/chart` không |

Mọi trường hợp trên đều **giữ nguyên** `flow-latest.json` cũ. Trang sẽ hiện tuần
cũ kèm nhãn ngày — đó là kết quả đúng, không phải sự cố cần chữa gấp.

---

## 4. Vercel — chưa làm

Kiến trúc đã chọn là Vercel Hobby + GitHub Actions cho phần quét. Phần quét đã
xong và chạy được. Phần Vercel thì **chưa**, và tôi không muốn để lại một
`vercel.json` viết theo phỏng đoán:

- TanStack Start 1.168 (bản đang cài) **không có** preset deploy cho Vercel —
  đã kiểm trong `node_modules/@tanstack/start-plugin-core`, không có chuỗi
  `vercel` nào.
- Nên cần một adapter viết tay bọc `dist/server/server.js` thành Vercel Function,
  và việc đó phải được kiểm chứng bằng một lần deploy thật, không phải bằng suy luận.

Trong lúc chờ, `npm run build && npm start` chạy được trên bất kỳ máy nào có
Node 24 — kể cả một VPS nhỏ nhất.

Hai lựa chọn khi làm tiếp, cần quyết trước khi viết code:

1. **Adapter Vercel** — giữ nguyên kiến trúc, có server function. FX vẫn lấy
   theo yêu cầu (cache 6h).
2. **Prerender thành tĩnh** — đưa luôn FX vào lần quét tuần, xuất HTML tĩnh,
   host GitHub Pages miễn phí. Rẻ nhất và giống hệt cách `vn-market-dashboard`
   đang chạy, nhưng FX sẽ chỉ mới theo tuần chứ không theo 6 giờ. Đây là **đổi
   kiến trúc**, nên theo CLAUDE.md §5.2 phải qua Plan mode.

---

## 5. Đối chiếu số khi nghi ngờ

Bảng công khai, không cần khoá:
`https://finance.yahoo.co.jp/stocks/ranking/tradingValueHigh?market=all`

Mốc đo 2026-09-21 (tuần dữ liệu 2026-09-13):

| | |
|---|---|
| gross universe 492 mã | 37,1兆円/tuần ≈ 7,4兆円/phiên |
| toàn thị trường 4.287 mã (phiên 09-18) | ~10兆円/phiên |
| universe chiếm | ~74% |
| mã #1 | 285A キオクシア 1,82兆円/phiên |

Nếu tỷ trọng universe rơi xuống dưới ~50% hoặc vượt 100%, dừng lại và tìm
nguyên nhân trước khi công bố — đừng nới `GROSS_*`.

Và trước khi kết luận "nguồn sai": kiểm phép kiểm của chính mình trước. Xem
CLAUDE.md §5.7 — đúng chuyện đó đã suýt xảy ra ngày 2026-09-21.
