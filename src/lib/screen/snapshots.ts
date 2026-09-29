/* Đọc trang nguồn thành `Snapshot` — thuần hàm, không mạng, TEST ĐƯỢC.
 *
 * VÌ SAO TÁCH RA KHỎI `scripts/fetch_snapshots.ts`: ở đó nó nằm cạnh
 * `main()` chạy ngay lúc import, nên không test nổi. Mà đây lại đúng là phần
 * DỄ SAI NHẤT — bốn cái bẫy dưới đây đều đã cắn thật một lần:
 *
 *   1. dấu phẩy ngăn nghìn cắt `3,150.60` thành `3`      (Yahoo)
 *   2. `isLock` + `"000.00"` đọc thành PER = 0            (Yahoo)
 *   3. `－` đọc thành 0                                    (Kabutan)
 *   4. `変` = đổi niên độ → EPS 9 tháng đứng cạnh EPS 12 tháng (Kabutan)
 *
 * Không cái nào ném lỗi. Cả bốn đều cho ra một con số trông hợp lý.
 *
 * Fixture trong `__fixtures__/` là TRÍCH ĐOẠN NGUYÊN VĂN của trang thật (khối
 * header + bảng 通期業績, cắt theo mốc chứ không gõ tay) — để test bám vào
 * HTML nguồn thật sự trả về, không bám vào cái tôi tưởng nó trả về.
 */

export type SourceId = "yahoo" | "kabutan";

export type Snapshot = {
  code: string;
  price: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  /** Nhãn kỳ của từng trường (（予想）/（実績）) — PER dự phóng khác PER thực hiện. */
  perBasis: string | null;
  epsBasis: string | null;
  /** Giờ trang công bố cập nhật, dạng ISO nếu đọc được. */
  updatedAt: string | null;
  /** Nguồn của CHÍNH dòng này. Hai nguồn lệch nhau ~1% nên phải biết dòng nào từ đâu. */
  source: SourceId;
  /** Niên độ của EPS (`2027.03`). Khác nhau giữa các mã — không phải mã nào cũng tháng 3. */
  fiscalPeriod: string | null;
  /**
   * Kỳ này KHÔNG dài 12 tháng — công ty đang đổi niên độ (nguồn đánh dấu `変`).
   *
   * Bẫy thật, bắt được ở `2871` ニチレイ: kỳ `2026.12` chỉ dài 9 tháng, EPS
   * 81,4 là EPS CỦA 9 THÁNG, trong khi PER trang công bố (19,9) tính trên EPS
   * đã quy năm — `81,4 × 12/9 = 108,5`, và `2159 / 108,5 = 19,9`. Khớp đúng.
   *
   * Nghĩa là xếp EPS này cạnh EPS 12 tháng của mã khác là so hai thứ khác đơn
   * vị. Cờ này để chỗ dùng biết mà loại hoặc quy đổi — script KHÔNG tự quy
   * đổi, vì quy năm một kỳ chuyển tiếp là một giả định, không phải một phép tính.
   */
  fiscalPeriodIrregular: boolean;
};

/**
 * Đọc một trường từ JSON nhúng trong trang.
 *
 * Trang nhúng payload với dấu nháy escape (`\"per\":{\"value\":\"10.85\"}`),
 * nên phải gỡ escape trước. Giá trị có dấu phẩy ngăn nghìn (`"3,150.60"`) —
 * bản đầu của tôi dùng `[^",]+` nên cắt ngay ở dấu phẩy và đọc `3` thay vì
 * `3150.60`. Sai đó không ném lỗi, chỉ cho ra một con số nhỏ hợp lý.
 */
export function field(unescaped: string, key: string): { value: number | null; basis: string | null } {
  const m = new RegExp(`"${key}":\\{(.{0,300}?)\\}`, "s").exec(unescaped);
  if (!m) return { value: null, basis: null };
  const blob = m[1];
  if (/"isLock":true/.test(blob)) return { value: null, basis: null };  // tường phí
  const v = /"value":"([0-9,.\-]+)"/.exec(blob) ?? /"value":([0-9.\-]+)/.exec(blob);
  const sub = /"subText":"([^"]*)"/.exec(blob);
  if (!v) return { value: null, basis: sub?.[1] ?? null };
  const n = Number(v[1].replace(/,/g, ""));
  return { value: Number.isFinite(n) ? n : null, basis: sub?.[1] ?? null };
}

/** Gỡ thẻ rồi ép mọi khoảng trắng về một dấu cách — để regex bám theo CHỮ
 *  hiện trên trang, không bám theo cách trang xuống dòng. */
export function plain(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

/** `"1,234.5"` → 1234.5 · `"－"`, `""`, rác → `null`.
 *
 *  KHÔNG bao giờ trả 0 cho ô không đọc được. Kabutan in `－` cho mã lỗ hoặc
 *  chưa có dự phóng; đọc thành 0 sẽ ra PER 0 và trông như mã cực rẻ — đúng
 *  cái bẫy `isLock` của Yahoo, chỉ khác ký tự. */
export function jnum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const t = raw.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/,/g, "").trim();
  return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export function parseYahoo(code: string, html: string): { snap: Snapshot } | { error: string } {
  const u = html.replace(/\\"/g, '"');
  const price = field(u, "price");
  const per = field(u, "per");
  const pbr = field(u, "pbr");
  const eps = field(u, "eps");
  const bps = field(u, "bps");
  if (price.value === null) return { error: "không đọc được giá" };
  const at = /"updateDateMeta":"([0-9T:+\-]{19,25})"/.exec(u);
  return {
    snap: {
      code,
      price: price.value, per: per.value, pbr: pbr.value,
      eps: eps.value, bps: bps.value,
      perBasis: per.basis, epsBasis: eps.basis,
      updatedAt: at?.[1] ?? null,
      source: "yahoo",
      fiscalPeriod: null,   // trang này không in niên độ ra dạng máy đọc được
      fiscalPeriodIrregular: false,
    },
  };
}

/**
 * Kabutan `/stock/finance`.
 *
 * Trang KHÔNG in chữ "EPS"/"BPS" — nhãn là tiếng Nhật (`修正1株益`). Bản đầu
 * của tôi grep "EPS" ra 0 kết quả và suýt kết luận trang không có dữ liệu;
 * nó có, chỉ là tôi tìm bằng từ tiếng Anh.
 *
 * Bảng cần lấy là 通期業績. Trang có ~26 `<table>` không `id` nào cả, nên phải
 * nhận diện bằng tiêu đề: chỉ 通期業績 có ĐỦ ba chữ `経常益` + `修正` +
 * `発表日`. Các bảng khác (財務指標, 過去最高, 半期, 四半期) thiếu ít nhất một.
 */
export function parseKabutan(code: string, html: string): { snap: Snapshot } | { error: string } {
  const t = plain(html);

  // "PER PBR 利回り 信用倍率  10.5 倍 0.91 倍 3.47 ％". `[^0-9－]*?` dừng ngay ở
  // `－` nên mã không có dự phóng cho ra null, không phải con số của dòng sau.
  const mRatio = /PER\s+PBR[^0-9－]*?(\S+)\s*倍\s*(\S+)\s*倍/.exec(t);
  const layoutOk = /PER\s+PBR\s+利回り\s+信用倍率/.test(t);

  const mPrice = /([\d,]+(?:\.\d+)?)\s*円\s*前日比/.exec(t);
  if (!mPrice) {
    // HAI LÝ DO KHÁC HẲN NHAU, và gộp chúng là cách một thay đổi bố cục đi
    // qua mà không ai biết:
    //   · bố cục còn nguyên, mọi ô là `－` → NGUỒN không có dữ liệu cho mã này
    //     (đã thấy ở 7240, 9508: không sàn, không giá, không vốn hoá)
    //   · không tìm thấy cả khối tỷ số → nghi TRANG ĐỔI BỐ CỤC, tức lỗi của tôi
    return {
      error: layoutOk
        ? "nguồn không có dữ liệu thị trường cho mã này (toàn bộ header là －)"
        : "KHÔNG THẤY khối giá — nghi trang đổi bố cục, kiểm parser",
    };
  }

  // Dấu thời gian: `<time>` SÁT TRƯỚC khối giá. Đầu trang còn một dải
  // `<time>` của bảng chỉ số (日経平均, 米ドル円…) — lấy nhầm cái đó là gắn
  // giờ của chỉ số lên giá cổ phiếu.
  const iPrice = html.indexOf("前日比");
  let updatedAt: string | null = null;
  for (const m of html.slice(0, iPrice < 0 ? undefined : iPrice)
                      .matchAll(/<time[^>]*datetime="([^"]+)"/g)) {
    updatedAt = m[1];
  }

  let eps: number | null = null;
  let fiscalPeriod: string | null = null;
  let epsBasis: string | null = null;
  let irregular = false;

  for (const tb of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    const head = plain(tb[1].slice(0, 900));
    if (!(head.includes("経常益") && head.includes("修正") && head.includes("発表日"))) continue;
    // Cột: 決算期 | 売上高 | 営業益 | 経常益 | 最終益 | 修正1株益 | 修正1株配 | 発表日
    const rows: Array<{ period: string; forecast: boolean; irregular: boolean; eps: number | null }> = [];
    for (const tr of tb[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const th = /<th[^>]*>([\s\S]*?)<\/th>/.exec(tr[1]);
      if (!th) continue;
      const lab = th[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
      const per = /(\d{4}\.\d{2})/.exec(lab);
      if (!per) continue;
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (tds.length < 5) continue;
      rows.push({
        period: per[1],
        forecast: lab.includes("予"),
        // `変` = 決算期変更. Nguồn in ngay trong ô kỳ, cạnh `予`.
        irregular: lab.includes("変"),
        eps: jnum(tds[4]),
      });
    }
    // 予想 thắng tuyệt đối — PER trang in ra được tính từ ĐÚNG hàng này (kiểm
    // trên 7203: 2881,5 / 275,1 = 10,47 → trang in 10,5). Không có hàng dự
    // phóng thì lùi về 実績 mới nhất và NÓI RÕ bằng epsBasis, vì trộn 予想 với
    // 実績 trong một bảng là đúng thứ §1.2 cấm.
    const pick = rows.find((r) => r.forecast) ?? rows.at(-1);
    if (pick) {
      eps = pick.eps;
      fiscalPeriod = pick.period;
      epsBasis = pick.forecast ? "予想" : "実績";
      irregular = pick.irregular;
    }
    break;
  }

  return {
    snap: {
      code,
      price: jnum(mPrice[1]),
      per: jnum(mRatio?.[1]),
      pbr: jnum(mRatio?.[2]),
      eps,
      // KHÔNG suy ra từ giá/PBR — xem cổng 6 ở đầu file.
      bps: null,
      perBasis: epsBasis,   // PER trang in ra dùng chính EPS ở trên
      epsBasis,
      updatedAt,
      source: "kabutan",
      fiscalPeriod,
      fiscalPeriodIrregular: irregular,
    },
  };
}

/** Đẳng thức tại nguồn: giá/EPS phải ra PER, giá/BPS phải ra PBR. */
export function identityGap(s: Snapshot): { per?: number; pbr?: number } {
  const out: { per?: number; pbr?: number } = {};
  if (s.price != null && s.eps != null && s.eps !== 0 && s.per != null && s.per !== 0) {
    out.per = Math.abs(s.price / s.eps - s.per) / Math.abs(s.per) * 100;
  }
  if (s.price != null && s.bps != null && s.bps !== 0 && s.pbr != null && s.pbr !== 0) {
    out.pbr = Math.abs(s.price / s.bps - s.pbr) / Math.abs(s.pbr) * 100;
  }
  return out;
}
