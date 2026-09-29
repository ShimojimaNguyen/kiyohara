/* Test cho lớp 検算. Không mạng.
 *
 * Trọng tâm: BA trạng thái phải tách bạch. Một lớp 検算 gộp "không kiểm được"
 * vào "khớp" sẽ cho bảng xanh giả — và bảng xanh giả tệ hơn không có bảng.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  compare, checkWeeklyPoint, checkRunTotals, checkSnapshot, rollup, verdict,
} from "./integrity.ts";
import type { WeeklyPoint } from "./flow.ts";

const pt = (p: Partial<WeeklyPoint>): WeeklyPoint => ({
  date: "2026-09-13", close: 100, volume: 1000, turnoverYen: 100_000,
  sign: 1, signedFlowYen: 100_000, returnPct: 1, ...p,
});

// ---------------------------------------------------------------- compare

test("compare: khớp / lệch / không kiểm được là BA trạng thái khác nhau", () => {
  assert.equal(compare("x", 100, 100).state, "ok");
  assert.equal(compare("x", 100, 140).state, "mismatch");
  // Thiếu một trong hai vế → KHÔNG được coi là khớp.
  assert.equal(compare("x", 100, null).state, "unverifiable");
  assert.equal(compare("x", null, 100).state, "unverifiable");
  assert.equal(compare("x", null, null).state, "unverifiable");
});

test("compare: mọi mục không kiểm được đều phải nêu LÝ DO", () => {
  // Không có lý do thì người đọc không biết nên đi lấy dữ liệu gì.
  for (const [a, b] of [[100, null], [null, 100], [null, null]] as const) {
    const c = compare("x", a, b);
    assert.equal(c.state, "unverifiable");
    assert.ok(c.why && c.why.length > 8, `thiếu why cho (${a}, ${b})`);
  }
});

test("compare: NaN không được lọt thành khớp", () => {
  assert.equal(compare("x", NaN, 100).state, "unverifiable");
  assert.equal(compare("x", 100, NaN).state, "unverifiable");
});

test("compare: 0 công bố và 0 tính lại là KHỚP, không phải thiếu", () => {
  // `0` là một khẳng định hợp lệ — chỉ `null` mới là không biết.
  const c = compare("x", 0, 0);
  assert.equal(c.state, "ok");
  assert.equal(c.gapPct, 0);
});

// ---------------------------------------------------------------- điểm tuần

test("checkWeeklyPoint: số học đúng thì khớp hết", () => {
  const prev = pt({ date: "2026-09-06", close: 100 });
  const p = pt({ close: 110, volume: 2000, turnoverYen: 220_000,
                 sign: 1, signedFlowYen: 220_000, returnPct: 10 });
  const cs = checkWeeklyPoint("7203", p, prev);
  assert.equal(cs.filter((c) => c.state === "mismatch").length, 0);
  assert.equal(cs.filter((c) => c.state === "unverifiable").length, 0);
});

test("checkWeeklyPoint: turnover sai thì BẮT ĐƯỢC", () => {
  const p = pt({ close: 110, volume: 2000, turnoverYen: 999 });
  const c = checkWeeklyPoint("7203", p, pt({ close: 100 }))
    .find((x) => x.name.startsWith("turnoverYen"))!;
  assert.equal(c.state, "mismatch");
  assert.equal(c.recomputed, 220_000);
});

test("checkWeeklyPoint: CỘT ĐẦU là 'không kiểm được', KHÔNG phải 'lệch'", () => {
  // Lỗi thật dễ mắc: scanner tính returnPct/sign của cột đầu từ bar nằm
  // TRƯỚC cửa sổ 4 tuần được giữ lại. Coi đó là lệch = 492 báo động giả mỗi
  // lần chạy, và người ta sẽ tắt cả trang đi.
  //
  // `sign =` chứ không phải `sign`: "signedFlowYen = …" CŨNG bắt đầu bằng
  // "sign", nên tiền tố lỏng sẽ chọn nhầm phép kiểm khác. Bản đầu của test
  // này đỏ vì đúng chuyện đó — và nó đỏ ở một phép kiểm hoàn toàn đúng.
  const cs = checkWeeklyPoint("7203",
    pt({ sign: -1, signedFlowYen: -100_000, returnPct: -2.07 }), null);
  const ret = cs.find((c) => c.name.startsWith("returnPct"))!;
  const sgn = cs.find((c) => c.name.startsWith("sign ="))!;
  assert.equal(ret.state, "unverifiable");
  assert.equal(sgn.state, "unverifiable");
  assert.match(ret.why!, /cột đầu/);
  // Nhưng phần KHÔNG phụ thuộc kỳ trước thì vẫn kiểm được bình thường.
  assert.equal(cs.find((c) => c.name.startsWith("turnoverYen"))!.state, "ok");
});

test("checkWeeklyPoint: sign ngược hướng giá thì bắt được", () => {
  // Fixture nhất quán về mọi mặt TRỪ dấu — để chỉ đúng một phép kiểm đỏ.
  const cs = checkWeeklyPoint("7203",
    pt({ close: 90, volume: 1000, turnoverYen: 90_000,
         sign: 1, signedFlowYen: 90_000, returnPct: -10 }),
    pt({ close: 100 }));
  const sgn = cs.find((x) => x.name.startsWith("sign ="))!;
  assert.equal(sgn.state, "mismatch");
  assert.equal(sgn.recomputed, -1);
  // Và KHÔNG được kéo theo phép kiểm nào khác đỏ lây.
  assert.equal(cs.filter((c) => c.state === "mismatch").length, 1,
    JSON.stringify(cs.filter((c) => c.state === "mismatch")));
});

// ---------------------------------------------------------------- tổng run

test("checkRunTotals: gross tính lại từ cột cuối", () => {
  const byCode = {
    A: [pt({ turnoverYen: 10 }), pt({ turnoverYen: 100 })],
    B: [pt({ turnoverYen: 20 }), pt({ turnoverYen: 200 })],
  };
  const cs = checkRunTotals(
    { universeCount: 2, fetchedCount: 2, grossTurnoverYen: 300, weeks: ["w1", "w2"] },
    byCode);
  assert.equal(cs.filter((c) => c.state === "mismatch").length, 0);

  const bad = checkRunTotals(
    { fetchedCount: 2, grossTurnoverYen: 999, weeks: ["w1", "w2"] }, byCode)
    .find((c) => c.name.startsWith("grossTurnoverYen"))!;
  assert.equal(bad.state, "mismatch");
  assert.equal(bad.recomputed, 300);
});

test("checkRunTotals: fetchedCount nói dối thì bắt được", () => {
  const c = checkRunTotals({ fetchedCount: 492, weeks: ["w1"] },
    { A: [pt({})] }).find((x) => x.name.startsWith("fetchedCount"))!;
  assert.equal(c.state, "mismatch");
  assert.equal(c.recomputed, 1);
});

// ---------------------------------------------------------------- định giá

test("checkSnapshot: PER/PBR theo đẳng thức, số Toyota thật", () => {
  // Đo 2026-09-29 từ Yahoo JP: giá 2881.5 · PER 10.85 · EPS 265.55
  //                            PBR 0.91 · BPS 3150.60
  const cs = checkSnapshot({ code: "7203", price: 2881.5, per: 10.85,
                             pbr: 0.91, eps: 265.55, bps: 3150.6 });
  assert.equal(cs.filter((c) => c.state !== "ok").length, 0, JSON.stringify(cs));
});

test("checkSnapshot: trường bị khoá (null) → không kiểm được, KHÔNG phải 0", () => {
  // Trang trả "000.00" + isLock cho trường sau tường phí; fetcher đổi thành
  // null. Nếu lớp này coi null là 0 thì PER 0 lọt vào bảng như mã cực rẻ.
  const cs = checkSnapshot({ code: "X", price: 1000, per: null, pbr: null,
                             eps: null, bps: null });
  assert.equal(cs.every((c) => c.state === "unverifiable"), true);
  assert.ok(cs.every((c) => c.why));
});

// ---------------------------------------------------------------- kết luận

test("verdict: KHÔNG nói sạch khi còn mục không kiểm được", () => {
  const r = rollup([
    compare("a", 1, 1), compare("b", 1, 1), compare("c", 1, null),
  ]);
  assert.deepEqual(r, { ok: 2, mismatch: 0, unverifiable: 1, total: 3 });
  const v = verdict(r);
  assert.doesNotMatch(v, /^2\/3 khớp$/);
  assert.match(v, /không kiểm được/);
});

test("verdict: lệch thì nói lệch trước mọi thứ khác", () => {
  const v = verdict(rollup([compare("a", 1, 9), compare("b", 1, null)]));
  assert.match(v, /LỆCH/);
});

test("verdict: chỉ nói khớp khi THỰC SỰ kiểm được hết", () => {
  assert.equal(verdict(rollup([compare("a", 1, 1), compare("b", 2, 2)])), "2/2 khớp");
});
