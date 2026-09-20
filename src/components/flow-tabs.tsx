import { Link } from "@tanstack/react-router";

/* Ba bề mặt dòng tiền. Giữ trong tab chứ không thêm nav thứ 6 trên header. */
const TABS = [
  { to: "/flow", label: "So sánh 4 tuần" },
  { to: "/rotation", label: "Từng tuần" },
  { to: "/trade", label: "輸出入" },
] as const;

export function FlowTabs() {
  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Dòng tiền">
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className="flex h-11 items-center whitespace-nowrap rounded-lg px-4 text-sm font-semibold
                     text-fg-muted hover:text-fg"
          activeProps={{ className: "bg-bg-elevated text-fg border border-fg-subtle/25" }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
