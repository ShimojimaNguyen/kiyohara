/* Test parser trang nguồn. Không mạng — đọc fixture trong `__fixtures__/`.
 *
 * Bốn fixture là bốn ca ĐÃ SOI BẰNG TAY trên trang thật ngày 2026-09-29, và
 * ba trong bốn ca đó chỉ lộ ra vì có một lần chạy 492 mã:
 *
 *   7203 トヨタ      bình thường, đủ trường
 *   6861 キーエンス   công ty KHÔNG công bố dự phóng → mọi ô 予 là `－`
 *   2871 ニチレイ    đang ĐỔI NIÊN ĐỘ (`変`) → kỳ chỉ dài 9 tháng
 *   7240 ＮＯＫ      nguồn không có dữ liệu thị trường → header toàn `－`
 *
 * Ba ca sau đều cho ra "một con số trông hợp lý" nếu đọc ẩu. Đó là lý do
 * chúng có mặt ở đây chứ không phải ca 7203.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseKabutan, jnum, plain, identityGap } from "./snapshots.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (code: string) =>
  readFileSync(path.join(HERE, "__fixtures__", `kabutan-${code}.html`), "utf8");

function snap(code: string) {
  const r = parseKabutan(code, fx(code));
  assert.ok("snap" in r, `mong đợi đọc được ${code}, nhận: ${JSON.stringify(r)}`);
  return r.snap;
}

// ------------------------------------------------------------------ jnum

test("jnum: `－` là KHÔNG BIẾT, không phải 0", () => {
  // Bẫy đã cắn: Kabutan in `－` cho mã chưa có dự phóng. Đọc thành 0 cho ra
  // PER 0 — trông như một mã cực rẻ, và không ném lỗi ở đâu cả.
  assert.equal(jnum("－"), null);
  assert.equal(jnum(""), null);
  assert.equal(jnum("  "), null);
  assert.equal(jnum(undefined), null);
  assert.equal(jnum("N/A"), null);
  // Nhưng 0 THẬT thì vẫn là 0.
  assert.equal(jnum("0"), 0);
  assert.equal(jnum("0.00"), 0);
});

test("jnum: dấu phẩy ngăn nghìn không được cắt số", () => {
  // Bẫy đã cắn ở Yahoo: `3,150.60` bị regex cắt thành `3`. Không ném lỗi,
  // chỉ ra một con số nhỏ HỢP LÝ — kiểu sai khó thấy nhất.
  assert.equal(jnum("3,150.60"), 3150.6);
  assert.equal(jnum("1,059,145"), 1059145);
  assert.equal(jnum("-105.0"), -105);
});

test("plain: gỡ thẻ và ép khoảng trắng, giữ nguyên chữ", () => {
  assert.equal(plain("<td>  1,2\n3 </td>"), " 1,2 3 ");
  assert.match(plain("<span>予</span>&nbsp;2027.03"), /予 2027\.03/);
});

// ------------------------------------------------------- ca thường: 7203

test("7203: đọc đủ giá · PER · PBR · EPS · niên độ · dấu thời gian", () => {
  const s = snap("7203");
  assert.equal(s.price, 2881.5);
  assert.equal(s.per, 10.5);
  assert.equal(s.pbr, 0.91);
  assert.equal(s.eps, 275.1);
  assert.equal(s.fiscalPeriod, "2027.03");
  assert.equal(s.epsBasis, "予想");
  assert.equal(s.fiscalPeriodIrregular, false);
  assert.equal(s.source, "kabutan");
  // Dấu thời gian phải là của MÃ, không phải của bảng chỉ số ở đầu trang.
  assert.equal(s.updatedAt, "2026-09-29T15:30+09:00");
});

test("7203: BPS là null, KHÔNG suy từ giá/PBR", () => {
  // Suy ra thì đẳng thức PBR sẽ luôn xanh và luôn vô nghĩa — một phép kiểm
  // tự soi chính mình. Thà nói "không kiểm được".
  const s = snap("7203");
  assert.equal(s.bps, null);
  const g = identityGap(s);
  assert.equal(g.pbr, undefined, "không được tính ra khoảng lệch PBR khi thiếu BPS");
  assert.ok(g.per !== undefined && g.per < 1, `đẳng thức PER phải khớp, nhận ${g.per}`);
});

test("7203: hàng 予想 thắng hàng 実績", () => {
  // Bảng có 2025.03 (359.6) và 2026.03 (295.3) là 実績, 2027.03 (275.1) là 予想.
  // PER mà trang in ra được tính từ hàng DỰ PHÓNG: 2881,5 / 275,1 = 10,47 → 10,5.
  // Lấy nhầm hàng thực hiện sẽ ra PER 9,8 — vẫn là một con số hợp lý.
  const s = snap("7203");
  assert.equal(s.eps, 275.1);
  assert.notEqual(s.eps, 295.3);
});

// --------------------------------------------- không có dự phóng: 6861

test("6861: công ty không công bố dự phóng → EPS và PER đều null", () => {
  // Hàng `予 2027.03` của キーエンス là `－ － － － －`. Đây là SỰ THẬT của
  // nguồn, không phải parser hỏng — và phải ra null, không ra 0.
  const s = snap("6861");
  assert.equal(s.eps, null);
  assert.equal(s.per, null);
  // Nhưng phần KHÔNG phụ thuộc dự phóng vẫn đọc được bình thường.
  assert.equal(s.price, 79480);
  assert.equal(s.pbr, 5.43);
  assert.equal(identityGap(s).per, undefined, "không có EPS thì không có đẳng thức");
});

// ------------------------------------------------- đổi niên độ: 2871

test("2871: kỳ 9 tháng phải được ĐÁNH DẤU, không lẳng lặng trộn vào", () => {
  // ニチレイ đổi niên độ tháng 3 → tháng 12, nên `2026.12` chỉ dài 9 tháng.
  // EPS 81,4 là EPS CỦA 9 THÁNG. Xếp nó cạnh EPS 12 tháng của mã khác là so
  // hai thứ khác đơn vị — đúng thứ §1.1 cấm.
  const s = snap("2871");
  assert.equal(s.fiscalPeriod, "2026.12");
  assert.equal(s.eps, 81.4);
  assert.equal(s.fiscalPeriodIrregular, true);
});

test("2871: đẳng thức PER LỆCH, và phải để nó lệch", () => {
  // Trang in PER 19,9 nhưng 2159 / 81,4 = 26,5. Không phải lỗi của ai: nguồn
  // quy năm EPS khi tính PER — 81,4 × 12/9 = 108,5 và 2159 / 108,5 = 19,9.
  //
  // Script KHÔNG tự quy đổi. Quy năm một kỳ chuyển tiếp là một GIẢ ĐỊNH về
  // mùa vụ, không phải một phép tính — nên nó gắn cờ và để người quyết.
  const s = snap("2871");
  const g = identityGap(s);
  assert.ok(g.per !== undefined && g.per > 3,
    `phải vượt ngưỡng 3% để lọt vào danh sách gắn cờ, nhận ${g.per}`);
  // Kiểm chính lời giải thích ở trên bằng số, để nếu sau này sai thì test đỏ.
  assert.ok(Math.abs(s.price! / (s.eps! * 12 / 9) - s.per!) < 0.1,
    "EPS quy năm phải khớp PER trang công bố");
});

// --------------------------------- nguồn không có dữ liệu: 7240

test("7240: nguồn trống ≠ parser hỏng — lỗi phải nói rõ là cái nào", () => {
  // Gộp hai lý do này là cách một thay đổi bố cục đi qua mà không ai biết:
  // nếu trang đổi markup, tôi cần thấy chữ "đổi bố cục", không phải một dòng
  // chung chung rồi cho rằng nguồn thiếu dữ liệu.
  const r = parseKabutan("7240", fx("7240"));
  assert.ok("error" in r, "mong đợi lỗi, nhưng đọc ra snapshot");
  assert.match(r.error, /header là －/);
  assert.doesNotMatch(r.error, /đổi bố cục/);
});

test("7240: bố cục biến mất thì phải nghi PARSER, không nghi nguồn", () => {
  // Bỏ hẳn khối tỷ số đi = giả lập trang đổi markup.
  const broken = fx("7240").replace(/PER/g, "XXX").replace(/信用倍率/g, "YYY");
  const r = parseKabutan("7240", broken);
  assert.ok("error" in r);
  assert.match(r.error, /đổi bố cục/);
});

// ------------------------------------------------------------- toàn cục

test("mọi fixture: không fixture nào cho ra 0 ở chỗ đáng lẽ là null", () => {
  // Cổng bao trùm: `0` trong bảng định giá gần như luôn là một lần đọc hỏng.
  for (const code of ["7203", "6861", "2871"]) {
    const s = snap(code);
    for (const k of ["price", "per", "pbr", "eps"] as const) {
      assert.notEqual(s[k], 0, `${code}.${k} ra 0 — nghi đọc hỏng, xem jnum`);
    }
  }
});
