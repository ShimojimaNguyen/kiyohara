/* Snapshot từng mã (giá · PER · PBR · EPS · BPS) → data/snapshots-{nguồn}-latest.json
 *
 * Chạy:  npm run snapshots                       (Kabutan, cả universe, ~25 phút)
 *        npm run snapshots -- --source yahoo --limit 12   (Yahoo, chỉ tra lẻ)
 *
 * HAI NGUỒN, VÀ LÝ DO PHẢI CÓ HAI
 * -------------------------------
 * Yahoo JP đủ năm trường nhưng CHẶN sau ~85 mã, chặn kéo dài, nên không phủ
 * nổi universe. Kabutan thiếu BPS nhưng cho quét cả universe ở nhịp nó tự
 * khai. Không nguồn nào vừa đủ trường vừa đủ độ phủ — nên giữ cả hai và nói
 * rõ mỗi bản lấy từ đâu, thay vì trộn hai nguồn vào một bảng.
 *
 * VÌ SAO NGUỒN NÀY
 * ----------------
 * Đo ngày 2026-09-29, bốn nguồn:
 *   · Yahoo US  v7/finance/quote        → 401
 *   · Yahoo US  v10/quoteSummary/*      → 401 (cả 4 module)
 *   · Kabutan   /stock/?code=           → 200 nhưng KHÔNG có EPS/BPS
 *   · Yahoo JP  /quote/{code}.T         → 200, có ĐỦ giá/PER/PBR/EPS/BPS
 *
 * Đo tiếp 2026-09-29 sau khi Yahoo chặn — trang KHÁC của Kabutan:
 *   · Kabutan   /stock/finance?code=    → 200, có giá/PER/PBR/EPS + NIÊN ĐỘ,
 *                                          vẫn KHÔNG có BPS.
 *     robots.txt (đọc thật): chỉ Disallow `/94446337/` và `/search*`,
 *     `Crawl-delay: 3`. 27,5KB/mã → 492 mã ≈ 13,5MB, ≈ 25 phút.
 *     18 mã liên tiếp ở nhịp 3s: 18/18 HTTP 200, KHÔNG bị chặn.
 *
 * ĐỐI CHIẾU CHÉO hai nguồn trên 12 mã trùng (2026-09-29):
 *   giá   12/12 khớp tới từng yên (0,00%)
 *   PBR   lệch ≤ 1,19%
 *   PER   lệch ≤ 1,75%   ·  EPS lệch ≤ 1,52%
 * Và `lệch PER ≈ lệch EPS` ở TỪNG dòng — nghĩa là lệch có hệ thống do cơ sở
 * số cổ phiếu khác nhau (Kabutan dùng 修正1株益 đã điều chỉnh chia tách), KHÔNG
 * phải nhiễu. Ngoại lệ đã thấy: 7203 lệch 3,6% (275,1 vs 265,55) — lớn nhất
 * trong các mã đã đo, chưa rõ vì sao, ghi lại chứ không tự giải thích.
 *
 * robots.txt của finance.yahoo.co.jp cho phép `/quote/` (chỉ chặn /portfolio,
 * /my, /cm/*, ảnh tin) và KHÔNG khai crawl-delay.
 *
 * Chi phí đo thật (Yahoo): 62,6KB truyền/mã (gzip; 490KB sau giải nén — đừng
 * nhầm hai con số này, tôi đã nhầm một lần và suýt loại nguồn vì tưởng nặng
 * 250MB).
 *
 * BẪY ĐÃ ĐO: trường bị khoá sau tường phí trả về `"value":"000.00"` kèm
 * `"isLock":true`. Đó KHÔNG phải số 0 — đọc nhầm thì PER 0 lọt vào bảng và
 * trông như một mã cực rẻ. Mọi trường có `isLock` đều thành `null`.
 *
 * CỔNG CHỐNG SỐ BỊA
 * -----------------
 * 1. Mã lỗi → vào `failures` kèm lý do, không suy ra.
 * 2. `isLock` hoặc không đọc được → `null`, không bao giờ `0`.
 * 3. Đối chiếu đẳng thức ngay lúc lấy: `price/eps ≈ per`, `price/bps ≈ pbr`.
 *    Lệch quá ngưỡng → ghi vào `inconsistent`, giữ số nhưng gắn cờ. Đây là
 *    đường tính thứ hai mà `SD §8` đòi, làm ngay tại nguồn.
 * 4. Độ phủ < MIN_COVERAGE_PCT → KHÔNG ghi đè file cũ.
 * 5. `--limit N` ghi ra file sample, không đụng artifact production.
 * 6. Nguồn Kabutan KHÔNG có BPS. Trường đó là `null` — nên đẳng thức PBR ở
 *    `integrity.ts` ra "không kiểm được", đúng như nó phải thế. Tuyệt đối
 *    KHÔNG suy BPS = giá/PBR: đó là số vòng lại từ chính PBR, nên phép kiểm
 *    sẽ luôn xanh và luôn vô nghĩa.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { FLOW_UNIVERSE, UNIVERSE_SNAPSHOT } from "../src/lib/screen/universe.ts";
import {
  type Snapshot, type SourceId, parseYahoo, parseKabutan, identityGap,
} from "../src/lib/screen/snapshots.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
type SourceCfg = {
  page: (code: string) => string;
  /** Nghỉ giữa các request, ms. */
  pauseMs: number;
  /** Trần cứng một lần chạy. `0` = không trần (nguồn đã đo là chịu được). */
  maxPerRun: number;
  label: string;
  notes: string;
  parse: (code: string, html: string) => { snap: Snapshot } | { error: string };
};

const SOURCES: Record<SourceId, SourceCfg> = {
  /** ⛔ CHỈ TRA LẺ. Đã đo: chặn sau ~85 mã dù nghỉ 150ms, và chặn KÉO DÀI —
   *  sau 60s vẫn 500, giãn 3s/request vẫn 500. Một lần quét hàng loạt làm mất
   *  nguồn cho cả việc tra một mã. Trần 60 là để script không tự huỷ nguồn;
   *  đừng nới nó, hãy dùng `--source kabutan`. */
  yahoo: {
    page: (code) => `https://finance.yahoo.co.jp/quote/${code}.T`,
    pauseMs: 150,
    maxPerRun: 60,
    label: "Yahoo!ファイナンス 個別銘柄ページ (finance.yahoo.co.jp/quote/{code}.T)",
    notes:
      "PER/EPS thường là 会社予想, PBR/BPS là 実績 — xem perBasis/epsBasis từng mã. " +
      "Trường bị khoá sau tường phí trả về 000.00 kèm isLock và đã được đổi thành null, " +
      "KHÔNG phải 0.",
    parse: parseYahoo,
  },
  /** Nhịp 3s là con số Kabutan TỰ KHAI trong robots.txt (`Crawl-delay: 3`),
   *  không phải tôi đoán. Không đặt trần: đã chạy 18 mã liên tiếp không bị
   *  chặn, và đây là nguồn duy nhất phủ nổi universe. */
  kabutan: {
    page: (code) => `https://kabutan.jp/stock/finance?code=${code}`,
    pauseMs: 3000,
    maxPerRun: 0,
    label: "株探 業績・財務推移 (kabutan.jp/stock/finance?code={code})",
    notes:
      "BPS KHÔNG có ở nguồn này nên là null — đẳng thức PBR vì thế 'không kiểm " +
      "được', và đó là câu trả lời đúng. EPS là 修正1株益 của hàng 予想 (đã điều " +
      "chỉnh chia tách); niên độ ghi ở fiscalPeriod, khác nhau giữa các mã " +
      "(có mã 2026.08, có mã 2027.03) — đừng gộp chung kỳ.",
    parse: parseKabutan,
  },
};

/** Dưới mức này thì bảng thiếu quá nhiều mã để gọi là "toàn universe". */
const MIN_COVERAGE_PCT = 80;
/** Lệch quá mức này giữa đẳng thức và số trang công bố thì gắn cờ. */
const IDENTITY_TOL_PCT = 3;

/* Mỗi nguồn một file. Hai nguồn lệch nhau ~1% ở PER/EPS một cách CÓ HỆ THỐNG
 * (cơ sở số cổ phiếu khác nhau) — ghi đè lẫn nhau sẽ tạo một bảng nửa nguồn
 * này nửa nguồn kia mà không ai biết, và chính đó là thứ làm số sai. */
const OUT = (src: SourceId) =>
  path.join(process.cwd(), "data", `snapshots-${src}-latest.json`);
const OUT_SAMPLE = (src: SourceId) =>
  path.join(process.cwd(), "data", `snapshots-${src}-sample.json`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[snapshots] ${m}`);


async function fetchOne(
  cfg: SourceCfg, code: string,
): Promise<{ snap: Snapshot } | { error: string }> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const res = await fetch(cfg.page(code), { headers: { "User-Agent": UA }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return cfg.parse(code, await res.text());
  } catch (e) {
    return { error: e instanceof Error ? e.name : "unknown" };
  }
}


function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<number> {
  // pillar-ok: `0` ở đây là "không đặt trần", không phải một số đo bị thiếu.
  // Mã dưới đọc nó bằng `limit > 0`, nên 0 và "vắng mặt" là CÙNG một ý nghĩa.
  const limit = Number(arg("--limit") ?? 0);
  const sourceId = (arg("--source") ?? "kabutan") as SourceId;
  const cfg = SOURCES[sourceId];
  if (!cfg) {
    log(`nguồn lạ: ${sourceId} — chỉ có ${Object.keys(SOURCES).join(" | ")}`);
    return 2;
  }
  const wanted = limit > 0 ? FLOW_UNIVERSE.slice(0, limit) : FLOW_UNIVERSE;
  if (cfg.maxPerRun && wanted.length > cfg.maxPerRun) {
    log(`từ chối chạy ${wanted.length} mã qua nguồn ${sourceId} — trần là ${cfg.maxPerRun}.`);
    log("Nguồn này đã chặn ở lần thử 492 mã (85 OK rồi 407 lỗi HTTP 500, chặn");
    log("kéo dài qua cả nghỉ 60s và nhịp 3s). Xem skill market-data-sources §2.2b.");
    log("Muốn phủ cả universe: `--source kabutan`. Đừng nới trần này.");
    return 2;
  }
  const universe = wanted;

  const mins = (universe.length * cfg.pauseMs) / 60000;
  log(`nguồn ${sourceId} · nhịp ${cfg.pauseMs}ms · universe ${universe.length} mã ` +
      `(ảnh chụp JPX ${UNIVERSE_SNAPSHOT || "?"}) · dự kiến ~${mins.toFixed(0)} phút`);
  const t0 = Date.now();

  const snaps: Snapshot[] = [];
  const failures: Array<{ code: string; reason: string }> = [];
  const inconsistent: Array<{ code: string; per?: number; pbr?: number }> = [];

  for (let n = 0; n < universe.length; n++) {
    const got = await fetchOne(cfg, universe[n].code);
    if ("error" in got) {
      failures.push({ code: universe[n].code, reason: got.error });
    } else {
      snaps.push(got.snap);
      const g = identityGap(got.snap);
      // Tường minh: `undefined` là KHÔNG TÍNH ĐƯỢC đẳng thức (thiếu eps/bps),
      // khác hẳn "tính được và bằng 0". `?? 0` gộp hai thứ đó làm một.
      const over = (v: number | undefined) => v !== undefined && v > IDENTITY_TOL_PCT;
      if (over(g.per) || over(g.pbr)) {
        inconsistent.push({ code: got.snap.code, ...g });
      }
    }
    if ((n + 1) % 50 === 0) {
      log(`${n + 1}/${universe.length} · lấy được ${snaps.length} · lỗi ${failures.length}`);
    }
    if (n < universe.length - 1) await sleep(cfg.pauseMs);
  }

  const coverage = (snaps.length / universe.length) * 100;
  const withPer = snaps.filter((s) => s.per != null).length;
  const withBps = snaps.filter((s) => s.bps != null).length;

  log(`độ phủ: ${snaps.length}/${universe.length} (${coverage.toFixed(1)}%) · ` +
      `có PER ${withPer} · có BPS ${withBps} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failures.length) {
    log(`lỗi ${failures.length}: ` +
        failures.slice(0, 5).map((f) => `${f.code}(${f.reason})`).join(", ") +
        (failures.length > 5 ? " …" : ""));
  }
  if (inconsistent.length) {
    log(`đẳng thức lệch > ${IDENTITY_TOL_PCT}%: ${inconsistent.length} mã — ` +
        inconsistent.slice(0, 5).map((x) =>
          `${x.code}(${x.per ? `PER ${x.per.toFixed(1)}%` : ""}${x.pbr ? ` PBR ${x.pbr.toFixed(1)}%` : ""})`).join(", "));
    log("  giữ số nhưng gắn cờ — KHÔNG tự sửa. Lệch có thể là cổ tức cổ phiếu, " +
        "kỳ khác nhau (予想 vs 実績), hoặc trang đổi bố cục.");
  }

  if (!limit && coverage < MIN_COVERAGE_PCT) {
    log(`độ phủ dưới ${MIN_COVERAGE_PCT}% — KHÔNG ghi đè. Giữ bản trước còn hơn ` +
        "công bố một bảng thiếu mã như thể đủ.");
    return 1;
  }

  const out = limit ? OUT_SAMPLE(sourceId) : OUT(sourceId);
  const payload = {
    fetchedAt: new Date().toISOString(),
    universeCount: universe.length,
    fetchedCount: snaps.length,
    failures,
    inconsistent,
    source: cfg.label,
    sourceId,
    notes: cfg.notes +
      " Universe = TOPIX Core30/Large70/Mid400, không phải toàn sàn.",
    snapshots: snaps,
  };

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  log(`ghi ${path.relative(process.cwd(), out)}` +
      (limit ? "  (chế độ thử — KHÔNG đụng bản latest)" : ""));
  return 0;
}

main().then((c) => process.exit(c));
