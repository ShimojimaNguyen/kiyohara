/* Tầng chính sách cho phán đoán của Jev.
 *
 * Jev trả về XÁC SUẤT. File này biến xác suất thành QUYẾT ĐỊNH, và nó nằm trong
 * code chứ không nằm trong model — đổi ngưỡng thì không phải hỏi lại model, và
 * ai đọc cũng thấy được chính sách là gì.
 *
 * GIỚI HẠN ĐÃ ĐO (2026-09-22, jev-1.13.0). Đọc trước khi nới ngưỡng:
 *
 *   · Chỉ tên + 33業種 thì YẾU ở đúng chỗ quan trọng: 東京瓦斯 cost=0.44 (đúng ra
 *     phải rất cao, LNG nhập toàn bộ), 電源開発 0.49, JT rev=0.56.
 *   · Thêm 2-3 câu sự thật về cơ cấu ngoại tệ thì thành sắc: 0.92 / 0.90 / 0.87.
 *   · Thêm văn bách khoa (Wikipedia) thì KHÔNG cứu được, có khi còn hại:
 *     太陽誘電 tụt 0.70 → 0.59. Ngữ cảnh thừa là nhiễu, không phải thông tin.
 *   · Công ty bịa ra → 0.36/0.30. Jev không dựng khẳng định mạnh từ hư không.
 *
 * Hệ quả: `evidence` phải đi kèm mọi phán đoán, và UI phải hiện nó ra. Một con
 * số 0.85 dựa trên 有報 khác hẳn một con số 0.85 dựa trên mỗi cái tên.
 */

import { tradeRole, type TradeRole } from "../trade.ts";

/** Trên mức này mới coi là "có phơi nhiễm". */
export const STRONG = 0.7;
/** Dưới mức này mới coi là "không phơi nhiễm". Khoảng giữa = chưa kết luận. */
export const WEAK = 0.3;
/** Hai vế phải cách nhau ngần này mới gọi là nghiêng về một bên. */
export const MARGIN = 0.15;
/**
 * Ngưỡng tin cậy cho câu `choice`.
 *
 * Đo thật: 伊藤忠エネクス bị chính cái tên "伊藤忠" đánh lừa, Jev trả 総合商社 — SAI.
 * Nhưng conf chỉ 0.44, trong khi 4 tổng hợp thương xã thật đều ≥ 0.99. Ngưỡng
 * này tồn tại vì ca đó, không phải vì một con số đẹp.
 */
export const CONF_MIN = 0.85;

export type Evidence = "edinet" | "name_only" | "none";

/** Phán đoán thô từ Jev cho một mã. Chưa diễn giải. */
export type JevRead = {
  code: string;
  fxRevenue: number | null;
  fxCost: number | null;
  wholesaleKind: string | null;
  wholesaleConf: number | null;
  evidence: Evidence;
  /** Ngày 提出 của 有報 dùng làm bằng chứng. `null` khi evidence != "edinet". */
  filingDate: string | null;
  docId: string | null;
};

/**
 * Kết luận Jev đưa ra. `unclear` KHÔNG phải lỗi — nó là câu trả lời đúng khi
 * xác suất nằm giữa, và nó phải hiển thị thành không-gì-cả chứ không thành một
 * phỏng đoán.
 */
export type JevLean = "export" | "import" | "both" | "neutral" | "unclear";

/**
 * Hiệu hai xác suất, làm tròn về 4 chữ số trước khi so ngưỡng.
 *
 * KHÔNG phải tối ưu vặt — không có nó thì phân loại sai thật. `0.82 - 0.67`
 * trong IEEE754 ra `0.14999999999999991`, tức TRƯỢT ngưỡng 0.15, trong khi
 * `0.87 - 0.72` ra `0.15000000000000002` và lọt. Cùng một khoảng cách danh
 * nghĩa, hai kết quả khác nhau, tuỳ vào chỗ hai số rơi trên lưới nhị phân.
 *
 * Đã xảy ra thật: 9101 日本郵船 đo 0.82/0.67 bị rơi vào `unclear` thay vì
 * `export`. Test `jev.test.ts` bắt được ngay lần chạy đầu.
 */
function gap(a: number, b: number): number {
  return Math.round((a - b) * 1e4) / 1e4;
}

export function leanOf(r: Pick<JevRead, "fxRevenue" | "fxCost">): JevLean {
  const { fxRevenue: rev, fxCost: cost } = r;
  if (rev == null || cost == null) return "unclear";
  if (rev >= STRONG && cost >= STRONG) return "both";
  if (rev >= STRONG && gap(rev, cost) >= MARGIN) return "export";
  if (cost >= STRONG && gap(cost, rev) >= MARGIN) return "import";
  if (rev < WEAK && cost < WEAK) return "neutral";
  return "unclear";
}

/** Vai trò mà sector map gán — để đối chiếu, KHÔNG để thay thế. */
export function leanOfSectorRole(role: TradeRole): JevLean {
  return role === "export" ? "export"
    : role === "import" ? "import"
    : role === "trading" ? "both"
    : "neutral";
}

/**
 * Jev có mâu thuẫn với sector map không?
 *
 * `unclear` KHÔNG BAO GIỜ tính là mâu thuẫn. Không kết luận được thì im lặng,
 * không được dùng sự im lặng đó để phản đối một phân loại đang có.
 */
export function disagrees(read: JevRead, sector: string): boolean {
  const lean = leanOf(read);
  if (lean === "unclear") return false;
  return lean !== leanOfSectorRole(tradeRole(sector));
}

/** Nhãn tiếng Nhật cho UI. `unclear` không có nhãn vì nó không được hiện. */
export function leanLabel(lean: JevLean): string | null {
  switch (lean) {
    case "export": return "海外収入寄り";
    case "import": return "輸入コスト寄り";
    case "both": return "両建て";
    case "neutral": return "為替感応は小さい";
    default: return null;
  }
}

/** Nhãn nguồn bằng chứng. Phải hiện cạnh mọi phán đoán. */
export function evidenceLabel(e: Evidence, filingDate: string | null): string {
  switch (e) {
    case "edinet": return filingDate ? `有報 ${filingDate}` : "有報";
    // Nói thẳng là chỉ dựa vào tên — đã đo là yếu, người đọc có quyền biết.
    case "name_only": return "社名・業種のみ（弱い根拠）";
    default: return "根拠なし";
  }
}

/** Phân loại con của 卸売業, chỉ nhận khi vượt ngưỡng tin cậy. */
export function wholesaleLabel(r: JevRead): string | null {
  if (r.wholesaleKind == null || r.wholesaleConf == null) return null;
  if (r.wholesaleConf < CONF_MIN) return null;
  switch (r.wholesaleKind) {
    case "sogo_shosha": return "総合商社";
    case "import_trader": return "輸入商社";
    case "domestic_wholesale": return "国内卸";
    default: return null;   // none_of_these → không nói gì
  }
}
