/* Test định dạng. Không mạng, không DOM.
 *
 * Chạy: node --experimental-strip-types --test src/lib/screen/format.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { formatYenFlow, formatPct, formatRatioPct, formatShortDate, formatNumber } from "./format.ts";

test("thiếu số thì ra — chứ không ra 0", () => {
  for (const f of [formatYenFlow, formatPct, formatRatioPct, formatNumber]) {
    assert.equal(f(null), "—", `${f.name}(null)`);
    assert.equal(f(undefined), "—", `${f.name}(undefined)`);
    assert.equal(f(NaN), "—", `${f.name}(NaN)`);
  }
  assert.equal(formatShortDate(null), "—");
  assert.equal(formatShortDate("rác"), "—");
});

test("0 thật vẫn là 0 — null và 0 không được trộn", () => {
  // Đây là mặt kia của luật: `—` dành cho KHÔNG BIẾT. Nếu dòng ròng thật sự
  // bằng 0 thì phải in 0, che nó thành `—` cũng là một kiểu nói dối.
  assert.equal(formatYenFlow(0), "0円");
  assert.equal(formatRatioPct(0), "0%");
});

test("dấu âm là U+2212, không phải hyphen", () => {
  assert.match(formatYenFlow(-1e12), /^−/);
  assert.match(formatPct(-3.1), /^−/);
  assert.equal(formatYenFlow(-1e12).includes("-"), false, "hyphen-minus lọt vào");
});

test("bậc đơn vị JP: 兆 / 億 / 百万", () => {
  assert.equal(formatYenFlow(7.882e12), "7.9兆円");
  assert.equal(formatYenFlow(1.378e11), "1378.0億円");
  assert.equal(formatYenFlow(5e6), "5百万円");
});

test("formatRatioPct KHÔNG thêm dấu + — độ phủ 100% không phải 'tăng 100%'", () => {
  // Lỗi thật đã gặp: độ phủ dùng formatPct và hiện ra "+100%", đọc như một
  // mức tăng. Hai ý nghĩa khác nhau nên là hai hàm khác nhau.
  assert.equal(formatRatioPct(100), "100%");
  assert.equal(formatRatioPct(61.4), "61%");
  assert.equal(formatRatioPct(61.4, 1), "61.4%");
  assert.equal(formatPct(100), "+100.0%", "formatPct thì vẫn phải có dấu");
});

test("formatShortDate: ISO → M/D, không đệm số 0", () => {
  assert.equal(formatShortDate("2026-09-06"), "9/6");
  assert.equal(formatShortDate("2026-12-31"), "12/31");
});
