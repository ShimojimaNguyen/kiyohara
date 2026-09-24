/* Quét dòng ròng tuần cho toàn universe → data/flow-latest.json
 *
 * Chạy:  npm run scan
 *        node --experimental-strip-types scripts/scan.ts --limit 20   (thử nhanh)
 *
 * VÌ SAO CHẠY Ở ĐÂY CHỨ KHÔNG PHẢI TRONG REQUEST
 * ----------------------------------------------
 * 492 mã × 1 request Yahoo ≈ 4,7 phút (đo thật). Không nền serverless nào cho
 * một HTTP request sống lâu vậy — Vercel Hobby 10s, Workers 30s CPU. Nên việc
 * này thuộc về job nền (GitHub Actions), và app chỉ đọc kết quả.
 *
 * CÁC CỔNG CHỐNG SỐ BỊA
 * ---------------------
 * 1. Mã không lấy được chart → BỎ và ghi vào `failures` kèm lý do. Không suy
 *    ra, không để 0. Một mã "dòng ròng 0 vì fetch hỏng" sẽ lẫn vào nhóm đứng
 *    yên thật.
 * 2. Mọi chuỗi được CĂN về một lưới tuần chung theo ngày (alignToWeeks). Cộng
 *    theo vị trí mảng sẽ trộn tuần của mã này với tuần của mã khác — tổng vẫn
 *    ra số hợp lý nên không ai thấy.
 * 3. Độ phủ được ghi vào file (`universeCount` / `fetchedCount` / `failures`).
 *    Tổng của 300/492 mã khác tổng của 492/492, mà nhìn con số yen thì không
 *    phân biệt được.
 * 4. Phủ dưới MIN_COVERAGE_PCT → KHÔNG ghi đè file cũ. Thà giữ tuần trước
 *    (có nhãn cũ) còn hơn công bố một tổng thiếu mã như thể đủ.
 * 5. Tổng turnover tuần phải nằm trong dải hợp lý (xem GROSS_*). Sai bậc đơn
 *    vị — ×1000 hay ÷1000 — KHÔNG làm đổi thứ hạng, nên nhìn danh sách không
 *    phát hiện được; chỉ có phép so với một đường tính bên ngoài mới bắt được.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { FLOW_UNIVERSE, UNIVERSE_SNAPSHOT } from "../src/lib/screen/universe.ts";
import {
  alignToWeeks, completedWeekly, toWeeklyPoints,
  type WeeklyBar, type WeeklyPoint,
} from "../src/lib/screen/flow.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CHART = (code: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?interval=1wk&range=6mo`;

/** Số tuần giữ lại trong payload. Spec dùng 4 tuần cho /trade và /rotation. */
const KEEP_WEEKS = 4;
/** Nghỉ giữa các request. Yahoo không khai crawl-delay; đây là phép lịch sự. */
const PAUSE_MS = 120;
/** Dưới mức này thì tổng ngành thiếu quá nhiều mã để gọi là "toàn universe". */
const MIN_COVERAGE_PCT = 80;

/* DẢI HỢP LÝ CỦA TỔNG TURNOVER TUẦN (gross, không dấu) — cổng chống sai bậc.
 *
 * Đo thật ngày 2026-09-21 để đặt mốc:
 *   · 492 mã universe, tuần 2026-09-13: gross = 37,1兆円 (≈ 7,4兆円/phiên)
 *   · đối chiếu 売買代金 công bố (Yahoo JP ranking 売買代金上位, phiên 2026-09-18):
 *       toàn thị trường 4.287 mã ≈ 10兆円/phiên; #1 là 285A キオクシア 1,82兆円
 *     → universe chiếm ~74% toàn thị trường. Đúng bậc cho 492 mã lớn nhất.
 *
 * Dải dưới đây rộng gấp ~5 lần mỗi phía so với mốc đó: nó KHÔNG nhằm bắt biến
 * động thị trường, chỉ nhằm bắt lỗi ×1000 / ÷1000 và lỗi đổi đơn vị.
 * Đường đối chiếu ngoài: https://finance.yahoo.co.jp/stocks/ranking/tradingValueHigh?market=all
 */
const GROSS_MIN_YEN = 5e12; //  5兆円/tuần — thấp hơn nữa nghĩa là mất phần lớn mã
const GROSS_MAX_YEN = 200e12; // 200兆円/tuần — cao hơn nữa thì vượt cả thị trường

const OUT = path.join(process.cwd(), "data", "flow-latest.json");
/* Chế độ thử (--limit N) KHÔNG được chạm vào file production.
   Quét 20 mã vẫn cho coverage 20/20 = 100%, nên nó lọt qua mọi cổng và ghi đè
   một bảng 492 mã bằng một bảng 20 mã — độ phủ trong file vẫn ghi "100%". */
const OUT_SAMPLE = path.join(process.cwd(), "data", "flow-sample.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[scan] ${m}`);

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
};

async function fetchBars(code: string): Promise<{ bars: WeeklyBar[] } | { error: string }> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(CHART(code), { headers: { "User-Agent": UA }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const j = (await res.json()) as YahooChart;
    if (j.chart?.error) return { error: j.chart.error.description ?? "chart error" };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    const closes = q?.close ?? [];
    const vols = q?.volume ?? [];
    const bars: WeeklyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      const v = vols[i];
      // close null = tuần không giao dịch. Bỏ hẳn chứ không nội suy.
      if (typeof c !== "number" || typeof v !== "number") continue;
      bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c, volume: v });
    }
    if (bars.length < 2) return { error: `chỉ ${bars.length} bar` };
    return { bars };
  } catch (e) {
    return { error: e instanceof Error ? e.name : "unknown" };
  }
}

/**
 * Lưới tuần chung = các ngày xuất hiện ở NHIỀU mã nhất, lấy KEEP_WEEKS tuần cuối.
 *
 * Không lấy lưới của một mã bất kỳ: mã đó có thể nghỉ giao dịch một tuần và
 * kéo cả bảng lệch theo. Lấy theo số phiếu thì lưới phản ánh lịch chung.
 */
function canonicalWeeks(allDates: string[][], keep: number): string[] {
  const votes = new Map<string, number>();
  // pillar-ok: khởi tạo bộ đếm. Ngày chưa thấy lần nào thì đếm = 0 là đúng nghĩa.
  for (const ds of allDates) for (const d of ds) votes.set(d, (votes.get(d) ?? 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  if (ranked.length === 0) return [];
  // Giữ những ngày được ít nhất 20% số mã ghi nhận, rồi lấy `keep` ngày mới nhất.
  const quorum = Math.max(1, Math.floor(allDates.length * 0.2));
  const kept = ranked.filter(([, n]) => n >= quorum).map(([d]) => d).sort();
  return kept.slice(-keep);
}

async function main(): Promise<number> {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;
  const universe = limit > 0 ? FLOW_UNIVERSE.slice(0, limit) : FLOW_UNIVERSE;

  log(`universe ${universe.length} mã (ảnh chụp JPX ${UNIVERSE_SNAPSHOT || "?"})`);
  const t0 = Date.now();

  const series = new Map<string, WeeklyPoint[]>();
  const failures: Array<{ code: string; reason: string }> = [];

  for (let i = 0; i < universe.length; i++) {
    const s = universe[i];
    const got = await fetchBars(s.code);
    if ("error" in got) {
      failures.push({ code: s.code, reason: got.error });
    } else {
      const done = completedWeekly(got.bars);
      if (done.length < 2) {
        failures.push({ code: s.code, reason: `sau khi bỏ tuần dở còn ${done.length} bar` });
      } else {
        series.set(s.code, toWeeklyPoints(done));
      }
    }
    if ((i + 1) % 50 === 0) {
      log(`${i + 1}/${universe.length} · lấy được ${series.size} · lỗi ${failures.length}`);
    }
    if (i < universe.length - 1) await sleep(PAUSE_MS);
  }

  const weeks = canonicalWeeks([...series.values()].map((p) => p.map((x) => x.date)), KEEP_WEEKS);
  if (weeks.length === 0) {
    log("không dựng được lưới tuần — không ghi gì");
    return 1;
  }

  const byCode: Record<string, (WeeklyPoint | null)[]> = {};
  for (const [code, pts] of series) byCode[code] = alignToWeeks(pts, weeks);

  const coverage = (series.size / universe.length) * 100;
  const latestWeek = weeks[weeks.length - 1];
  const withLatest = Object.values(byCode).filter((p) => p[p.length - 1]?.signedFlowYen != null).length;

  log(`lưới tuần: ${weeks.join(" · ")}`);
  log(`độ phủ: ${series.size}/${universe.length} mã (${coverage.toFixed(1)}%), ` +
      `tuần cuối có số: ${withLatest}`);
  if (failures.length) {
    const top = failures.slice(0, 5).map((f) => `${f.code}(${f.reason})`).join(", ");
    log(`lỗi ${failures.length} mã: ${top}${failures.length > 5 ? " …" : ""}`);
  }

  if (coverage < MIN_COVERAGE_PCT) {
    log(`độ phủ dưới ${MIN_COVERAGE_PCT}% — KHÔNG ghi đè. Giữ lần quét trước còn hơn ` +
        "công bố tổng thiếu mã như thể đủ.");
    return 1;
  }

  /* Cổng bậc độ lớn. `turnoverYen` = close × volume của tuần cuối, cộng gộp
     không dấu. Kèm 5 mã lớn nhất vào output để đối chiếu bằng mắt với bảng
     売買代金上位 công khai — một dòng số trong file kiểm được, hơn một lời hứa. */
  const lastCol = (p: (WeeklyPoint | null)[]) => p[p.length - 1];
  // pillar-ok: đây là tổng GỘP để đối chiếu bậc độ lớn, và số mã đóng góp đã
  // được công bố riêng qua `fetchedCount`/`failures`. Mã không có bar tuần cuối
  // đóng góp 0 vào tổng gộp là đúng nghĩa — khác với dòng ròng CÓ DẤU, nơi
  // null phải lan ra null (xem `sumOrNull` trong flow.ts).
  const grossTurnoverYen = Object.values(byCode)
    .reduce((s, p) => s + (lastCol(p)?.turnoverYen ?? 0), 0);
  // pillar-ok: như trên — xếp hạng theo turnover gộp, mã thiếu bar đứng cuối.
  const topTurnover = Object.entries(byCode)
    .map(([code, p]) => ({ code, turnoverYen: lastCol(p)?.turnoverYen ?? 0 }))
    .sort((a, b) => b.turnoverYen - a.turnoverYen)
    .slice(0, 5);

  log(`gross turnover tuần cuối: ${(grossTurnoverYen / 1e12).toFixed(1)}兆円 ` +
      `(≈ ${(grossTurnoverYen / 5 / 1e12).toFixed(1)}兆円/phiên) · lớn nhất ` +
      topTurnover.map((t) => `${t.code} ${(t.turnoverYen / 1e12).toFixed(2)}兆`).join(", "));

  // Dải gross được hiệu chuẩn cho universe đầy đủ; chế độ thử đương nhiên thấp hơn.
  if (!limit && (grossTurnoverYen < GROSS_MIN_YEN || grossTurnoverYen > GROSS_MAX_YEN)) {
    log(`gross ${(grossTurnoverYen / 1e12).toFixed(1)}兆円 nằm ngoài dải hợp lý ` +
        `[${GROSS_MIN_YEN / 1e12}兆, ${GROSS_MAX_YEN / 1e12}兆]/tuần — KHÔNG ghi. ` +
        "Nhiều khả năng sai bậc đơn vị hoặc nguồn đổi hình dạng dữ liệu, " +
        "không phải thị trường biến động. Đối chiếu 売買代金上位 của Yahoo JP trước khi nới dải.");
    return 1;
  }

  const out = limit ? OUT_SAMPLE : OUT;

  // Không ghi đè bằng dữ liệu CŨ HƠN. Nguồn trục trặc trả về tuần cũ thì giữ nguyên.
  try {
    const prev = JSON.parse(await readFile(out, "utf8")) as { latestWeek?: string };
    if (prev.latestWeek && latestWeek < prev.latestWeek) {
      log(`tuần lấy được (${latestWeek}) cũ hơn lần trước (${prev.latestWeek}) — không ghi đè`);
      return 1;
    }
  } catch { /* chưa có file — bình thường ở lần quét đầu */ }

  const run = {
    id: `${latestWeek}-${Date.now().toString(36)}`,
    scannedAt: new Date().toISOString(),
    latestWeek,
    weeks,
    universeCount: universe.length,
    fetchedCount: series.size,
    failures,
    grossTurnoverYen,
    topTurnover,
    notes:
      `Yahoo weekly chart, ${KEEP_WEEKS} tuần đã hoàn tất. Universe = TOPIX ` +
      `Core30/Large70/Mid400 (JPX ${UNIVERSE_SNAPSHOT}), KHÔNG phải toàn bộ mã niêm yết. ` +
      `Dòng ròng = close×volume có dấu, không phải 投資部門別.`,
    weeklyJson: JSON.stringify({ weeks, byCode }),
  };

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(run, null, 2) + "\n", "utf8");
  log(`ghi ${path.relative(process.cwd(), out)} · ${((Date.now() - t0) / 1000).toFixed(0)}s` +
      (limit ? "  (chế độ thử — KHÔNG đụng flow-latest.json)" : ""));
  return 0;
}

main().then((c) => process.exit(c));
