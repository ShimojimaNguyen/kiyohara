import type { ReactNode } from "react";

/* Component nền. Cố ý ít và nhạt — mọi màu đi qua token trong styles.css. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-fg-subtle/20 bg-surface p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "neutral" }) {
  const cls =
    tone === "good" ? "bg-up/15 text-up"
    : tone === "warn" ? "bg-warn/15 text-warn"
    : "bg-fg-subtle/15 text-fg-muted";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function Button({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-11 rounded-lg border border-fg-subtle/30 bg-bg-elevated px-4 text-sm font-semibold
                 text-fg hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Skeleton({ className = "h-28" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface ${className}`} />;
}

/**
 * KPI. `value` đã là chuỗi đã định dạng — component không tự đổi số thành chữ,
 * để mọi quy ước định dạng nằm một chỗ (format.ts).
 * `tone` theo HƯỚNG SỐ, không theo tốt/xấu.
 */
export function Kpi({ label, value, hint, tone = "flat" }: {
  label: string; value: string; hint?: string; tone?: "up" | "down" | "flat";
}) {
  const cls = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-fg";
  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={`mt-1 font-display text-2xl leading-tight ${cls}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-fg-muted">{hint}</div> : null}
    </Card>
  );
}
