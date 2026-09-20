# .claude/agents/ — KIYOHARA

Ba agent, chia theo **thứ mỗi agent được phép làm hỏng**, không theo "loại
công việc". Agent đụng được dữ liệu tài chính thì mang bộ luật chống bịa số;
agent chỉ dựng giao diện thì không cần nhưng vẫn phải giữ `—`; agent rà soát
thì không có quyền ghi.

| Agent | Đụng gì | Quyền |
|---|---|---|
| `kiyohara-data` | `src/lib/screen/*`, `scripts/*` — công thức, scanner, universe | Read/Write/Bash |
| `kiyohara-ui` | `src/routes/*`, `src/components/*`, `src/styles.css` | Read/Write/Bash |
| `kiyohara-review` | không ghi gì | Read/Grep/Bash |

Cả ba **bắt buộc** gọi skill `kiyohara-engineering` ở bước 0. Thứ tự ưu tiên
chuẩn mực: `CLAUDE.md` (luật) > skill (kiến trúc hiện tại) > file này.

**Lưu ý**: sửa định nghĩa agent không có hiệu lực với phiên đang chạy. Phải mở
phiên mới.
