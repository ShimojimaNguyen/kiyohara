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
