/* 検算 — tính lại số từ đầu và so với số hệ thống đang công bố.
 *
 * VÌ SAO TỒN TẠI: mọi con số trên trang đều do một script tính ra, và không có
 * gì kiểm script đó ngoài chính nó. Đây là đường tính THỨ HAI mà `SD §8` đòi —
 * lấy dữ liệu thô đã lưu, tính lại bằng công thức khai báo, rồi đối chiếu.
 *
 * BA TRẠNG THÁI, KHÔNG PHẢI HAI. Đây là chỗ dễ sai nhất của một lớp 検算:
 *
 *   khớp        — tính lại ra đúng số đang công bố
 *   LỆCH        — tính lại ra số khác  →  có lỗi thật ở đâu đó
 *   không kiểm được — thiếu dữ liệu để tính lại
 *
 * Gộp "không kiểm được" vào "khớp" thì bảng xanh giả. Gộp vào "lệch" thì báo
 * động giả rồi người ta tắt đi. Ví dụ thật trong repo này: `returnPct` và
 * `sign` của CỘT ĐẦU được scanner tính từ bar nằm TRƯỚC cửa sổ 4 tuần được
 * giữ lại — dữ liệu đó không còn trong artifact, nên cột đầu là "không kiểm
 * được", tuyệt đối không phải "lệch".
 *
 * Không tự sửa gì. Lệch thì báo và để người quyết — `SD §6`.
 */

import type { WeeklyPoint } from "./flow.ts";

export type CheckState = "ok" | "mismatch" | "unverifiable";

export type Check = {
  /** Tên phép kiểm, hiện trên UI. */
  name: string;
  state: CheckState;
  /** Số hệ thống công bố. `null` khi không có. */
  claimed: number | null;
  /** Số tính lại được. `null` khi không tính được. */
  recomputed: number | null;
  /** Lệch tương đối, %. `null` khi không so được. */
  gapPct: number | null;
  /** Vì sao không kiểm được — bắt buộc khi state = "unverifiable". */
  why?: string;
  /** Mã liên quan, nếu phép kiểm gắn với một mã. */
  code?: string;
};

/** Dung sai mặc định. Số tiền yen lớn nên so tương đối, không so tuyệt đối. */
export const TOL_PCT = 0.5;

function rel(a: number, b: number): number {
  const base = Math.abs(b) > 1e-9 ? Math.abs(b) : 1;
  return (Math.abs(a - b) / base) * 100;
}

/** So một cặp (công bố, tính lại) thành một `Check`. */
export function compare(
  name: string,
  claimed: number | null | undefined,
  recomputed: number | null | undefined,
  opts: { tolPct?: number; why?: string; code?: string } = {},
): Check {
  const tol = opts.tolPct ?? TOL_PCT;
  const c = claimed ?? null;
  const r = recomputed ?? null;
  if (c === null || r === null || Number.isNaN(c) || Number.isNaN(r)) {
    return {
      name, state: "unverifiable", claimed: c, recomputed: r, gapPct: null,
      why: opts.why ?? (c === null ? "hệ thống không công bố số này"
                                   : "không đủ dữ liệu thô để tính lại"),
      code: opts.code,
    };
  }
  const gap = rel(r, c);
  return {
    name, state: gap <= tol ? "ok" : "mismatch",
    claimed: c, recomputed: r, gapPct: gap, code: opts.code,
  };
}

// ---------------------------------------------------------------- dòng tiền

/**
 * Kiểm số học của MỘT điểm tuần, tính lại từ `close` và `volume`.
 *
 * `prev` là điểm tuần liền trước trong cùng chuỗi; `null` nghĩa là đây là cột
 * đầu và phần phụ thuộc kỳ trước không kiểm được.
 */
export function checkWeeklyPoint(
  code: string,
  p: WeeklyPoint,
  prev: WeeklyPoint | null,
): Check[] {
  const out: Check[] = [];

  out.push(compare("turnoverYen = close × volume", p.turnoverYen,
    p.close != null && p.volume != null ? p.close * p.volume : null, { code }));

  out.push(compare("signedFlowYen = sign × turnoverYen", p.signedFlowYen,
    p.sign != null && p.turnoverYen != null ? p.sign * p.turnoverYen : null,
    { code, why: p.sign == null ? "tuần đầu chuỗi: chưa có dấu" : undefined }));

  // Hai phép dưới cần kỳ TRƯỚC. Cột đầu của artifact không còn bar trước đó —
  // scanner tính chúng từ dữ liệu 6 tháng rồi chỉ giữ lại 4 tuần.
  const noPrev = "cột đầu — bar của tuần trước không nằm trong artifact";
  out.push(compare("returnPct = (close/prev − 1)×100", p.returnPct,
    prev?.close != null && prev.close !== 0 && p.close != null
      ? (p.close / prev.close - 1) * 100 : null,
    { code, tolPct: 1, why: prev ? undefined : noPrev }));

  const signRecomputed =
    prev?.close != null && p.close != null
      ? (p.close > prev.close ? 1 : p.close < prev.close ? -1 : 0)
      : null;
  out.push(compare("sign = hướng giá so kỳ trước", p.sign, signRecomputed,
    { code, tolPct: 0, why: prev ? undefined : noPrev }));

  return out;
}

/** Kiểm các con số TỔNG mà run tự công bố, tính lại từ chính dữ liệu của nó. */
export function checkRunTotals(run: {
  universeCount?: number | null;
  fetchedCount?: number | null;
  grossTurnoverYen?: number | null;
  weeks?: string[];
}, byCode: Record<string, (WeeklyPoint | null)[]>): Check[] {
  const codes = Object.keys(byCode);
  const out: Check[] = [];

  out.push(compare("fetchedCount = số mã trong bảng", run.fetchedCount, codes.length,
    { tolPct: 0 }));

  const nWeeks = run.weeks?.length ?? null;
  const ragged = nWeeks == null
    ? null
    : codes.filter((c) => byCode[c].length !== nWeeks).length;
  out.push(compare("mọi mã có đúng số cột tuần", 0, ragged, { tolPct: 0 }));

  // gross = tổng |turnover| của CỘT CUỐI, đúng như scan.ts khai báo.
  let gross: number | null = null;
  if (codes.length) {
    gross = 0;
    for (const c of codes) {
      const last = byCode[c][byCode[c].length - 1];
      gross += Math.abs(last?.turnoverYen ?? 0);
    }
  }
  out.push(compare("grossTurnoverYen = Σ|turnover| cột cuối",
    run.grossTurnoverYen, gross));

  return out;
}

// ---------------------------------------------------------------- định giá

/** `per = price/eps`, `pbr = price/bps` — đẳng thức của spec §2 (`/agent`). */
export function checkSnapshot(s: {
  code: string; price: number | null; per: number | null; pbr: number | null;
  eps: number | null; bps: number | null;
}): Check[] {
  const why = "trang nguồn không công bố (hoặc trường bị khoá sau tường phí)";
  return [
    compare("PER = giá / EPS", s.per,
      s.price != null && s.eps != null && s.eps !== 0 ? s.price / s.eps : null,
      { code: s.code, tolPct: 3, why }),
    compare("PBR = giá / BPS", s.pbr,
      s.price != null && s.bps != null && s.bps !== 0 ? s.price / s.bps : null,
      { code: s.code, tolPct: 3, why }),
  ];
}

// ---------------------------------------------------------------- tổng hợp

export type Rollup = { ok: number; mismatch: number; unverifiable: number; total: number };

export function rollup(checks: Check[]): Rollup {
  const r: Rollup = { ok: 0, mismatch: 0, unverifiable: 0, total: checks.length };
  for (const c of checks) r[c.state] += 1;
  return r;
}

/**
 * Câu kết luận cho UI.
 *
 * KHÔNG nói "sạch" khi còn mục không kiểm được — một báo cáo nói sạch mà thực
 * ra chỉ chạy được nửa số kiểm thì tệ hơn không có báo cáo.
 */
export function verdict(r: Rollup): string {
  if (r.total === 0) return "chưa có gì để kiểm";
  if (r.mismatch > 0) return `${r.mismatch} phép kiểm LỆCH — xem bên dưới`;
  if (r.unverifiable > 0) {
    return `${r.ok} khớp · ${r.unverifiable} không kiểm được (thiếu dữ liệu thô)`;
  }
  return `${r.ok}/${r.total} khớp`;
}
