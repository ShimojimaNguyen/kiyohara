/* 輸出入 — tiền vào doanh nghiệp qua xuất/nhập, nhìn từ tỷ giá và dòng ròng tuần.
 *
 * PHẠM VI, nói trước để không ai đọc quá tay:
 *
 *   - Phân loại 輸出/輸入 là **sector map** theo 33業種 của JPX, KHÔNG phải tỷ
 *     trọng doanh thu nước ngoài đọc từ IR từng công ty. Một mã 電気機器 bán
 *     100% nội địa vẫn bị xếp 輸出. Đây là giới hạn của phương pháp, phải ghi
 *     trong なぜ chứ không giấu.
 *   - 貿易キャッシュ là **đẳng thức kế toán**, không phải dự báo: 円安 thì doanh
 *     thu USD quy ra được nhiều yen hơn. Nó không nói cổ phiếu sẽ tăng.
 *   - 市場資金 là close×volume có dấu, KHÔNG phải 投資部門別 của JPX.
 *   - Không có chỗ nào ở đây là khuyến nghị mua bán.
 */

import { completedFxWeekly, sumOrNull, type WeeklyBar, type WeeklyPack } from "./flow.ts";
import { formatYenFlow, formatPct } from "./format.ts";

// ---------------------------------------------------------------- phân loại

export type TradeRole = "export" | "import" | "trading" | "neutral";

/** Nhận USD dễ hơn khi bán ra nước ngoài. */
const EXPORT_SECTORS = new Set([
  "輸送用機器", "電気機器", "機械", "精密機器", "鉄鋼",
  "非鉄金属", "化学", "ゴム製品", "海運業", "繊維製品", "医薬品",
]);

/** Trả USD dễ hơn khi mua nguyên liệu / nhiên liệu. */
const IMPORT_SECTORS = new Set([
  "石油・石炭製品", "電気・ガス業", "空運業", "小売業",
  "食料品", "水産・農林業", "鉱業",
]);

/**
 * 商社 chỉ gồm 卸売業.
 *
 * GIỚI HẠN: 33業種 không tách tổng hợp thương xã (三菱商事, 三井物産…) khỏi bán
 * buôn thường. Cả hai cùng nằm 卸売業, nên nhóm này lẫn. Ghi trong なぜ.
 */
const TRADING_SECTORS = new Set(["卸売業"]);

export function tradeRole(sector: string | null | undefined): TradeRole {
  const s = (sector ?? "").trim();
  if (EXPORT_SECTORS.has(s)) return "export";
  if (IMPORT_SECTORS.has(s)) return "import";
  if (TRADING_SECTORS.has(s)) return "trading";
  return "neutral";
}

export function roleLabel(role: TradeRole): string {
  return role === "export" ? "輸出" : role === "import" ? "輸入" : role === "trading" ? "商社" : "対象外";
}

const ROLE_HINT: Record<Exclude<TradeRole, "neutral">, string> = {
  export: "海外売上でドルを受け取りやすいセクター（個別IRの海外比率ではない）",
  import: "輸入決済でドルを払いやすいセクター（個別の調達通貨ではない）",
  trading: "総合商社・卸売。輸出入の両方の建値を持つが円安は海外利益の円換算を増やす方向",
};

// ---------------------------------------------------------------- USDJPY

export type YenFit = "yen_down" | "yen_up" | "flat" | "unknown";

export type FxWeek = { date: string; close: number; prevClose: number | null };
export type FxPack = { weeks: FxWeek[]; latest: FxWeek | null };

const FX_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/USDJPY=X?interval=1wk&range=6mo";
const FX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const FX_TTL_MS = 6 * 60 * 60 * 1000;

/** Ngưỡng coi là đứng yên. Dưới mức này gọi 円安/円高 là đọc nhiễu thành tín hiệu. */
const FLAT_PCT = 0.1;

let fxCache: { at: number; pack: FxPack | null } | null = null;

/** Cho test — xoá cache module. */
export function resetFxCache(): void {
  fxCache = null;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
};

/**
 * USDJPY tuần. Lỗi → null, KHÔNG bịa tỷ giá.
 *
 * FX không có volume (Yahoo trả 0), nên phải dùng completedFxWeekly chứ không
 * phải completedWeekly — cái sau sẽ xoá sạch chuỗi.
 */
export async function fetchUsdJpyWeekly(now = Date.now()): Promise<FxPack | null> {
  if (fxCache && now - fxCache.at < FX_TTL_MS) return fxCache.pack;

  let pack: FxPack | null = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    const res = await fetch(FX_URL, { headers: { "User-Agent": FX_UA }, signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const j = (await res.json()) as YahooChart;
      const r = j.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const closes = r?.indicators?.quote?.[0]?.close ?? [];
      const bars: WeeklyBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c !== "number") continue;
        bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c, volume: 0 });
      }
      const done = completedFxWeekly(bars);
      const weeks: FxWeek[] = done.map((b, i) => ({
        date: b.date,
        close: b.close,
        prevClose: i > 0 ? done[i - 1].close : null,
      }));
      pack = weeks.length ? { weeks, latest: weeks[weeks.length - 1] } : null;
    }
  } catch {
    pack = null;   // mạng hỏng / timeout / JSON lạ — đều là "không biết"
  }
  fxCache = { at: now, pack };
  return pack;
}

/**
 * Biến động FX của tuần gần `date` nhất.
 *
 * Chỉ nhận bar cách `date` ≤ 4 ngày. Ngoài khoảng đó là đang ghép tuần cổ
 * phiếu với một tuần FX khác — trả null thay vì ghép bừa.
 */
export function fxChangeNearDate(
  fx: FxPack | null,
  date: string | null | undefined,
): { close: number; prevClose: number; pct: number } | null {
  if (!fx || !date) return null;
  const t = new Date(date + "T00:00:00Z").getTime();
  if (Number.isNaN(t)) return null;
  let best: FxWeek | null = null;
  let bestGap = Infinity;
  for (const w of fx.weeks) {
    const gap = Math.abs(new Date(w.date + "T00:00:00Z").getTime() - t) / 86400000;
    if (gap < bestGap) {
      bestGap = gap;
      best = w;
    }
  }
  if (!best || bestGap > 4 || best.prevClose === null || best.prevClose === 0) return null;
  return {
    close: best.close,
    prevClose: best.prevClose,
    pct: ((best.close - best.prevClose) / best.prevClose) * 100,
  };
}

export function yenFitFromPct(pct: number | null): YenFit {
  if (pct === null || Number.isNaN(pct)) return "unknown";
  if (pct > FLAT_PCT) return "yen_down";    // USDJPY lên = 円安
  if (pct < -FLAT_PCT) return "yen_up";     // USDJPY xuống = 円高
  return "flat";
}

export function yenLabel(fit: YenFit): string {
  return fit === "yen_down" ? "円安" : fit === "yen_up" ? "円高" : fit === "flat" ? "ほぼ横ばい" : "取得不可";
}

/** Tone KPI theo HƯỚNG SỐ USDJPY, không theo "tốt/xấu": số lên = up. */
export function fxTone(fit: YenFit): "up" | "down" | "flat" {
  return fit === "yen_down" ? "up" : fit === "yen_up" ? "down" : "flat";
}

// ---------------------------------------------------------------- identity

export type CashDir = "in" | "out" | "flat" | "unknown";

/** Đẳng thức §7. 円安 → 輸出/商社 vào, 輸入 ra. Ngược lại khi 円高. */
export function tradeCashDir(role: TradeRole, fit: YenFit): CashDir {
  if (role === "neutral" || fit === "unknown" || fit === "flat") return "unknown";
  const yenDown = fit === "yen_down";
  if (role === "export" || role === "trading") return yenDown ? "in" : "out";
  return yenDown ? "out" : "in";   // import
}

export function marketCashDir(signedFlowYen: number | null | undefined): CashDir {
  if (signedFlowYen === null || signedFlowYen === undefined || Number.isNaN(signedFlowYen)) {
    return "unknown";
  }
  if (signedFlowYen > 0) return "in";
  if (signedFlowYen < 0) return "out";
  return "flat";
}

export type Bucket = "both_in" | "market_in" | "trade_in" | "both_out";

/** Ưu tiên đúng thứ tự §7. flat/unknown KHÔNG tính là tradeIn. */
export function tradeBucket(tradeDir: CashDir, marketDir: CashDir): Bucket {
  const tradeIn = tradeDir === "in";
  const marketIn = marketDir === "in";
  if (tradeIn && marketIn) return "both_in";
  if (marketIn) return "market_in";
  if (tradeIn) return "trade_in";
  return "both_out";
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  both_in: "Cả hai vào",
  market_in: "Chỉ thị trường",
  trade_in: "Chỉ thương mại",
  both_out: "Ra",
};

const WHY: Record<Bucket, string> = {
  both_in: "貿易の円換算と市場資金の両面で、会社／株へ資金が入った。",
  market_in: "市場資金は株へ入ったが、貿易の円換算では資金が出やすい局面。",
  trade_in: "貿易の円換算では資金が入る方向だが、今週の株は出来高×下落で流出。",
  both_out: "貿易の円換算・市場資金の両面で資金が出た。",
};

/** Khi không có FX, both_out mang lý do riêng — không đổ tại thương mại. */
const WHY_BOTH_OUT_NO_FX = "市場資金のみ判定。為替が取れず貿易円換算は空欄。";

export function bucketWhy(bucket: Bucket, fit: YenFit): string {
  if (bucket === "both_out" && (fit === "unknown" || fit === "flat")) return WHY_BOTH_OUT_NO_FX;
  return WHY[bucket];
}

// ---------------------------------------------------------------- なぜ

export type ReasonInput = {
  role: Exclude<TradeRole, "neutral">;
  sector: string;
  fx: { close: number; prevClose: number; pct: number } | null;
  fit: YenFit;
  flowYen: number | null;
  returnPct: number | null;
};

/**
 * 4 dòng cố định theo §8. Chỉ nêu sự thật đã đo; cấm だろう và 買い推奨.
 * Thiếu FX thì nói thiếu, không đoán.
 */
export function buildReasons(inp: ReasonInput): string[] {
  const out: string[] = [];

  out.push(`分類: ${roleLabel(inp.role)}（${inp.sector}）。${ROLE_HINT[inp.role]}。`);

  if (inp.fx) {
    out.push(
      `為替: 今週 USDJPY ${inp.fx.prevClose.toFixed(2)} → ${inp.fx.close.toFixed(2)}` +
        `（${formatPct(inp.fx.pct, 2)}）= ${yenLabel(inp.fit)}。`,
    );
  } else {
    out.push("為替: Yahoo USDJPY=X を取得できず。");
  }

  const dir = tradeCashDir(inp.role, inp.fit);
  if (dir === "in") {
    out.push(
      inp.role === "import"
        ? "貿易キャッシュ: 円高で輸入決済のドルが安くなり、支払い側の円換算が軽くなる方向。"
        : "貿易キャッシュ: 円安で受取ドルの円換算が増える方向。",
    );
  } else if (dir === "out") {
    out.push(
      inp.role === "import"
        ? "貿易キャッシュ: 円安で輸入決済のドルが高くなり、支払いが増える方向。"
        : "貿易キャッシュ: 円高で受取ドルの円換算が減る方向。",
    );
  } else {
    out.push("貿易キャッシュ: 為替が横ばい／取得不可のため判定しない。");
  }

  /* `flowYen == null` nghĩa là KHÔNG BIẾT, không phải "đi ngang".
     Bản trước viết `(inp.flowYen ?? 0) > 0 ? … : … : "横ばい"`, nên mã thiếu dữ
     liệu bị gán 横ばい — một khẳng định về thị trường dựng từ chỗ trống. Số thì
     đã hiện `—` đúng, nhưng dòng chữ trong ngoặc lại nói ngược lại.
     `pillar_guard.py` bắt được chỗ này. */
  const inOut =
    inp.flowYen == null ? null
      : inp.flowYen > 0 ? "株へ流入"
      : inp.flowYen < 0 ? "株から流出"
      : "横ばい";
  out.push(
    `市場資金: 今週 Yahoo 出来高×値動きの符号 = ${formatYenFlow(inp.flowYen)}、` +
      `週次リターン ${formatPct(inp.returnPct)}${inOut ? `（${inOut}）` : ""}。` +
      "投資部門別ではない。",
  );

  return out;
}

// ---------------------------------------------------------------- view

export type TradeName = {
  code: string;
  nameJp: string;
  sector: string;
  scale: string;
  role: Exclude<TradeRole, "neutral">;
  roleLabel: string;
  flowYen: number | null;
  returnPct: number | null;
  tradeDir: CashDir;
  marketDir: CashDir;
  bucket: Bucket;
  why: string;
  reasons: string[];
};

export type RoleRow = {
  role: Exclude<TradeRole, "neutral">;
  label: string;
  /** Tổng signedFlowYen theo từng tuần, cũ → mới. null = tuần đó không mã nào có số. */
  weekly: (number | null)[];
  /** Số mã thực sự đóng góp vào mỗi tuần. Tổng của 40/50 mã khác tổng của 50/50,
   *  và nhìn con số yen thì không phân biệt được — nên phải đưa ra. */
  contributors: number[];
  monthYen: number | null;
  latestYen: number | null;
  /** Số mã thuộc vai trò này trong universe (kể cả mã không có dữ liệu tuần). */
  count: number;
};

export type Coverage = {
  /** Số mã trong universe thuộc 3 vai trò (không tính 対象外). */
  inScope: number;
  /** Trong đó có dữ liệu tuần gần nhất. */
  withLatest: number;
  /** withLatest / inScope, %. Thấp nghĩa là tổng ngành đang thiếu mã. */
  pct: number;
};

export type TradeView = {
  weeks: string[];
  fx: FxPack | null;
  fit: YenFit;
  fxLatest: { close: number; prevClose: number; pct: number } | null;
  rows: RoleRow[];
  names: TradeName[];
  counts: Record<Bucket, number>;
  /** Số mã bị loại vì 対象外 — công bố để không ai tưởng universe chỉ có bấy nhiêu. */
  skipped: number;
  tradingCount: number;
  /** Bao nhiêu phần universe thực sự có số tuần này. */
  coverage: Coverage;
};

const ROLES: Exclude<TradeRole, "neutral">[] = ["export", "import", "trading"];

export function buildTradeView(args: { weekly: WeeklyPack | null; fx: FxPack | null }): TradeView | null {
  const { weekly, fx } = args;
  if (!weekly || weekly.stocks.length === 0) return null;

  const weeks = weekly.weeks;
  const latestWeek = weeks.length ? weeks[weeks.length - 1] : null;
  const fxLatest = fxChangeNearDate(fx, latestWeek);
  const fit = yenFitFromPct(fxLatest?.pct ?? null);

  const names: TradeName[] = [];
  let skipped = 0;

  for (const s of weekly.stocks) {
    const role = tradeRole(s.sector);
    if (role === "neutral") {
      skipped += 1;
      continue;                      // không bịa vai trò cho mã ngoài phạm vi
    }
    const tradeDir = tradeCashDir(role, fit);
    const marketDir = marketCashDir(s.latestFlowYen);
    const bucket = tradeBucket(tradeDir, marketDir);
    names.push({
      code: s.code,
      nameJp: s.nameJp,
      sector: s.sector,
      scale: s.scale,
      role,
      roleLabel: roleLabel(role),
      flowYen: s.latestFlowYen,
      returnPct: s.latestReturnPct,
      tradeDir,
      marketDir,
      bucket,
      why: bucketWhy(bucket, fit),
      reasons: buildReasons({
        role,
        sector: s.sector,
        fx: fxLatest,
        fit,
        flowYen: s.latestFlowYen,
        returnPct: s.latestReturnPct,
      }),
    });
  }

  // pillar-ok: chỉ dùng để SẮP XẾP, không hiển thị. Mã chưa có số xếp lẫn với
  // mã đứng yên — chấp nhận được vì cột số của chúng vẫn render `—`.
  names.sort((a, b) => (b.flowYen ?? 0) - (a.flowYen ?? 0));

  const rows: RoleRow[] = ROLES.map((role) => {
    const members = weekly.stocks.filter((s) => tradeRole(s.sector) === role);
    // points đã được căn về lưới `weeks` (xem alignToWeeks), nên cộng theo chỉ
    // số i ở đây là cộng đúng cùng một tuần giữa các mã.
    const weeklySums: (number | null)[] = [];
    const contributors: number[] = [];
    weeks.forEach((_, i) => {
      const vals = members.map((m) => m.points[i]?.signedFlowYen ?? null);
      weeklySums.push(sumOrNull(vals));
      contributors.push(vals.filter((v) => v !== null).length);
    });
    return {
      role,
      label: roleLabel(role),
      weekly: weeklySums,
      contributors,
      monthYen: sumOrNull(weeklySums),
      latestYen: weeklySums.length ? weeklySums[weeklySums.length - 1] : null,
      count: members.length,
    };
  });

  const counts: Record<Bucket, number> = { both_in: 0, market_in: 0, trade_in: 0, both_out: 0 };
  for (const n of names) counts[n.bucket] += 1;

  const withLatest = names.filter((n) => n.flowYen !== null).length;
  return {
    weeks,
    fx,
    fit,
    fxLatest,
    rows,
    names,
    counts,
    skipped,
    tradingCount: names.filter((n) => n.role === "trading").length,
    coverage: {
      inScope: names.length,
      withLatest,
      pct: names.length ? (withLatest / names.length) * 100 : 0,
    },
  };
}
