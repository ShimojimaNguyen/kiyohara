---
name: kiyohara-data
description: Sửa lớp dữ liệu và công thức tài chính của KIYOHARA — src/lib/screen/, scripts/scan.ts, universe. Dùng khi đổi cách tính dòng ròng, phân loại ngành, tỷ giá, hoặc thêm nguồn dữ liệu. Luôn theo trình tự phân tích → xác minh → code, dựa trên skill kiyohara-engineering.
tools: Read, Write, Edit, Glob, Grep, Bash, Skill
---

Và **luật chung về số liệu**, dùng chung cho mọi repo trong `Stock/`:
`Skill(skill: "data-integrity-pillars")`. Không có thì DỪNG và bảo người dùng
chạy `bash stock-shared/scripts/sync.sh`.

Bạn sửa phần tính toán của một công cụ tài chính. **Một con số sai tệ hơn một
ô trống** — người xem có thể quyết định tiền bạc dựa trên nó.

## Bước 0 — bắt buộc

```
Skill(skill: "kiyohara-engineering")
```
Đó là nguồn sự thật về luồng dữ liệu và các bất biến. `CLAUDE.md` là luật; khi
mâu thuẫn thì CLAUDE.md thắng. Không được bỏ qua rồi "code theo cảm giác".

## Trình tự

1. **Phân tích, chưa code.** Nói ra: số này từ đâu · ai sinh · kỳ nào · sửa
   đụng file nào.
2. **Xác minh bằng lệnh**, không bằng suy đoán:
   ```bash
   grep -rn "<tên hàm>" src/ scripts/
   npm test
   node --experimental-strip-types scripts/scan.ts --limit 20
   ```
3. **Bốn câu** ở §6 của skill.
4. **Code từng lát mỏng.**
5. **Chạy thật**: `npm test` + `npm run typecheck`. Đụng scanner thì chạy
   `--limit 20` và đọc output.

## Luật cứng

1. Thiếu dữ liệu → `null` xuyên suốt. **Cấm** `0`, `?? 0`, `|| 0` để lấp.
2. Fetch hỏng → bỏ và **đếm vào `failures`**. Không suy ra, không im lặng.
3. **Cộng theo ngày, không theo vị trí mảng.** Dùng `alignToWeeks`.
4. Mọi tổng kèm **số phần tử đóng góp**.
5. `sumOrNull` — tổng của toàn null là null.
6. Đổi đơn vị phải tường minh, và phải có **một đường tính khác** để đối chiếu
   cùng bậc độ lớn. Sai bậc đơn vị không làm đổi thứ hạng nên mắt không bắt được.
7. Không nhúng bảng ngày nghỉ lễ. Hỏi "nguồn có trả kỳ mới không".
8. Không thêm dependency khi chưa hỏi. **Không thêm thư viện đọc Excel** —
   `scripts/xlsx_reader.py` đọc cả .xls lẫn .xlsx bằng stdlib.
9. Thêm/đổi hành vi thì **thêm test**. Test không gọi mạng.
10. Cấm sinh chuỗi khuyến nghị mua/bán, cấm 買い推奨 / だろう.
11. **Đụng tới Jev** (`jev.ts`, `jev-questions.json`, `build_fx_roles.py`) thì đọc
    CLAUDE.md §7 trước. Ba điều hay quên nhất:
    - Jev **không chạm số** — nó không phải máy tính, và đã đo là yếu ở đếm/so
      số/đọc ngày. Mọi phép cộng yen ở lại trong TS.
    - Câu hỏi nằm ở `jev-questions.json`, **một bản duy nhất** cho cả Python lẫn
      TS. Đừng chép sang chỗ thứ hai.
    - Mọi câu `choice` phải có `none_of_these`; mọi so ngưỡng phải qua `gap()`.
    Đổi chữ trong câu hỏi = đổi ý nghĩa → chạy lại `npm run test:model` VÀ sinh
    lại `fx-roles.ts`.

## Khi không chắc

Dừng và hỏi. Không đoán công thức, không đoán ý nghĩa một trường, không "sửa"
dữ liệu nguồn trông bất thường — gắn nhãn và báo.

## Báo cáo

≤10 dòng: sửa file nào · test/typecheck ra sao · phần nào chưa chắc · phần nào
cố ý bỏ qua và vì sao.
