/* Server functions. Chạy phía server, client chỉ gọi qua RPC.
 *
 * QUY TẮC: hàm ở đây chỉ ĐỌC kết quả đã quét + 1 request FX. KHÔNG được gọi
 * việc quét 492 mã (~2,5 phút) từ đây — không nền serverless nào cho một HTTP
 * request sống lâu vậy, và có cho thì cũng sai chỗ. Quét thuộc về GitHub
 * Actions (`npm run scan`).
 */

import { createServerFn } from "@tanstack/react-start";

import { buildTradeView, fetchUsdJpyWeekly, type TradeView, type FxPack } from "./trade.ts";
import { expandWeekly, parseWeeklyPayload, type WeeklyPack } from "./flow.ts";
import { latestFlowRun, flowStocksForRun, summarizeRun, type FlowRunSummary } from "./store.ts";

export type TradePayload = {
  run: FlowRunSummary | null;
  weekly: WeeklyPack | null;
  fx: FxPack | null;
  view: TradeView | null;
  /** Ảnh chụp universe JPX — để trang nói được danh sách mã cũ tới đâu. */
  universeSnapshot: string;
};

export const getTrade = createServerFn({ method: "GET" }).handler(async (): Promise<TradePayload> => {
  const { UNIVERSE_SNAPSHOT } = await import("./universe.ts");

  // FX lấy song song với việc đọc file, và hỏng thì trả null — trang vẫn dựng
  // được phần 市場資金, chỉ là không phán được 貿易キャッシュ.
  const [run, fx] = await Promise.all([latestFlowRun(), fetchUsdJpyWeekly()]);

  if (!run) {
    return { run: null, weekly: null, fx, view: null, universeSnapshot: UNIVERSE_SNAPSHOT };
  }

  const stocks = await flowStocksForRun(run.id);
  const weekly = expandWeekly(parseWeeklyPayload(run.weeklyJson), stocks);
  const view = weekly ? buildTradeView({ weekly, fx }) : null;

  return { run: summarizeRun(run), weekly, fx, view, universeSnapshot: UNIVERSE_SNAPSHOT };
});

// ---------------------------------------------------------------- 検算

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  checkRunTotals, checkWeeklyPoint, checkSnapshot, rollup, verdict,
  type Check, type Rollup,
} from "./integrity.ts";

export type AgentPayload = {
  run: FlowRunSummary | null;
  rollup: Rollup;
  verdict: string;
  /** Chỉ những mục LỆCH — danh sách 6.915 mục khớp không giúp ai. */
  mismatches: Check[];
  /** Lý do → số mục, để thấy khoảng trống có hệ thống hay ngẫu nhiên. */
  unverifiableByReason: Array<{ why: string; n: number }>;
  /** Nguồn snapshot định giá đã dùng; `null` khi chưa có. */
  snapshotSource: string | null;
  snapshotCount: number;
};

/**
 * Tính LẠI mọi con số từ dữ liệu thô rồi so với số hệ thống công bố.
 *
 * Không đọc kết quả kiểm của scanner — nếu dùng lại phép tính của nó thì đây
 * không còn là đường tính thứ hai nữa, chỉ là tiếng vọng.
 */
export const getAgent = createServerFn({ method: "GET" }).handler(
  async (): Promise<AgentPayload> => {
    const run = await latestFlowRun();
    const empty: Rollup = { ok: 0, mismatch: 0, unverifiable: 0, total: 0 };
    if (!run) {
      return { run: null, rollup: empty, verdict: "chưa có lần quét nào",
               mismatches: [], unverifiableByReason: [],
               snapshotSource: null, snapshotCount: 0 };
    }

    const parsed = parseWeeklyPayload(run.weeklyJson);
    const checks: Check[] = [];
    if (parsed) {
      checks.push(...checkRunTotals(run, parsed.byCode));
      for (const [code, pts] of Object.entries(parsed.byCode)) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p) checks.push(...checkWeeklyPoint(code, p, i > 0 ? pts[i - 1] : null));
        }
      }
    }

    // Snapshot định giá là tuỳ chọn: nguồn Yahoo JP chặn quét hàng loạt nên
    // artifact production có thể chưa tồn tại. Thiếu thì bỏ qua, KHÔNG bịa.
    let snapshotSource: string | null = null;
    let snapshotCount = 0;
    for (const f of ["snapshots-latest.json", "snapshots-sample.json"]) {
      try {
        const raw = await readFile(path.join(process.cwd(), "data", f), "utf8");
        const j = JSON.parse(raw) as { source?: string; snapshots?: unknown[] };
        const list = Array.isArray(j.snapshots) ? j.snapshots : [];
        for (const s of list) checks.push(...checkSnapshot(s as never));
        snapshotSource = `${f}${f.includes("sample") ? " (MẪU, không phải bản đầy đủ)" : ""}`;
        snapshotCount = list.length;
        break;
      } catch { /* không có file — bình thường */ }
    }

    const r = rollup(checks);
    const byReason = new Map<string, number>();
    for (const c of checks) {
      if (c.state === "unverifiable" && c.why) {
        byReason.set(c.why, (byReason.get(c.why) ?? 0) + 1);
      }
    }

    return {
      run: summarizeRun(run),
      rollup: r,
      verdict: verdict(r),
      mismatches: checks.filter((c) => c.state === "mismatch").slice(0, 100),
      unverifiableByReason: [...byReason.entries()]
        .map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n),
      snapshotSource,
      snapshotCount,
    };
  },
);
