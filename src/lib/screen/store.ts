/* Lớp lưu trữ kết quả quét tuần.
 *
 * Hiện đọc JSON commit trong repo. Interface cố tình giữ đúng hình dạng mà một
 * bảng DB sẽ có (`latestFlowRun`, `flowStocksForRun`) để sau này thêm Neon chỉ
 * là thay implementation, không viết lại chỗ gọi.
 *
 * VÌ SAO JSON TRƯỚC: dữ liệu là ảnh chụp tuần, một hàng mỗi lần quét, chỉ đọc.
 * DB cho thứ đó là chi phí vận hành (credential, migration, kết nối lạnh) đổi
 * lấy một tính năng chưa cần. Khi nào có nhu cầu thật — lịch sử dài, truy vấn
 * chéo tuần — thì đổi. Chỗ đổi đã khoanh sẵn ở đây.
 *
 * KHÔNG BỊA: file thiếu / hỏng / sai hình dạng đều trả null. Không có "giá trị
 * mặc định" nào ở tầng này; một run rỗng phải hiện ra là rỗng.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { StockMeta } from "./flow.ts";

/** Một lần quét. Trùng hình dạng bảng `flow_runs` sẽ có. */
export type FlowRun = {
  id: string;
  /** Thời điểm quét, ISO. Khác với tuần của dữ liệu. */
  scannedAt: string;
  /** Tuần gần nhất trong dữ liệu — đây mới là "as of". */
  latestWeek: string | null;
  weeks: string[];
  /** Số mã trong universe khi quét. */
  universeCount: number;
  /** Số mã thực sự lấy được chuỗi tuần. */
  fetchedCount: number;
  /** Mã lấy không được, kèm lý do — công bố chứ không nuốt. */
  failures: Array<{ code: string; reason: string }>;
  notes: string;
  /** Payload tuần, JSON chuỗi (giống cột weekly_json). */
  weeklyJson: string;
};

const DATA = path.join(process.cwd(), "data", "flow-latest.json");

let cache: { at: number; run: FlowRun | null } | null = null;
const TTL_MS = 60_000;

export function resetStoreCache(): void {
  cache = null;
}

/** Lần quét gần nhất. null nếu chưa từng quét hoặc file hỏng. */
export async function latestFlowRun(now = Date.now()): Promise<FlowRun | null> {
  if (cache && now - cache.at < TTL_MS) return cache.run;
  let run: FlowRun | null = null;
  try {
    const raw = await readFile(DATA, "utf8");
    const j = JSON.parse(raw) as Partial<FlowRun>;
    /* Kiểm hình dạng tối thiểu. Thiếu thì coi như không có run — thà trang nói
       "chưa có chuỗi tuần" còn hơn render một run méo.

       `universeCount` / `fetchedCount` / `scannedAt` NẰM TRONG danh sách bắt
       buộc, không được mặc định. Bản trước dùng `?? 0` và `?? ""`: file thiếu
       trường thì trang vẫn dựng, nhưng độ phủ hiện "0/0 mã" và kỳ dữ liệu hiện
       trống — hai khẳng định sai từ một schema gãy. `pillar_guard.py` bắt được.
       Ba trường này là cái làm cho mọi con số khác đọc được, nên thiếu chúng
       thì cả run không dùng được, chứ không phải "dùng tạm với số 0". */
    if (
      typeof j.id === "string" &&
      typeof j.weeklyJson === "string" &&
      Array.isArray(j.weeks) &&
      typeof j.scannedAt === "string" &&
      typeof j.universeCount === "number" &&
      typeof j.fetchedCount === "number"
    ) {
      run = {
        id: j.id,
        scannedAt: j.scannedAt,
        latestWeek: j.latestWeek ?? null,
        weeks: j.weeks,
        universeCount: j.universeCount,
        fetchedCount: j.fetchedCount,
        failures: Array.isArray(j.failures) ? j.failures : [],
        // pillar-ok: `notes` là chú thích mô tả, không phải số liệu. Rỗng thì
        // trang chỉ mất một dòng giải thích, không hiện con số nào sai.
        notes: j.notes ?? "",
        weeklyJson: j.weeklyJson,
      };
    }
  } catch {
    run = null;   // chưa quét lần nào, hoặc file hỏng — cả hai là "không có"
  }
  cache = { at: now, run };
  return run;
}

/**
 * Metadata các mã của một run.
 *
 * Lấy từ universe đã commit chứ không lưu lại trong file quét: universe là
 * nguồn sự thật về ngành/quy mô, và nhân đôi nó vào mỗi ảnh chụp tuần là mở
 * đường cho hai bản lệch nhau.
 */
export async function flowStocksForRun(_runId: string): Promise<StockMeta[]> {
  const { FLOW_UNIVERSE } = await import("./universe.ts");
  return FLOW_UNIVERSE.map((s) => ({
    code: s.code,
    nameJp: s.nameJp,
    sector: s.sector,
    scale: s.scale,
  }));
}

export type FlowRunSummary = {
  id: string;
  scannedAt: string;
  latestWeek: string | null;
  universeCount: number;
  fetchedCount: number;
  failureCount: number;
  notes: string;
};

export function summarizeRun(run: FlowRun): FlowRunSummary {
  return {
    id: run.id,
    scannedAt: run.scannedAt,
    latestWeek: run.latestWeek,
    universeCount: run.universeCount,
    fetchedCount: run.fetchedCount,
    failureCount: run.failures.length,
    notes: run.notes,
  };
}
