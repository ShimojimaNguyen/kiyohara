> ## ĐỌC TRƯỚC — spec này MÔ TẢ ĐÍCH, KHÔNG mô tả repo hiện tại
>
> Tài liệu bên dưới là **sổ tay vận hành của một bản KIYOHARA chạy trong sandbox
> Claude.ai** (PGLite in-process, `/workspace/artifacts/…`). Code của bản đó
> **không có trong repo này** — đã tìm toàn máy ngày 2026-09-29: không có
> `getsurei.ts`, `adr.ts`, `integrity.ts`, `jev-run.ts`, `obsidian.ts`.
>
> Repo này hiện có **4/13 route** và **4/12 file lib** mà spec liệt kê:
>
> | có thật | chưa có |
> |---|---|
> | `/` · `/flow` · `/rotation` · `/trade` | `/stocks/$code` · `/history` · `/benchmarks` · `/getsurei` · `/adr` · `/agent` · `/jev` · `/wiki` · `/pipeline` |
>
> **Đừng trả lời người dùng như thể các trang chưa có đã chạy.** Trước khi nhắc
> một route hay một server fn trong spec này, kiểm nó tồn tại — `SD §1`: thiếu
> thì nói thiếu, không nói như đã có.
>
> ### Ba chỗ spec và code hiện tại VA NHAU
>
> 1. **`src/lib/screen/jev.ts`** — spec nói file này chứa `JEV_QUESTIONS` (7 câu
>    判定 cho cổ phiếu shortlist). Trong repo, cùng đường dẫn đó là **lớp chính
>    sách ngưỡng** cho `fx-roles` (`STRONG`/`WEAK`/`MARGIN`/`CONF_MIN`,
>    `leanOf`, `disagrees`) — **0 chỗ trùng nội dung**. Hai thứ khác hẳn nhau
>    dùng chung một tên. Phải tách namespace trước khi port phần 判定.
>
> 2. **Lưu trữ.** Spec dùng PGLite in-process và tự ghi *"Restart server = mất
>    scan / flow / JEV"*. Repo dùng `data/flow-latest.json` commit vào git.
>    **Bản commit thắng**, vì `SD §10`: artifact sinh tự động phải commit để
>    thay đổi nhìn thấy trong diff. Một kho dữ liệu tự rỗng khi restart là thứ
>    tệ nhất cho một trang thông tin — nó trống mà trông như bình thường.
>
> 3. **Phạm vi flow.** Spec: tháng (4 tuần vs 4 tuần) **và** quý (12 vs 12).
>    Repo: 4 tuần. Phần quý chưa có.
>
> ### Chỗ hai bên KHỚP CHÍNH XÁC — giữ nguyên, đừng sửa lệch
>
> `/trade` sector map: 輸出 11/11 ngành, 輸入 7/7 ngành, 商社 = 卸売業, ngưỡng
> USDJPY ±0,1%. Đã đối chiếu từng phần tử với `src/lib/screen/trade.ts`
> (2026-09-29). Hai bản cùng gốc `CLAUDE-CODE-輸出入.md`.
>
> ### Luật nào thắng khi mâu thuẫn
>
> `CLAUDE.md` (luật kỹ thuật) > skill `data-integrity-pillars` (`SD`) >
> file này (spec sản phẩm). Spec mô tả *muốn gì*; hai cái trên nói *không được
> làm gì*. Ví dụ: spec §0 chấp nhận mất dữ liệu khi restart — `SD §10` không.

---

# KIYOHARA — sổ tay vận hành website (cho Claude)

Đọc file này trước khi bấm nút, trả lời số, hoặc sửa code. Đây là **toàn bộ app**, không chỉ một trang.

File khác (đừng nhầm vai):

| File | Vai |
|---|---|
| **File này** | Dùng website đúng: trang nào, nút nào, số nào được phép nói |
| [CLAUDE-CODE-輸出入.md](CLAUDE-CODE-輸出入.md) | Spec code chỉ cho `/trade` |
| [GROK-BOT-KIYOHARA.md](GROK-BOT-KIYOHARA.md) | Prompt chat 1 mã (清原 + DCF). **Không** thay app |
| [attachments/PLAYBOOK.md](attachments/PLAYBOOK.md) | Playbook agent gốc |
| `/pipeline` trên web | Cùng pipeline, bản người dùng |

Ngôn ngữ UI: **chrome tiếng Việt**. Tên công ty, ngành TSE, なぜ: **tiếng Nhật**. Không phải khuyến nghị mua bán.

---

## 0. App là gì

Sàng lọc giá trị cổ phiếu Nhật (rule kiểu 清原 trên số công khai) cộng lớp vĩ mô và 判定.

- Universe: cổ phiếu nội địa TSE từ JPX `data_j.xlsx` (mốc niêm yết `2026-08-31`). ETF / REIT / PRO đã loại.
- Shortlist: mã rẻ hơn trung bình ngành, EPS dương, không rơi bẫy lọc chất lượng.
- Không có giá mục tiêu. Không có lệnh Mua / Bán.
- Preview local: `http://127.0.0.1:8080` (`npm run dev`, cổng 8080).
- DB phiên: PGLite trong process. **Restart server = mất scan / flow / JEV trong app.** File markdown trên đĩa và bản Google Drive (nếu đã sync) vẫn còn. Đừng bịa lại bảng từ trí nhớ screenshot.

---

## 1. Luật cứng — vi phạm là dùng sai

1. **Thiếu số thì để `取得不可`.** Không ước PER, PBR, EPS, BPS, giá, khối lượng, tỷ lệ ADR, doanh thu IR, P&L từ Excel 内閣府.
2. **Không GET lại dữ liệu đã có.** `yahoo_bars` first-write: cùng symbol + ngày đã lưu thì không UPDATE, không gọi Yahoo lại. Chỉ lấy ngày mới.
3. **JEV không được bịa số và không ghi đè giá / PER / PBR.** Nó chỉ gắn nhãn `noul` / `score` / `choice` lên snapshot đã có.
4. **Cùng tuần thì đọc lại, không gọi API lại** (JEV, note 清原). `force` mới gọi lại mã đó.
5. **Nhãn không phải lệnh.** Shortlist, thứ hạng trên `/getsurei` (vd Toyota, Honda), `Theo dõi` / `watch`, premium ADR, dòng tiền `in` — đều là mô tả, không phải khuyến nghị.
6. **Không in API key** ra chat, UI, markdown, log. Khóa TypeSafe nằm ở `TYPESAFE_API_KEY` hoặc `TYPE_SAFE` hoặc file `.grok/secrets/typesafe-api-key`. Chỉ kiểm tra “có khóa / không”, không đọc nội dung ra ngoài.
7. **Server không ghi được OneDrive Windows của user.** Vault máy chủ là `/workspace/artifacts/obsidian-vault/wiki`. User tự copy ZIP hoặc dùng Google Drive.

---

## 2. Bản đồ trang — đừng trộn

| Route | Việc | Server fn | Không làm trên trang này |
|---|---|---|---|
| `/` | Tổng quan tuần: universe, shortlist, nguồn | `getDashboard`, nút quét = `runWeeklyScan` | Không phân tích DCF từng mã |
| `/stocks/$code` | 1 mã: snapshot + nút 清原/DCF | `getStockDetail`, `analyzeStock` | Không quét cả universe |
| `/history`, `/history/$scanId` | Các lần quét đã lưu | `getHistory`, `getScanDetail` | |
| `/benchmarks` | Chuẩn ngành JPX (simple average, không phải median) | `getBenchmarks` | |
| `/flow` | Dòng tiền **1 tháng** (4 tuần vs 4 tuần trước). **Bên dưới: 1 quý** (12 vs 12, thiếu thì bỏ mã) | `getFlow`, `runFlowScan` | Không phải 投資部門別 JPX |
| `/rotation` | Cùng dữ liệu flow, xem từng tuần | `getFlow` | |
| `/trade` | **Tuần.** USDJPY + dòng ròng, tách 輸出 / 輸入 / 商社, kèm なぜ | `getTrade` (không gọi Excel 内閣府) | Không phải `/getsurei`. Không đọc IR doanh thu |
| `/getsurei` | **Tháng.** Excel 内閣府 overlay lên shortlist. Lợi thế / rủi ro ngành | `getGetsurei` | Số vĩ mô ≠ P&L công ty. Không nhét vào `/trade` |
| `/adr` | ADR ngày / tuần / tháng, 円換算 chỉ khi đã có レシオ NYSE | `getAdr`, `refreshAdr` | OTC không bịa レシオ. 乖離 ≠ lệnh mua |
| `/agent` | 検算: PER=giá/EPS, PBR=giá/BPS, ADR yen, dòng ròng. Lệch thì trống | `getAgent`, `runAgent` | Không bịa cho “đẹp bảng” |
| `/jev` | TypeSafe System One 判定, tối đa **12 mã** đầu shortlist | `getJev`, `runJevScan`, `runJevOne` | Không viết báo cáo. Không thay note 清原 |
| `/wiki` | Vault markdown trong app (cây file + preview) | `getWiki`, `writeObsidianVault`, `exportObsidianVault` | Không phải Obsidian desktop cho đến khi user copy file |
| `/pipeline` | Giải thích phương pháp | không fetch số mới | |
| `/agent` vs nút trên `/stocks/$code` | Agent = kiểm tra số. Nút mã = báo cáo Grok 清原+DCF (cần `XAI_API_KEY`) | | Đừng gọi báo cáo là JEV |

Header phụ: Wiki, 月例, 輸出入, ADR, Agent, JEV. Nav: Tổng quan, ADR, 輸出入, Dòng tiền, Lịch sử, Ngành, Phương pháp.

---

## 3. Thứ tự bấm đúng

Làm đúng thứ tự này. Bỏ bước = trang sau trống hoặc số cũ, **đừng điền bằng tay**.

1. Mở `/`. Nếu chưa có tuần: bấm quét tuần (`runWeeklyScan`). Một lần quét = pipeline shortlist **và** flow, rồi sync vault nếu có file.
2. Đọc shortlist trên `/` hoặc `/history/$scanId`. Ô trống giữ trống.
3. Dòng tiền: `/flow` (tháng, rồi quý phía dưới). Thiếu 24 tuần cho quý thì mã đó không có dòng quý — không suy từ tháng.
4. Xuất nhập tuần: `/trade`. Cần đã có flow. Chiều 円 chỉ là quy đổi kế toán, không phải “円安 thì mua”.
5. Vĩ mô tháng: `/getsurei`. Rank shortlist trong ngành thuận **không** phải lệnh.
6. ADR: `/adr`. Không có レシオ thì không có 円換算.
7. Kiểm số: `/agent` sau khi đã có scan / flow / ADR.
8. JEV: `/jev`, chỉ khi đã có shortlist và đã có khóa TypeSafe (xem mục 4).
9. Wiki: `/wiki`. Sau scan, JEV, hoặc note 清原, vault được ghi lại. Muốn file trên đĩa: POST `writeObsidianVault` (trang wiki cũng gọi khi mở).

Phân tích 1 mã (báo cáo dài, tiếng Nhật, có Buy/Watch/Pass): chỉ trên `/stocks/{mã}`, bấm nút. Cùng tuần đọc memory, không gọi lại. Đây **không** phải JEV.

---

## 4. JEV — dùng cho đúng

JEV = **判定 có cấu trúc**, không phải bài phân tích.

**Transport.** `resolveJevTransport()`:

- Có `TYPESAFE_API_KEY` hoặc `TYPE_SAFE` (hoặc file secret ở trên) → `POST https://api.typesafe.ai/v1/systemone`, body `{ model: "jev-latest", state, questions }`. Model **trả về** (vd `jev-1.13.0`) mới là model thật; request luôn gửi `jev-latest`.
- Không có khóa TypeSafe nhưng có `XAI_API_KEY` → Grok JSON **cùng schema**. UI phải ghi `grok-json`, **không** được gọi đó là JEV thuần.
- Không khóa → không chạy. Đừng giả lập bảng 判定.

**Câu hỏi** (`JEV_QUESTIONS` trong `src/lib/screen/jev.ts`):

| Key | Primitive | Ý |
|---|---|---|
| `value_candidate` | noul | Ứng viên giá trị kiểu Kiyohara, chỉ từ fact đã cho |
| `eps_quality` | score 0–3 | `loai` / `canh_bao` / `kha` / `tot` |
| `bs_quality` | score 0–3 | cùng thang điểm |
| `catalyst` | score 0–3 | `khong` / `yeu` / `trung_binh` / `manh` — không bịa sự kiện IR |
| `risk` | score 0–2 | `thap` / `trung_binh` / `cao` |
| `trap` | noul | Bẫy giá trị |
| `action` | choice | `shortlist` / `watch` / `skip` |

Parse chặt: khóa thừa (giá, PER, …) bị bỏ. `取得不可` trong state giữ nguyên.

**Cách chạy.**

- Cần `latestLiveScan()` trước. Không scan → báo lỗi, không bịa shortlist.
- Chỉ **12 mã đầu** shortlist (`JEV_SHORTLIST_CAP`), không phải cả shortlist, không phải cả universe.
- Một lần bấm = **một đợt**: TypeSafe 6 mã, nhánh Grok 3 mã. Trang còn chữ “từng đợt 3 mã” khi chưa có lần chạy — đó là chữ cũ; khi transport là typesafe thì batch là 6. Bấm lại cho đến khi `pending = 0`.
- Cùng `weekLabel` đã 判定 thì `reused: true`, không gọi API. Muốn làm lại đúng những mã trong cap: `runJevScan({ force: true })`.
- Một mã: `runJevOne({ code })` trên trang mã (ticker JEV).
- Xong đợt (không còn pending của lần đó) thì `syncObsidianVault()`.

**Đọc kết quả.** So cột JEV với cột rule (EPS / B/S / catalyst / risk của screener). Lệch là thông tin, không được “sửa cho khớp”. Toàn bộ `watch` / Theo dõi là output model, không phải lỗi wire — trừ khi transport không phải `typesafe` hoặc model không phải chuỗi JEV.

---

## 5. Dòng tiền và 輸出入 — định nghĩa đúng

- Universe dòng tiền: chỉ `TOPIX Core30` + `Large70` + `Mid400` (`FLOW_UNIVERSE`). Không phải ~3707 mã nội địa.
- `signedFlow ≈ dấu(thay đổi giá tuần) × 売買代金`. Không phải sổ 投資部門別. Không phải tiền vào tài khoản công ty.
- Quý: 12 tuần vs 12 tuần trước. Thiếu đủ cửa sổ thì **bỏ mã**, không nội suy.
- `/trade` phân ngành TSE 33:
  - 輸出: 輸送用機器 電気機器 機械 精密機器 鉄鋼 非鉄金属 化学 ゴム製品 海運業 繊維製品 医薬品
  - 輸入: 石油・石炭製品 電気・ガス業 空運業 小売業 食料品 水産・農林業 鉱業
  - 商社: 卸売業
  - Còn lại: 判定不能, không bịa chiều 円
- USDJPY tuần: trên +0.1% = 円安, dưới −0.1% = 円高, còn lại gần như không đổi.
- Cache thương mại: 輸出/商社 × 円安 = in; 輸出/商社 × 円高 = out; 輸入 × 円高 = in; 輸入 × 円安 = out.
- なぜ đúng 4 dòng: phân loại ngành, print USDJPY, chiều thương mại, dòng thị trường hoặc 取得不可.

---

## 6. Shortlist (rule, không phải JEV)

Giữ khi PER **hoặc** PBR thấp hơn TB ngành ≥ 12%, hoặc PBR < 1 và PER không đắt hơn ngành. EPS ≤ 0 thì loại. Thiếu dữ liệu thì loại / để trống, không suy. Bốn lọc: EPS, B/S (PBR < 0.3 gần như không cổ tức = bẫy), catalyst chỉ từ fact (TSE PBR<1, cổ tức, vị trí 52 tuần), risk (vốn hóa, biên 52 tuần, ngành chu kỳ). Điểm động theo ngành; EPS hoặc B/S loại thì ra khỏi shortlist.

Nguồn giá: 株探 (bảng ngành, thường là 予想) và Yahoo JP. 株探 có thể bị Cloudflare — lần quét ghi rõ nguồn và số mã, không giả là live đủ.

---

## 7. 月例 và ADR — ranh giới

**月例** (`/getsurei`): 総雇用者所得, GDPギャップ, 潜在成長率, 輸出・輸入数量指数 từ Excel 内閣府. Tiêu dùng: CTI + 日銀 消費活動指数. Không dùng 消費総合指数 (chuỗi cũ đã dừng). Overlay **ngành** lên shortlist: thuận / hỗn hợp / ngược. Không chế P&L Toyota/Honda từ comment ngành.

**ADR** (`/adr`): Yahoo chart ADR và `.T`. 円換算 = `ADR$ × USDJPY / số cổ JP trong 1 ADR`. Chỉ NYSE đã có レシオ (vd TM 10, HMC 3, SONY 1). Không có shares → không có yen, không có premium.

---

## 8. Wiki / Obsidian

Cấu trúc vault (path tương đối):

```
JP undervalue.md          hub
JP undervalue/{code}.md   1 mã shortlist
JP undervalue/weeks/{week}.md
JP undervalue/jev/{week}.md
JP undervalue/sectors/{業種}.md
JP undervalue/runs/{code}-{week}.md   note 清原, bất biến
```

Ghi khi: quét tuần xong, flow xong (nếu không pending), JEV hết pending đợt, note 清原 mới, hoặc mở `/wiki` / bấm ghi vault.

- Trong app: bảng `obsidian_files` + cây `/wiki`.
- Trên đĩa sandbox: `/workspace/artifacts/obsidian-vault/wiki` (`writeVaultToDisk`).
- ZIP tải về: artifact `JP-undervalue-obsidian.zip` khi đã export. User giải nén vào vault Obsidian / OneDrive của họ.
- Google Drive (connector) là bản copy, không phải ghi thẳng Obsidian desktop. Đừng tạo folder mới nếu đã có `llm-wiki`.

Đừng khẳng định “đã vào Obsidian của user” nếu mới ghi sandbox hoặc Drive. Nói đúng chỗ file đang nằm.

---

## 9. Khóa và model

| Việc | Khóa | Gọi |
|---|---|---|
| JEV 判定 | TypeSafe (`typesafeApiKey()`) | `api.typesafe.ai/v1/systemone`, model request `jev-latest` |
| Báo cáo 清原 + DCF trên `/stocks/$code` | `XAI_API_KEY` | Grok, không phải JEV |
| JEV khi **không** có TypeSafe | `XAI_API_KEY` | JSON giả schema — bắt buộc ghi transport `grok-json` |
| Giá, flow, ADR, 月例 | không cần LLM | Yahoo / Kabutan / file 内閣府 |

`src/lib/env.server.ts`: không dùng biến `VITE_` cho khóa. Không đưa khóa xuống browser.

---

## 10. Code — chỉ khi được yêu cầu sửa

Đừng refactor cho “đẹp”. Sửa đúng file:

| Việc | File |
|---|---|
| Server fn | `src/lib/screen/server.ts` |
| JEV schema + HTTP | `src/lib/screen/jev.ts` |
| Chạy JEV tuần / 1 mã | `src/lib/screen/jev-run.ts` |
| UI JEV | `src/routes/jev.tsx` |
| Flow / quý | `src/lib/screen/flow.ts`, `src/routes/flow.tsx` |
| 輸出入 | `src/lib/screen/trade.ts`, `src/routes/trade.tsx` |
| 月例 | `src/lib/screen/getsurei.ts`, `src/routes/getsurei.tsx` |
| ADR | `src/lib/screen/adr.ts`, `src/routes/adr.tsx` |
| Kiểm số | `src/lib/screen/integrity.ts` |
| Vault markdown | `src/lib/screen/obsidian.ts`, `obsidian-write.server.ts` |
| Khóa | `src/lib/env.server.ts` |
| PGLite | `src/lib/screen/db.ts` |

Test: `npm test` (gồm `jev.test.ts`, `trade.test.ts`, `integrity.test.ts`, `flow.test.ts`, `obsidian.test.ts`). Đổi schema 判定 hoặc identity 輸出入 thì phải sửa test cho khớp, không nới test để nuốt số bịa.

Stack: TanStack Start, React Query, Tailwind v4 token trong `src/styles.css` (`bg-bg`, `text-fg`, …). Không hex tùy tiện trong JSX. Nút/tab cao `h-11`.

---

## 11. Câu trả lời cho user — khuôn

- Nói trang, tuần (`weekLabel`), nguồn, và **transport** nếu là JEV.
- Số không có trong snapshot / flow / file 月例: `取得不可`, không “khoảng”.
- DB app trống sau restart: nói trống, chỉ đường bấm quét lại. Vault đĩa có thể còn tuần cũ — đó là bản ghi cũ, không phải live DB.
- Không dán API key. Không biến `Theo dõi` thành lời khuyên mua.
