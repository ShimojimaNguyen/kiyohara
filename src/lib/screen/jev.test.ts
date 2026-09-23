/* Test lớp CHÍNH SÁCH — biến xác suất thành quyết định. Không mạng.
 *
 * Tách bạch với jev.model.check.ts: file kia hỏi "model có còn trả lời đúng
 * không", file này hỏi "ta có diễn giải câu trả lời đúng không". Hai thứ hỏng
 * độc lập với nhau, và chỉ file này chạy trong `npm test`.
 *
 * Số dùng ở đây là số ĐO THẬT ngày 2026-09-22, không phải số bịa cho đẹp.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  leanOf, leanOfSectorRole, disagrees, leanLabel, evidenceLabel, wholesaleLabel,
  STRONG, WEAK, MARGIN, CONF_MIN, type JevRead,
} from "./jev.ts";

const read = (p: Partial<JevRead>): JevRead => ({
  code: "0000", fxRevenue: null, fxCost: null,
  wholesaleKind: null, wholesaleConf: null,
  evidence: "name_only", filingDate: null, docId: null, ...p,
});

// ---------------------------------------------------------------- leanOf

test("leanOf: các ca đo thật rơi đúng nhóm", () => {
  // 東京瓦斯 + bằng chứng LNG (đo: 0.03 / 0.92)
  assert.equal(leanOf({ fxRevenue: 0.03, fxCost: 0.92 }), "import");
  // トヨタ + bằng chứng (đo: 0.95 / 0.28)
  assert.equal(leanOf({ fxRevenue: 0.95, fxCost: 0.28 }), "export");
  // 日本郵船 (đo: 0.82 / 0.67) — biên đúng 0.15, phải tính là export
  assert.equal(leanOf({ fxRevenue: 0.82, fxCost: 0.67 }), "export");
  // 商船三井 (đo: 0.87 / 0.72) — cả hai vượt STRONG
  assert.equal(leanOf({ fxRevenue: 0.87, fxCost: 0.72 }), "both");
  // 三井不動産 (đo: 0.08 / 0.09)
  assert.equal(leanOf({ fxRevenue: 0.08, fxCost: 0.09 }), "neutral");
});

test("leanOf: thiếu số → unclear, KHÔNG phải neutral", () => {
  // Phân biệt sống còn: "không biết" khác "biết là không có phơi nhiễm".
  assert.equal(leanOf({ fxRevenue: null, fxCost: 0.9 }), "unclear");
  assert.equal(leanOf({ fxRevenue: 0.9, fxCost: null }), "unclear");
  assert.equal(leanOf({ fxRevenue: null, fxCost: null }), "unclear");
  assert.notEqual(leanOf({ fxRevenue: null, fxCost: null }), "neutral");
});

test("leanOf: vùng giữa là unclear, không được ép về một phía", () => {
  // Công ty bịa (đo: 0.36 / 0.30) — model không dựng khẳng định mạnh, và ta
  // cũng không được biến sự lưỡng lự đó thành một kết luận.
  assert.equal(leanOf({ fxRevenue: 0.36, fxCost: 0.30 }), "unclear");
  // AGC (đo: 0.64 / 0.41) — nghiêng xuất nhưng chưa tới STRONG
  assert.equal(leanOf({ fxRevenue: 0.64, fxCost: 0.41 }), "unclear");
  // 味の素 name_only (đo: 0.64 / 0.46)
  assert.equal(leanOf({ fxRevenue: 0.64, fxCost: 0.46 }), "unclear");
});

test("leanOf: vượt STRONG nhưng biên quá hẹp vẫn là unclear", () => {
  // Cao cả hai nhưng chưa đủ cao để gọi "both", và quá sát nhau để gọi một bên.
  const rev = STRONG + 0.01, cost = STRONG - 0.01;   // biên 0.02 < MARGIN
  assert.ok(rev - cost < MARGIN);
  assert.equal(leanOf({ fxRevenue: rev, fxCost: cost }), "unclear");
});

test("leanOf: dấu phẩy động không được quyết định phân loại", () => {
  // Lỗi thật, bắt được 2026-09-22. `0.82 - 0.67` = 0.14999999999999991 (trượt
  // ngưỡng 0.15) còn `0.87 - 0.72` = 0.15000000000000002 (lọt). Cùng khoảng
  // cách danh nghĩa 0.15, hai kết quả khác nhau — 9101 日本郵船 rơi khỏi
  // phân loại vì đúng chuyện này.
  assert.ok((0.82 - 0.67) < 0.15, "tiền đề: float đúng là lệch như vậy");

  // Mọi cặp có khoảng cách DANH NGHĨA đúng 0.15 và cost dưới STRONG đều phải
  // ra "export". Quét cả dải: 4/15 cặp (0.70/0.55, 0.71/0.56, 0.82/0.67,
  // 0.83/0.68) trượt nếu so trực tiếp bằng float — rải rác, không quy luật.
  for (let r = 70; r <= 84; r++) {
    const rev = r / 100, cost = (r - 15) / 100;
    if (cost >= STRONG) continue;
    assert.equal(leanOf({ fxRevenue: rev, fxCost: cost }), "export",
      `${rev.toFixed(2)}/${cost.toFixed(2)}: khoảng cách danh nghĩa đúng ${MARGIN}`);
    // Đối xứng — chiều nhập không được xử lý khác chiều xuất.
    assert.equal(leanOf({ fxRevenue: cost, fxCost: rev }), "import",
      `${cost.toFixed(2)}/${rev.toFixed(2)} (đảo chiều)`);
  }
});

test("leanOf: biên đúng bằng MARGIN thì tính (ranh giới đóng)", () => {
  assert.equal(leanOf({ fxRevenue: STRONG, fxCost: STRONG - MARGIN }), "export");
  assert.equal(leanOf({ fxRevenue: WEAK - 0.01, fxCost: WEAK - 0.01 }), "neutral");
});

// ---------------------------------------------------------------- disagrees

test("disagrees: unclear KHÔNG BAO GIỜ là bất đồng", () => {
  // Không kết luận được thì im lặng. Không được mượn sự im lặng để phản đối
  // một phân loại đang có — đó là cách một model yếu lật đổ dữ liệu tốt.
  assert.equal(disagrees(read({ fxRevenue: 0.5, fxCost: 0.5 }), "電気機器"), false);
  assert.equal(disagrees(read({ fxRevenue: null, fxCost: null }), "電気機器"), false);
  assert.equal(disagrees(read({ fxRevenue: 0.64, fxCost: 0.41 }), "銀行業"), false);
});

test("disagrees: bắt đúng các nhóm bất đồng đã đo trên 492 mã", () => {
  // カプコン 情報・通信業 (sector map: 対象外) nhưng đo 0.82 / 0.16
  assert.equal(disagrees(read({ fxRevenue: 0.82, fxCost: 0.16 }), "情報・通信業"), true);
  // ツルハ 小売業 (sector map: 輸入) nhưng đo 0.06 / 0.24 → thực ra nội địa
  assert.equal(disagrees(read({ fxRevenue: 0.06, fxCost: 0.24 }), "小売業"), true);
  // アルフレッサ 卸売業 (sector map: 商社) nhưng đo 0.08 / 0.25
  assert.equal(disagrees(read({ fxRevenue: 0.08, fxCost: 0.25 }), "卸売業"), true);
  // INPEX 鉱業 (sector map: 輸入) nhưng đo 0.81 / 0.54 → bán USD chứ không mua
  assert.equal(disagrees(read({ fxRevenue: 0.81, fxCost: 0.54 }), "鉱業"), true);
});

test("disagrees: đồng ý thì không báo bất đồng", () => {
  // ANA 空運業 sector map đã nói 輸入, Jev đo 0.55 / 0.81 → cùng kết luận
  assert.equal(disagrees(read({ fxRevenue: 0.55, fxCost: 0.81 }), "空運業"), false);
  // トヨタ 輸送用機器 → export, khớp
  assert.equal(disagrees(read({ fxRevenue: 0.95, fxCost: 0.28 }), "輸送用機器"), false);
  // 東海旅客鉄道 陸運業 → neutral, khớp
  assert.equal(disagrees(read({ fxRevenue: 0.03, fxCost: 0.12 }), "陸運業"), false);
});

test("leanOfSectorRole: 商社 ánh xạ sang both, không phải export", () => {
  // 卸売業 giữ cả hai chiều建値 — gọi nó là export sẽ tạo bất đồng giả với
  // mọi mã 商社 mà Jev đọc ra "both".
  assert.equal(leanOfSectorRole("trading"), "both");
  assert.equal(leanOfSectorRole("export"), "export");
  assert.equal(leanOfSectorRole("import"), "import");
  assert.equal(leanOfSectorRole("neutral"), "neutral");
});

// ---------------------------------------------------------------- nhãn

test("leanLabel: unclear không có nhãn — nó không được hiện ra", () => {
  assert.equal(leanLabel("unclear"), null);
  assert.equal(leanLabel("export"), "海外収入寄り");
  assert.equal(leanLabel("import"), "輸入コスト寄り");
  assert.equal(leanLabel("both"), "両建て");
});

test("evidenceLabel: nói thẳng khi căn cứ yếu", () => {
  assert.equal(evidenceLabel("edinet", "2026-06-25"), "有報 2026-06-25");
  // Phải có chữ cảnh báo: đã đo name_only cho 東京瓦斯 0.44 thay vì 0.92.
  assert.match(evidenceLabel("name_only", null), /弱い根拠/);
  assert.match(evidenceLabel("none", null), /根拠なし/);
});

// ---------------------------------------------------------------- 商社

test("wholesaleLabel: dưới ngưỡng tin cậy thì im lặng", () => {
  // 伊藤忠エネクス: đo thật kind=sogo_shosha nhưng conf 0.20–0.23 (tên đánh lừa).
  assert.equal(wholesaleLabel(read({ wholesaleKind: "sogo_shosha", wholesaleConf: 0.21 })), null);
  // 三菱商事: đo conf ≈ 1.00
  assert.equal(wholesaleLabel(read({ wholesaleKind: "sogo_shosha", wholesaleConf: 1.0 })), "総合商社");
  assert.equal(wholesaleLabel(read({ wholesaleKind: "domestic_wholesale", wholesaleConf: 0.95 })), "国内卸");
});

test("wholesaleLabel: none_of_these không bao giờ thành nhãn", () => {
  // Kể cả conf rất cao (đo: セブン&アイ 0.94–0.95) — "không phải cái nào" thì
  // không có gì để nói, không phải một loại thứ tư.
  assert.equal(wholesaleLabel(read({ wholesaleKind: "none_of_these", wholesaleConf: 0.95 })), null);
  assert.equal(wholesaleLabel(read({ wholesaleKind: null, wholesaleConf: null })), null);
});

test("ngưỡng giữ đúng quan hệ với nhau", () => {
  // Bảo vệ khỏi việc ai đó chỉnh một hằng số mà quên cái kia.
  assert.ok(WEAK < STRONG, "WEAK phải nhỏ hơn STRONG");
  assert.ok(MARGIN > 0 && MARGIN < STRONG - WEAK);
  assert.ok(CONF_MIN > 0.5 && CONF_MIN <= 1);
});
