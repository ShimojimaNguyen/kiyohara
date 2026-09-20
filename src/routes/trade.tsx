import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { FlowTabs } from "../components/flow-tabs.tsx";
import { Badge, Card, Kpi, Skeleton } from "../components/ui.tsx";
import { getTrade } from "../lib/screen/server.ts";
import { formatPct, formatRatioPct, formatShortDate, formatYenFlow, formatNumber } from "../lib/screen/format.ts";
import { BUCKET_LABEL, fxTone, yenLabel, type Bucket, type TradeView } from "../lib/screen/trade.ts";

export const Route = createFileRoute("/trade")({ component: TradePage });

/** Số mã hiển thị mỗi tab. Giữ trang nhẹ; số đầy đủ nằm ở đếm trên nhãn tab. */
const SLICE = 30;

function TradePage() {
  const q = useQuery({ queryKey: ["trade"], queryFn: () => getTrade() });
  const [tab, setTab] = useState<Bucket>("both_in");

  return (
    <>
      <p className="text-[11px] uppercase tracking-widest text-fg-subtle">Export · import · USDJPY</p>
      <h1 className="mt-1 font-display text-3xl">輸出入</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">
        Tuần này tiền có vào công ty qua xuất / nhập không. USDJPY Yahoo + dòng ròng TOPIX
        Core30/Large70/Mid400, cập nhật cùng lần quét tuần. Danh sách kèm lý do — không phải
        sổ 投資部門別, không suy ra doanh thu từng mã.
      </p>

      <div className="mt-4"><FlowTabs /></div>

      {q.isLoading ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}
        </div>
      ) : !q.data?.view ? (
        <Card className="mt-5 text-sm text-fg-muted">
          Chưa có chuỗi tuần. Chạy <code>npm run scan</code> để quét, rồi tải lại.
        </Card>
      ) : (
        <TradeBody view={q.data.view} run={q.data.run} snapshot={q.data.universeSnapshot} tab={tab} setTab={setTab} />
      )}
    </>
  );
}

function TradeBody({ view, run, snapshot, tab, setTab }: {
  view: TradeView;
  run: { latestWeek: string | null; scannedAt: string; universeCount: number; fetchedCount: number; failureCount: number; notes: string } | null;
  snapshot: string;
  tab: Bucket;
  setTab: (b: Bucket) => void;
}) {
  const ex = view.rows.find((r) => r.role === "export");
  const im = view.rows.find((r) => r.role === "import");
  const list = view.names.filter((n) => n.bucket === tab).slice(0, SLICE);
  const total = view.names.filter((n) => n.bucket === tab).length;

  return (
    <>
      {/* KPI — mỗi ô nói rõ đơn vị và phạm vi, không có số trần trụi */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="USDJPY"
          value={view.fxLatest ? formatNumber(view.fxLatest.close, 2) : "—"}
          hint={view.fxLatest ? `${formatPct(view.fxLatest.pct, 2)} · ${yenLabel(view.fit)}` : "取得不可"}
          tone={fxTone(view.fit)}
        />
        <Kpi label="輸出 今週" value={formatYenFlow(ex?.latestYen ?? null)} hint={`${ex?.count ?? 0} mã`} />
        <Kpi label="輸入 今週" value={formatYenFlow(im?.latestYen ?? null)} hint={`${im?.count ?? 0} mã`} />
        <Kpi
          label="両面で入った"
          value={String(view.counts.both_in)}
          hint={`${view.counts.market_in} chỉ thị trường · ${view.counts.trade_in} chỉ thương mại`}
        />
      </div>

      {/* Nguồn + kỳ dữ liệu + độ phủ. Không có khối này thì mọi số trên đây
          đều là số không rõ thuộc về tuần nào. */}
      <Card className="mt-3 text-[11px] leading-relaxed text-fg-muted">
        Tuần dữ liệu <b className="text-fg">{run?.latestWeek ?? "—"}</b>
        {" · "}quét lúc {run?.scannedAt ? run.scannedAt.slice(0, 16).replace("T", " ") : "—"}
        {" · "}universe JPX {snapshot || "—"}
        <br />
        Độ phủ: <b className="text-fg">{view.coverage.withLatest}/{view.coverage.inScope}</b> mã
        trong phạm vi 輸出入 có số tuần này ({formatRatioPct(view.coverage.pct)})
        {run && run.failureCount > 0 ? ` · ${run.failureCount} mã không lấy được chart` : ""}
        {" · "}{view.skipped} mã 対象外 (銀行・不動産…) đã loại, không gán vai trò.
      </Card>

      {/* Cách đọc — bốn giới hạn, đặt trước bảng chứ không giấu ở footer */}
      <Card className="mt-3">
        <h2 className="font-display text-lg">Cách đọc</h2>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-fg-muted">
          <li>· <b className="text-fg">円安 / 円高 là đẳng thức kế toán</b>, không phải dự báo giá:
            円安 thì doanh thu USD quy ra được nhiều yen hơn. Nó không nói cổ phiếu sẽ tăng.</li>
          <li>· <b className="text-fg">Dòng ròng ≠ tiền về tài khoản</b>. Đây là close×volume có dấu
            trên thị trường thứ cấp, không phải 投資部門別 và không phải dòng tiền doanh nghiệp.</li>
          <li>· <b className="text-fg">Phân loại theo 33業種</b>, không phải tỷ trọng doanh thu nước
            ngoài từng công ty. Một mã 電気機器 bán 100% nội địa vẫn bị xếp 輸出. 商社 chỉ là 卸売業
            nên lẫn tổng hợp thương xã với bán buôn thường.</li>
          <li>· Số lượng xuất/nhập theo tháng của 内閣府 nằm ở <b className="text-fg">月例</b>, không phải trang này.</li>
        </ul>
      </Card>

      <FxStrip view={view} />
      <Heatmap view={view} />

      {/* Doanh nghiệp · vì sao */}
      <div className="mt-5">
        <h2 className="font-display text-xl">Doanh nghiệp · vì sao</h2>
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setTab(b)}
              className={`flex h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${
                tab === b ? "bg-bg-elevated text-fg border border-fg-subtle/25" : "text-fg-muted hover:text-fg"
              }`}
            >
              {BUCKET_LABEL[b]} ({view.counts[b]})
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <Card className="mt-3 text-sm text-fg-muted">Không có mã nào trong nhóm này tuần nay.</Card>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {list.map((n) => (
              <Card key={n.code}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-lg">{n.code}</span>
                  <span className="text-sm text-fg">{n.nameJp}</span>
                  <span className="text-[11px] text-fg-subtle">{n.sector} · {n.scale}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={n.role === "import" ? "warn" : "good"}>{n.roleLabel}</Badge>
                  <Badge tone={n.tradeDir === "in" ? "good" : n.tradeDir === "out" ? "warn" : "neutral"}>
                    {n.tradeDir === "in" ? "貿易+" : n.tradeDir === "out" ? "貿易−" : "貿易?"}
                  </Badge>
                  <span className="text-sm text-fg">{formatYenFlow(n.flowYen)}</span>
                  <span className="text-[11px] text-fg-muted">{formatPct(n.returnPct)}</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-fg">{n.why}</p>
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-fg-subtle">
                  {n.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        )}
        {total > SLICE ? (
          <p className="mt-2 text-[11px] text-fg-subtle">
            Hiện {SLICE}/{total} mã của nhóm này.
          </p>
        ) : null}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-fg-subtle">
        商社 tuần này: {formatYenFlow(view.rows.find((r) => r.role === "trading")?.latestYen ?? null)}
        {" · "}{view.tradingCount} mã 卸売業. {run?.notes}
      </p>
    </>
  );
}

/** 5 tuần USDJPY. Bar tăng (円安) dùng màu down — ngược màu cổ phiếu, có chủ đích. */
function FxStrip({ view }: { view: TradeView }) {
  const weeks = (view.fx?.weeks ?? []).slice(-5);
  if (weeks.length === 0) {
    return (
      <Card className="mt-3 text-[12px] text-fg-muted">
        USDJPY: không lấy được từ Yahoo. 貿易キャッシュ để trống thay vì đoán.
      </Card>
    );
  }
  const max = Math.max(...weeks.map((w) => Math.abs(w.prevClose ? w.close - w.prevClose : 0)), 0.01);
  return (
    <Card className="mt-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg">USDJPY · 5 tuần</h2>
        <span className="text-[11px] text-fg-subtle">bar lên = 円安 (màu đỏ), xuống = 円高 (màu xanh)</span>
      </div>
      <div className="mt-3 flex items-end gap-2">
        {weeks.map((w) => {
          const d = w.prevClose ? w.close - w.prevClose : 0;
          const h = Math.max(4, (Math.abs(d) / max) * 48);
          return (
            <div key={w.date} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-sm ${d > 0 ? "bg-down" : d < 0 ? "bg-up" : "bg-fg-subtle/40"}`}
                style={{ height: `${h}px` }}
              />
              <span className="text-[10px] text-fg-subtle">{formatShortDate(w.date)}</span>
              <span className="text-[10px] text-fg-muted">{formatNumber(w.close, 2)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function heatClass(v: number | null, scale: number): string {
  if (v === null) return "bg-transparent text-fg-subtle";
  const r = Math.abs(v) / (scale || 1);
  const strength = r > 0.66 ? "/30" : r > 0.33 ? "/20" : "/10";
  return v > 0 ? `bg-up${strength}` : v < 0 ? `bg-down${strength}` : "bg-fg-subtle/10";
}

function Heatmap({ view }: { view: TradeView }) {
  const all = view.rows.flatMap((r) => r.weekly.filter((v): v is number => v !== null).map(Math.abs));
  const scale = all.length ? Math.max(...all) : 1;
  return (
    <Card className="mt-3">
      <h2 className="font-display text-lg">Dòng ròng theo nhóm</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[640px] w-full border-collapse text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
              <th className="p-2 text-left font-semibold">Nhóm</th>
              {view.weeks.map((w, i) => (
                <th key={w} className="p-2 text-right font-semibold">
                  {i === view.weeks.length - 1 ? "Tuần này" : formatShortDate(w)}
                </th>
              ))}
              <th className="p-2 text-right font-semibold">Cả tháng</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.role} className="border-t border-fg-subtle/15">
                <td className="p-2 whitespace-nowrap">
                  {r.label}
                  <span className="ml-1 text-[11px] text-fg-subtle">{r.count} mã</span>
                </td>
                {r.weekly.map((v, i) => (
                  <td
                    key={i}
                    className={`p-2 text-right tabular-nums ${heatClass(v, scale)}`}
                    title={`${r.contributors[i]}/${r.count} mã có số tuần này`}
                  >
                    {formatYenFlow(v)}
                  </td>
                ))}
                <td className="p-2 text-right font-semibold tabular-nums">{formatYenFlow(r.monthYen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-fg-subtle">
        Di chuột lên ô để xem tuần đó được cộng từ bao nhiêu mã — tổng của 40/50 mã
        và 50/50 mã nhìn con số thì không phân biệt được.
      </p>
    </Card>
  );
}
