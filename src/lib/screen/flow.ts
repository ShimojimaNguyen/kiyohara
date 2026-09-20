/* Dòng ròng tuần từ chart Yahoo — phần dùng chung cho /flow, /rotation, /trade.
 *
 * ĐÂY KHÔNG PHẢI 投資部門別. JPX công bố sổ ngoại/nội/tín dụng hằng tuần; cái
 * này không phải thứ đó và không thay thế được. Ở đây chỉ có một đại lượng
 * suy ra từ giá và khối lượng:
 *
 *     turnoverYen   = close * volume
 *     sign          = close > prevClose ? +1 : close < prevClose ? −1 : 0
 *     signedFlowYen = sign * turnoverYen
 *
 * Nó trả lời "tuần này tiền đổi chủ theo chiều giá lên hay giá xuống", không
 * trả lời "ai mua ai bán" và cũng không phải tiền về tài khoản doanh nghiệp.
 *
 * HAI CHỖ DỄ SAI MÀ KHÔNG AI THẤY — cả hai đã được xử lý ở đây:
 *
 * 1. CĂN CHỈNH TUẦN. Mỗi mã có chuỗi tuần riêng: mã mới niêm yết bắt đầu muộn,
 *    mã bị tạm ngừng giao dịch thiếu tuần ở giữa. Nếu cộng theo VỊ TRÍ trong
 *    mảng (points[i]) thì tuần thứ 3 của mã này bị cộng vào tuần thứ 4 của mã
 *    kia. Tổng vẫn ra một con số hợp lý và không gì báo lỗi. Nên mọi chuỗi đều
 *    được căn về một lưới tuần chung theo NGÀY, ô thiếu là `null`.
 *
 * 2. TUẦN ĐẦU CHUỖI KHÔNG CÓ DẤU. sign cần close của tuần trước; tuần đầu tiên
 *    không có. Gán 0 cho nó là nói "tuần đó dòng ròng bằng không" — một khẳng
 *    định — trong khi sự thật là không biết. Nên signedFlowYen của tuần đầu là
 *    `null`, và mọi phép cộng bỏ qua null chứ không cộng 0 vào.
 */

export type WeeklyBar = {
  /** Ngày mở tuần, ISO YYYY-MM-DD */
  date: string;
  close: number;
  volume: number;
};

export type WeeklyPoint = {
  date: string;
  close: number;
  volume: number;
  turnoverYen: number;
  /** null ở tuần đầu chuỗi: không có tuần trước để so. */
  sign: -1 | 0 | 1 | null;
  /** null = chưa biết (không phải 0). */
  signedFlowYen: number | null;
  /** % so tuần trước, đã nhân 100. null ở tuần đầu. */
  returnPct: number | null;
};

export type StockMeta = {
  code: string;
  nameJp: string;
  sector: string;
  scale: string;
};

export type StockWeekly = StockMeta & {
  /** Dài đúng bằng `weeks` của pack. `null` = mã không có dữ liệu tuần đó. */
  points: (WeeklyPoint | null)[];
  latestFlowYen: number | null;
  latestReturnPct: number | null;
  /** Tổng các tuần có số. null nếu không tuần nào có. */
  monthFlowYen: number | null;
  /** Số tuần thực sự có dữ liệu — để biết mã này đóng góp được bao nhiêu. */
  weeksWithData: number;
};

export type WeeklyPack = {
  /** Lưới tuần chung, cũ → mới. Mọi stock.points căn theo đúng mảng này. */
  weeks: string[];
  stocks: StockWeekly[];
};

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000,
  );
}

/**
 * Bỏ bar cuối nếu là tuần đang chạy dở: volume 0, hoặc cách bar trước < 6 ngày.
 *
 * Không bỏ thì "tuần này" là tuần mới chạy 1–2 phiên, bị so với những tuần đủ
 * 5 phiên — nhỏ hơn một cách có hệ thống mà nhìn bảng không ra.
 */
export function completedWeekly(bars: WeeklyBar[]): WeeklyBar[] {
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const incomplete = last.volume === 0 || (prev !== null && daysBetween(prev.date, last.date) < 6);
  return incomplete ? bars.slice(0, -1) : bars.slice();
}

/**
 * Bản cho FX: volume của FX luôn 0, nên chỉ được dùng tiêu chí khoảng cách.
 * Dùng completedWeekly() cho FX sẽ xoá sạch chuỗi.
 */
export function completedFxWeekly(bars: WeeklyBar[]): WeeklyBar[] {
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const incomplete = prev !== null && daysBetween(prev.date, last.date) < 6;
  return incomplete ? bars.slice(0, -1) : bars.slice();
}

/** Bar → điểm có dấu. Tuần đầu: sign/flow/return đều null (không biết, khác 0). */
export function toWeeklyPoints(bars: WeeklyBar[]): WeeklyPoint[] {
  return bars.map((b, i) => {
    const prev = i > 0 ? bars[i - 1] : null;
    const turnoverYen = b.close * b.volume;
    if (prev === null) {
      return { date: b.date, close: b.close, volume: b.volume, turnoverYen,
               sign: null, signedFlowYen: null, returnPct: null };
    }
    const sign: -1 | 0 | 1 = b.close > prev.close ? 1 : b.close < prev.close ? -1 : 0;
    return {
      date: b.date, close: b.close, volume: b.volume, turnoverYen, sign,
      signedFlowYen: sign * turnoverYen,
      returnPct: prev.close === 0 ? null : ((b.close - prev.close) / prev.close) * 100,
    };
  });
}

/**
 * Căn một chuỗi điểm về lưới tuần chung, theo NGÀY chứ không theo vị trí.
 *
 * Bar Yahoo của cùng một tuần có thể lệch nhau 1–2 ngày giữa các mã (ngày mở
 * cửa đầu tuần khác nhau khi có nghỉ lễ), nên khớp trong phạm vi ±3 ngày. Quá
 * ngưỡng đó là hai tuần khác nhau — để `null` thay vì ghép bừa.
 */
export function alignToWeeks(points: WeeklyPoint[], weeks: string[]): (WeeklyPoint | null)[] {
  return weeks.map((w) => {
    const t = new Date(w + "T00:00:00Z").getTime();
    let best: WeeklyPoint | null = null;
    let bestGap = Infinity;
    for (const p of points) {
      const gap = Math.abs(new Date(p.date + "T00:00:00Z").getTime() - t) / 86400000;
      if (gap < bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    return bestGap <= 3 ? best : null;
  });
}

export type ParsedWeekly = {
  weeks: string[];
  byCode: Record<string, (WeeklyPoint | null)[]>;
};

/** Đọc payload tuần đã lưu. Sai hình dạng → null, không cố vá. */
export function parseWeeklyPayload(raw: string | null | undefined): ParsedWeekly | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { weeks?: unknown; byCode?: unknown };
    if (!Array.isArray(j.weeks) || typeof j.byCode !== "object" || j.byCode === null) return null;
    return { weeks: j.weeks as string[], byCode: j.byCode as Record<string, (WeeklyPoint | null)[]> };
  } catch {
    return null;
  }
}

/** Tổng các giá trị không null. Trả null nếu không có giá trị nào. */
export function sumOrNull(values: (number | null | undefined)[]): number | null {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && !Number.isNaN(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Ghép chuỗi tuần với metadata mã.
 *
 * Mã không có chuỗi thì BỎ, không suy ra. Thiếu chart nghĩa là không biết, và
 * một mã dòng ròng 0 "vì không lấy được" sẽ lẫn vào nhóm đứng yên thật.
 */
export function expandWeekly(parsed: ParsedWeekly | null, stocks: StockMeta[]): WeeklyPack | null {
  if (!parsed) return null;
  const out: StockWeekly[] = [];
  for (const s of stocks) {
    const raw = parsed.byCode[s.code];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    // Payload đã căn sẵn khi quét; kiểm lại độ dài để một payload cũ (chưa căn)
    // không lọt vào và gây lệch tuần âm thầm.
    if (raw.length !== parsed.weeks.length) continue;
    const last = raw[raw.length - 1];
    out.push({
      ...s,
      points: raw,
      latestFlowYen: last?.signedFlowYen ?? null,
      latestReturnPct: last?.returnPct ?? null,
      monthFlowYen: sumOrNull(raw.map((p) => p?.signedFlowYen ?? null)),
      weeksWithData: raw.filter((p) => p && p.signedFlowYen !== null).length,
    });
  }
  return { weeks: parsed.weeks, stocks: out };
}
