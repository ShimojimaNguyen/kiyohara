/* Test cho 輸出入 — §11 của spec.
 *
 * Không có test nào gọi mạng. Tất cả đầu vào là số dựng sẵn, nên mỗi lần chạy
 * cho cùng kết quả và một thay đổi công thức sẽ làm đỏ ngay chỗ nó phá.
 *
 * Chạy: node --experimental-strip-types --test src/lib/screen/trade.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tradeRole, roleLabel, yenFitFromPct, tradeCashDir, marketCashDir, tradeBucket,
  bucketWhy, buildReasons, buildTradeView, fxChangeNearDate, resetFxCache,
  type FxPack,
} from "./trade.ts";
import { alignToWeeks, completedFxWeekly, completedWeekly, sumOrNull, toWeeklyPoints, type WeeklyPack } from "./flow.ts";

// ---------------------------------------------------------------- phân loại

test("tradeRole: 33業種 map đúng 4 nhóm", () => {
  assert.equal(tradeRole("輸送用機器"), "export");
  assert.equal(tradeRole("電気機器"), "export");
  assert.equal(tradeRole("石油・石炭製品"), "import");
  assert.equal(tradeRole("電気・ガス業"), "import");
  assert.equal(tradeRole("卸売業"), "trading");
  assert.equal(tradeRole("銀行業"), "neutral");
  assert.equal(tradeRole("不動産業"), "neutral");
  assert.equal(tradeRole(null), "neutral");
});

test("roleLabel dùng nhãn JP", () => {
  assert.equal(roleLabel("export"), "輸出");
  assert.equal(roleLabel("import"), "輸入");
  assert.equal(roleLabel("trading"), "商社");
});

// ---------------------------------------------------------------- FX

test("ngưỡng ±0.1% phân 円安/円高/横ばい", () => {
  assert.equal(yenFitFromPct(0.5), "yen_down");
  assert.equal(yenFitFromPct(-0.5), "yen_up");
  assert.equal(yenFitFromPct(0.05), "flat");
  assert.equal(yenFitFromPct(-0.05), "flat");
  assert.equal(yenFitFromPct(null), "unknown");
});

test("completedFxWeekly bỏ bar giữa tuần mà KHÔNG cần volume", () => {
  // FX luôn volume 0 — nếu dùng tiêu chí volume thì chuỗi bị xoá sạch.
  const bars = [
    { date: "2026-09-01", close: 148.0, volume: 0 },
    { date: "2026-09-08", close: 149.0, volume: 0 },
    { date: "2026-09-10", close: 150.0, volume: 0 },   // cách 2 ngày = dở
  ];
  assert.equal(completedFxWeekly(bars).length, 2);
  // đủ 7 ngày thì giữ
  const full = [
    { date: "2026-09-01", close: 148.0, volume: 0 },
    { date: "2026-09-08", close: 149.0, volume: 0 },
  ];
  assert.equal(completedFxWeekly(full).length, 2);
  // completedWeekly (dành cho cổ phiếu) sẽ xoá bar volume=0 — chứng minh khác nhau
  assert.equal(completedWeekly(full).length, 1);
});

test("fxChangeNearDate: null khi thiếu FX hoặc lệch ngày quá 4", () => {
  const fx: FxPack = {
    weeks: [
      { date: "2026-09-07", close: 149.0, prevClose: null },
      { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
    ],
    latest: { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
  };
  assert.equal(fxChangeNearDate(null, "2026-09-14"), null);
  assert.equal(fxChangeNearDate(fx, null), null);
  assert.equal(fxChangeNearDate(fx, "2026-10-30"), null, "lệch xa phải trả null, không ghép bừa");
  const hit = fxChangeNearDate(fx, "2026-09-14");
  assert.ok(hit);
  assert.equal(hit.close, 150.5);
  assert.ok(Math.abs(hit.pct - 1.0067) < 0.01);
});

// ---------------------------------------------------------------- identity

test("đẳng thức 貿易: 円安 → 輸出/商社 vào, 輸入 ra; 円高 ngược lại", () => {
  assert.equal(tradeCashDir("export", "yen_down"), "in");
  assert.equal(tradeCashDir("trading", "yen_down"), "in");
  assert.equal(tradeCashDir("import", "yen_down"), "out");

  assert.equal(tradeCashDir("export", "yen_up"), "out");
  assert.equal(tradeCashDir("trading", "yen_up"), "out");
  assert.equal(tradeCashDir("import", "yen_up"), "in");

  // không biết tỷ giá thì không phán
  assert.equal(tradeCashDir("export", "unknown"), "unknown");
  assert.equal(tradeCashDir("export", "flat"), "unknown");
  assert.equal(tradeCashDir("neutral", "yen_down"), "unknown");
});

test("marketCashDir theo dấu dòng ròng, null ≠ 0", () => {
  assert.equal(marketCashDir(5), "in");
  assert.equal(marketCashDir(-5), "out");
  assert.equal(marketCashDir(0), "flat");
  assert.equal(marketCashDir(null), "unknown");
});

test("tradeBucket đủ 4 nhánh, đúng thứ tự ưu tiên", () => {
  assert.equal(tradeBucket("in", "in"), "both_in");
  assert.equal(tradeBucket("out", "in"), "market_in");
  assert.equal(tradeBucket("in", "out"), "trade_in");
  assert.equal(tradeBucket("out", "out"), "both_out");
  // unknown không được tính là tradeIn
  assert.equal(tradeBucket("unknown", "in"), "market_in");
  assert.equal(tradeBucket("unknown", "out"), "both_out");
});

test("both_out khi thiếu FX mang lý do riêng", () => {
  assert.match(bucketWhy("both_out", "unknown"), /為替が取れず/);
  assert.match(bucketWhy("both_out", "yen_down"), /両面で資金が出た/);
});

// ---------------------------------------------------------------- なぜ

test("buildReasons: có 分類, in 150.50, 円安, 3.0億円 — không có 買い推奨/だろう", () => {
  const reasons = buildReasons({
    role: "export",
    sector: "輸送用機器",
    fx: { close: 150.5, prevClose: 149.0, pct: 1.0067 },
    fit: "yen_down",
    flowYen: 3e8,
    returnPct: 2.4,
  });
  const all = reasons.join("\n");
  assert.match(all, /分類: 輸出（輸送用機器）/);
  assert.match(all, /150\.50/, "tỷ giá phải in 2 chữ số thập phân");
  assert.match(all, /円安/);
  assert.match(all, /3\.0億円/);
  assert.match(all, /投資部門別ではない/, "phải tự phủ định là 投資部門別");
  assert.doesNotMatch(all, /買い推奨/);
  assert.doesNotMatch(all, /だろう/);
});

test("buildReasons nói rõ khi không lấy được FX", () => {
  const all = buildReasons({
    role: "import", sector: "石油・石炭製品", fx: null, fit: "unknown",
    flowYen: -1e8, returnPct: -1.1,
  }).join("\n");
  assert.match(all, /取得できず/);
  assert.match(all, /判定しない/);
  assert.doesNotMatch(all, /円安|円高/, "không có FX thì không được nói 円安/円高");
});

// ---------------------------------------------------------------- view

function pack(stocks: Array<{ code: string; nameJp: string; sector: string; flow: number }>): WeeklyPack {
  const weeks = ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"];
  return {
    weeks,
    stocks: stocks.map((s) => ({
      code: s.code,
      nameJp: s.nameJp,
      sector: s.sector,
      scale: "TOPIX Core30",
      points: weeks.map((d, i) => ({
        date: d, close: 100, volume: 1000, turnoverYen: 100000,
        sign: (s.flow > 0 ? 1 : -1) as -1 | 1,
        signedFlowYen: i === weeks.length - 1 ? s.flow : 0,
        returnPct: s.flow > 0 ? 1.5 : -1.5,
      })),
      latestFlowYen: s.flow,
      latestReturnPct: s.flow > 0 ? 1.5 : -1.5,
      monthFlowYen: s.flow,
      weeksWithData: weeks.length,
    })),
  };
}

const FX_YEN_DOWN_2W: FxPack = {
  weeks: [
    { date: "2026-09-07", close: 149.0, prevClose: 148.0 },
    { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
  ],
  latest: { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
};

const FX_YEN_DOWN: FxPack = {
  weeks: [
    { date: "2026-09-07", close: 149.0, prevClose: 148.0 },
    { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
  ],
  latest: { date: "2026-09-14", close: 150.5, prevClose: 149.0 },
};

test("buildTradeView: loại 銀行業, トヨタ both_in và ENEOS both_out khi 円安", () => {
  resetFxCache();
  const view = buildTradeView({
    weekly: pack([
      { code: "7203", nameJp: "トヨタ自動車", sector: "輸送用機器", flow: 3e8 },
      { code: "5020", nameJp: "ＥＮＥＯＳ", sector: "石油・石炭製品", flow: -2e8 },
      { code: "8306", nameJp: "三菱ＵＦＪ", sector: "銀行業", flow: 9e8 },
    ]),
    fx: FX_YEN_DOWN,
  });
  assert.ok(view);
  assert.equal(view.fit, "yen_down");
  assert.equal(view.skipped, 1, "銀行業 phải bị loại, không bịa vai trò");
  assert.equal(view.names.length, 2);
  assert.ok(!view.names.some((n) => n.code === "8306"));

  const toyota = view.names.find((n) => n.code === "7203");
  assert.ok(toyota);
  assert.equal(toyota.bucket, "both_in");

  const eneos = view.names.find((n) => n.code === "5020");
  assert.ok(eneos);
  assert.equal(eneos.bucket, "both_out", "円安 + dòng ròng âm → nhập khẩu ra cả hai phía");

  assert.equal(view.counts.both_in, 1);
  assert.equal(view.counts.both_out, 1);
});

test("buildTradeView: 円高 đảo chiều — nhập khẩu vào, xuất khẩu chỉ thị trường", () => {
  const fxUp: FxPack = {
    weeks: [
      { date: "2026-09-07", close: 150.0, prevClose: 151.0 },
      { date: "2026-09-14", close: 148.0, prevClose: 150.0 },
    ],
    latest: { date: "2026-09-14", close: 148.0, prevClose: 150.0 },
  };
  const view = buildTradeView({
    weekly: pack([
      { code: "7203", nameJp: "トヨタ自動車", sector: "輸送用機器", flow: 3e8 },
      { code: "5020", nameJp: "ＥＮＥＯＳ", sector: "石油・石炭製品", flow: 2e8 },
    ]),
    fx: fxUp,
  });
  assert.ok(view);
  assert.equal(view.fit, "yen_up");
  assert.equal(view.names.find((n) => n.code === "5020")?.bucket, "both_in");
  assert.equal(view.names.find((n) => n.code === "7203")?.bucket, "market_in");
});

test("buildTradeView: không có FX thì không mã nào vào both_in", () => {
  const view = buildTradeView({
    weekly: pack([{ code: "7203", nameJp: "トヨタ自動車", sector: "輸送用機器", flow: 3e8 }]),
    fx: null,
  });
  assert.ok(view);
  assert.equal(view.fit, "unknown");
  assert.equal(view.counts.both_in, 0);
  assert.equal(view.names[0].bucket, "market_in");
});

test("hàng 輸出/輸入/商社 cộng đúng theo tuần", () => {
  const view = buildTradeView({
    weekly: pack([
      { code: "7203", nameJp: "トヨタ", sector: "輸送用機器", flow: 3e8 },
      { code: "6758", nameJp: "ソニー", sector: "電気機器", flow: 1e8 },
      { code: "8058", nameJp: "三菱商事", sector: "卸売業", flow: 5e7 },
    ]),
    fx: FX_YEN_DOWN,
  });
  assert.ok(view);
  const ex = view.rows.find((r) => r.role === "export");
  assert.ok(ex);
  assert.equal(ex.count, 2);
  assert.equal(ex.latestYen, 4e8, "2 mã xuất khẩu cộng lại");
  assert.equal(view.rows.find((r) => r.role === "trading")?.count, 1);
  assert.equal(view.tradingCount, 1);
});

test("toWeeklyPoints: tuần đầu là null (không biết), KHÔNG phải 0", () => {
  const pts = toWeeklyPoints([
    { date: "2026-09-01", close: 100, volume: 10 },
    { date: "2026-09-08", close: 110, volume: 20 },
    { date: "2026-09-15", close: 105, volume: 30 },
  ]);
  // Gán 0 cho tuần đầu là khẳng định "dòng ròng bằng không"; sự thật là chưa
  // có tuần trước để so. Khác nhau khi đi cộng theo ngành.
  assert.equal(pts[0].sign, null);
  assert.equal(pts[0].signedFlowYen, null);
  assert.equal(pts[0].returnPct, null);
  assert.equal(pts[1].sign, 1);
  assert.equal(pts[1].signedFlowYen, 110 * 20);
  assert.equal(pts[2].sign, -1);
  assert.equal(pts[2].signedFlowYen, -(105 * 30));
});

test("alignToWeeks: căn theo NGÀY, mã thiếu tuần thành null chứ không trượt", () => {
  const weeks = ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"];
  // Mã niêm yết muộn: chỉ có 2 tuần cuối.
  const late = toWeeklyPoints([
    { date: "2026-09-07", close: 100, volume: 10 },
    { date: "2026-09-14", close: 110, volume: 20 },
  ]);
  const aligned = alignToWeeks(late, weeks);
  assert.equal(aligned.length, 4);
  // Kiểm regression TRƯỚC: `assert.equal(x, null)` của node là assertion
  // signature, nó thu hẹp kiểu ô đó về `null` và mọi câu sau sẽ không còn
  // kiểm được gì. Nếu căn theo VỊ TRÍ thay vì theo NGÀY, ô [0] sẽ là bar
  // 09-07 — tức tuần 09-07 của mã này bị cộng vào cột 08-24 của mã khác.
  assert.notEqual(aligned[0]?.date, "2026-09-07");
  assert.notEqual(aligned[1]?.date, "2026-09-14");
  assert.equal(aligned[0], null, "tuần chưa niêm yết phải là null");
  assert.equal(aligned[1], null);
  assert.equal(aligned[2]?.date, "2026-09-07");
  assert.equal(aligned[3]?.date, "2026-09-14");
});

test("alignToWeeks: lệch ±3 ngày vẫn khớp, xa hơn thì null", () => {
  const weeks = ["2026-09-07"];
  const near = toWeeklyPoints([
    { date: "2026-09-01", close: 100, volume: 10 },
    { date: "2026-09-09", close: 110, volume: 20 },   // lệch 2 ngày
  ]);
  assert.equal(alignToWeeks(near, weeks)[0]?.date, "2026-09-09");
  const far = toWeeklyPoints([
    { date: "2026-08-01", close: 100, volume: 10 },
    { date: "2026-08-08", close: 110, volume: 20 },   // lệch 30 ngày
  ]);
  assert.equal(alignToWeeks(far, weeks)[0], null);
});

test("sumOrNull: bỏ qua null, trả null nếu không có gì — không cộng 0", () => {
  assert.equal(sumOrNull([1, null, 2]), 3);
  assert.equal(sumOrNull([null, null]), null, "không mã nào có số thì không được ra 0");
  assert.equal(sumOrNull([]), null);
  assert.equal(sumOrNull([0]), 0, "0 thật vẫn là 0");
});

test("RoleRow công bố số mã đóng góp từng tuần", () => {
  const weeks = ["2026-09-07", "2026-09-14"];
  const mk = (code: string, sector: string, pts: (number | null)[]) => ({
    code, nameJp: code, sector, scale: "TOPIX Core30",
    points: pts.map((v, i) => v === null ? null : ({
      date: weeks[i], close: 100, volume: 1, turnoverYen: 100,
      sign: (v > 0 ? 1 : -1) as -1 | 1, signedFlowYen: v, returnPct: 1,
    })),
    latestFlowYen: pts[pts.length - 1],
    latestReturnPct: 1,
    monthFlowYen: sumOrNull(pts),
    weeksWithData: pts.filter((p) => p !== null).length,
  });
  const view = buildTradeView({
    weekly: { weeks, stocks: [
      mk("7203", "輸送用機器", [null, 3e8]),   // niêm yết muộn
      mk("6758", "電気機器", [1e8, 1e8]),
    ] },
    fx: FX_YEN_DOWN_2W,
  });
  assert.ok(view);
  const ex = view.rows.find((r) => r.role === "export");
  assert.ok(ex);
  assert.deepEqual(ex.contributors, [1, 2], "tuần đầu chỉ 1/2 mã có số");
  assert.equal(ex.weekly[0], 1e8);
  assert.equal(ex.weekly[1], 4e8);
});

test("coverage nói rõ bao nhiêu phần universe có số tuần này", () => {
  const weeks = ["2026-09-14"];
  const mk = (code: string, flow: number | null) => ({
    code, nameJp: code, sector: "電気機器", scale: "TOPIX Core30",
    points: [flow === null ? null : {
      date: weeks[0], close: 100, volume: 1, turnoverYen: 100,
      sign: 1 as const, signedFlowYen: flow, returnPct: 1,
    }],
    latestFlowYen: flow, latestReturnPct: flow === null ? null : 1,
    monthFlowYen: flow, weeksWithData: flow === null ? 0 : 1,
  });
  const view = buildTradeView({
    weekly: { weeks, stocks: [mk("A", 1e8), mk("B", null), mk("C", 2e8), mk("D", null)] },
    fx: null,
  });
  assert.ok(view);
  assert.equal(view.coverage.inScope, 4);
  assert.equal(view.coverage.withLatest, 2);
  assert.equal(view.coverage.pct, 50);
});
