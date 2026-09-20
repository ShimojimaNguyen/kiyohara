/* Định dạng số cho UI. Quy ước JP: 兆 / 億 / 百万円.
 *
 * Dấu âm dùng U+2212 (−) chứ không phải hyphen-minus (-): trong font tỷ lệ,
 * hyphen ngắn hơn và lệch baseline so với chữ số, nên cột số âm trông rách.
 * Đây là quy ước của cả app, không chỉ hàm này.
 *
 * Thiếu số thì trả "—", KHÔNG trả 0. Một con số sai tệ hơn một ô trống: 0 tỷ
 * đồng dòng tiền là một khẳng định về thị trường, còn "—" là thừa nhận không
 * biết.
 */

const MINUS = "−";

/** Yên → chuỗi JP có đơn vị. `null`/`NaN` → "—". */
export function formatYenFlow(yen: number | null | undefined): string {
  if (yen === null || yen === undefined || Number.isNaN(yen)) return "—";
  const sign = yen < 0 ? MINUS : "";
  const a = Math.abs(yen);
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1)}兆円`;
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}億円`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}百万円`;
  if (a === 0) return "0円";
  return `${sign}${Math.round(a).toLocaleString("ja-JP")}円`;
}

/** Tỷ lệ đã nhân 100 (3.1 = 3.1%) → "+3.1%". `null` → "—". */
export function formatPct(pct: number | null | undefined, digits = 1): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? MINUS : "";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/** Tỷ lệ KHÔNG có dấu (độ phủ, tỷ trọng) → "100%". `null` → "—".
 *
 * Tách khỏi `formatPct` có chủ đích: độ phủ 100% in ra "+100%" thì đọc như
 * "tăng 100%", tức một đại lượng khác hẳn. Hai ý nghĩa, hai hàm.
 */
export function formatRatioPct(pct: number | null | undefined, digits = 0): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(digits)}%`;
}

/** ISO date → "M/D" cho nhãn trục và tiêu đề cột tuần. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** Số thường, có dấu phân cách. `null` → "—". */
export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
