import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card, Kpi, Skeleton } from "../components/ui.tsx";
import { getAgent } from "../lib/screen/server.ts";
import { formatNumber, formatShortDate } from "../lib/screen/format.ts";

export const Route = createFileRoute("/agent")({ component: AgentPage });

function AgentPage() {
  const q = useQuery({ queryKey: ["agent"], queryFn: () => getAgent() });
  const d = q.data;

  return (
    <>
      <p className="text-[11px] uppercase tracking-widest text-fg-subtle">Integrity · 検算</p>
      <h1 className="mt-1 font-display text-3xl">Kiểm số</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">
        Tính lại mọi con số từ dữ liệu thô rồi so với số hệ thống đang công bố —
        <code className="mx-1">turnover = close × volume</code>,
        <code className="mx-1">PER = giá / EPS</code>, dấu dòng ròng, các tổng của
        lần quét. Trang này <b>không</b> dùng lại phép tính của scanner; nếu dùng
        thì nó chỉ là tiếng vọng, không phải đường tính thứ hai.
      </p>

      {q.isLoading ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}
        </div>
      ) : !d || d.rollup.total === 0 ? (
        <Card className="mt-5 text-sm text-fg-muted">
          Chưa có gì để kiểm. Chạy <code>npm run scan</code> trước.
        </Card>
      ) : (
        <Body d={d} />
      )}
    </>
  );
}

function Body({ d }: { d: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof getAgent>>>>["data"]> }) {
  const r = d.rollup;
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Khớp" value={formatNumber(r.ok, 0)} hint={`trên ${formatNumber(r.total, 0)} phép kiểm`} />
        {/* Tone theo HƯỚNG SỐ: lệch > 0 là xấu, nên down. 0 lệch không tô xanh
            rực — "không tìm thấy lỗi" khác "không có lỗi". */}
        <Kpi label="LỆCH" value={formatNumber(r.mismatch, 0)}
             tone={r.mismatch > 0 ? "down" : "flat"}
             hint={r.mismatch > 0 ? "có lỗi thật ở đâu đó" : "không phát hiện lệch"} />
        <Kpi label="Không kiểm được" value={formatNumber(r.unverifiable, 0)}
             tone={r.unverifiable > 0 ? "flat" : "flat"}
             hint="thiếu dữ liệu thô để tính lại" />
        <Kpi label="Tuần dữ liệu" value={d.run?.latestWeek ? formatShortDate(d.run.latestWeek) : "—"}
             hint={d.run ? `quét ${d.run.scannedAt.slice(0, 16).replace("T", " ")}` : "—"} />
      </div>

      <Card className="mt-4 text-sm">
        <b>{d.verdict}</b>
        <p className="mt-2 text-fg-muted">
          Nguồn: <code>data/flow-latest.json</code>
          {d.snapshotSource ? <> · <code>data/{d.snapshotSource}</code> ({d.snapshotCount} mã)</> : null}
          {!d.snapshotSource ? (
            <> · <b>chưa có snapshot định giá</b> nên PER/PBR không được kiểm —
              nguồn Yahoo JP chặn quét hàng loạt, xem skill <code>market-data-sources</code>.</>
          ) : null}
        </p>
      </Card>

      {d.mismatches.length > 0 ? (
        <Card className="mt-4">
          <h2 className="font-display text-lg text-down">
            {formatNumber(r.mismatch, 0)} phép kiểm LỆCH
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            Không tự sửa. Lệch có thể do công thức, do nguồn đổi bố cục, hoặc do
            chính trang này hiểu sai công thức — đọc từng dòng rồi quyết.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="py-1 pr-3">Mã</th>
                  <th className="py-1 pr-3">Phép kiểm</th>
                  <th className="py-1 pr-3 text-right">Công bố</th>
                  <th className="py-1 pr-3 text-right">Tính lại</th>
                  <th className="py-1 text-right">Lệch</th>
                </tr>
              </thead>
              <tbody>
                {d.mismatches.map((c, i) => (
                  <tr key={i} className="border-t border-fg-subtle/10">
                    <td className="py-1 pr-3 font-mono text-xs">{c.code ?? "—"}</td>
                    <td className="py-1 pr-3">{c.name}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatNumber(c.claimed)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatNumber(c.recomputed)}</td>
                    <td className="py-1 text-right tabular-nums text-down">
                      {c.gapPct == null ? "—" : `${formatNumber(c.gapPct, 2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {d.unverifiableByReason.length > 0 ? (
        <Card className="mt-4">
          <h2 className="font-display text-lg">Không kiểm được — vì sao</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Đây <b>không phải</b> lỗi. Nhưng cũng không phải "khớp": một bảng gộp
            hai thứ đó lại sẽ xanh giả. Lý do có hệ thống thì khoảng trống là đã
            hiểu; lý do vụn vặt mỗi thứ một ít mới là dấu hiệu nguồn đang hỏng dần.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {d.unverifiableByReason.map((u, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 text-right tabular-nums text-fg-muted">
                  {formatNumber(u.n, 0)}
                </span>
                <span>{u.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
