import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/* CHỈ liệt kê route đã tồn tại. Nav trỏ tới trang chưa dựng thì người dùng bấm
   vào và rơi vào 404 — tệ hơn là không có mục đó. `to` được kiểm kiểu theo
   routeTree.gen.ts, nên thêm mục sai đường dẫn sẽ đỏ ở `npm run typecheck`
   chứ không đợi tới lúc chạy.
   Header xếp dọc trên mobile để nhóm phải không đè lên nav — lỗi cũ ở ~390px. */
const NAV = [
  { to: "/", label: "Tổng quan" },
  { to: "/trade", label: "輸出入" },
  { to: "/flow", label: "Dòng tiền" },
  { to: "/rotation", label: "Từng tuần" },
  { to: "/agent", label: "Kiểm số" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-fg-subtle/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="font-display text-lg tracking-tight">KIYOHARA</Link>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Điều hướng chính">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm text-fg-muted hover:text-fg"
                activeProps={{ className: "text-fg" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-[11px] leading-relaxed text-fg-subtle">
        Dữ liệu chỉ để tham khảo và nghiên cứu. <b>Không phải khuyến nghị mua bán.</b>{" "}
        Dòng ròng là close×volume có dấu từ Yahoo — không phải 投資部門別 của JPX,
        không phải tiền về tài khoản doanh nghiệp.
      </footer>
    </div>
  );
}
