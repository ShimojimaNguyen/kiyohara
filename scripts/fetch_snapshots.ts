/* Snapshot từng mã (giá · PER · PBR · EPS · BPS) → data/snapshots-latest.json
 *
 * Chạy:  npm run snapshots
 *        node --experimental-strip-types scripts/fetch_snapshots.ts --limit 20
 *
 * VÌ SAO NGUỒN NÀY
 * ----------------
 * Đo ngày 2026-09-29, bốn nguồn:
 *   · Yahoo US  v7/finance/quote        → 401
 *   · Yahoo US  v10/quoteSummary/*      → 401 (cả 4 module)
 *   · Kabutan   /stock/?code=           → 200 nhưng KHÔNG có EPS/BPS,
 *                                          và robots khai `Crawl-delay: 3`
 *                                          → 492 mã = ~25 phút
 *   · Yahoo JP  /quote/{code}.T         → 200, có ĐỦ giá/PER/PBR/EPS/BPS
 *
 * robots.txt của finance.yahoo.co.jp cho phép `/quote/` (chỉ chặn /portfolio,
 * /my, /cm/*, ảnh tin) và KHÔNG khai crawl-delay.
 *
 * Chi phí đo thật: 62,6KB truyền/mã (gzip; 490KB sau giải nén — đừng nhầm hai
 * con số này, tôi đã nhầm một lần và suýt loại nguồn vì tưởng nặng 250MB).
 * 492 mã ≈ 30MB, ≈ 4,4 phút.
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
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { FLOW_UNIVERSE, UNIVERSE_SNAPSHOT } from "../src/lib/screen/universe.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const PAGE = (code: string) => `https://finance.yahoo.co.jp/quote/${code}.T`;

/** Nghỉ giữa các request.
 *
 * ⛔ ĐÃ ĐO: nguồn CHẶN sau ~85 mã dù nghỉ 150ms — 407 mã còn lại HTTP 500, và
 * chặn kéo dài: sau 60s vẫn 500, giãn 3s/request vẫn 500. Một lần quét hàng
 * loạt làm mất nguồn cho cả việc tra một mã lẻ.
 *
 * Nên script này KHÔNG dùng được cho cả universe cho tới khi biết nhịp an
 * toàn, và đừng dò nhịp đó bằng cách gọi thêm. Hiện chỉ dùng `--limit` nhỏ. */
const PAUSE_MS = 150;
/** Trần cứng: quá số này thì dừng, không hỏi. Bảo vệ nguồn khỏi chính script. */
const MAX_CODES_PER_RUN = 60;
/** Dưới mức này thì bảng thiếu quá nhiều mã để gọi là "toàn universe". */
const MIN_COVERAGE_PCT = 80;
/** Lệch quá mức này giữa đẳng thức và số trang công bố thì gắn cờ. */
const IDENTITY_TOL_PCT = 3;

const OUT = path.join(process.cwd(), "data", "snapshots-latest.json");
const OUT_SAMPLE = path.join(process.cwd(), "data", "snapshots-sample.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[snapshots] ${m}`);

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
};

/**
 * Đọc một trường từ JSON nhúng trong trang.
 *
 * Trang nhúng payload với dấu nháy escape (`\"per\":{\"value\":\"10.85\"}`),
 * nên phải gỡ escape trước. Giá trị có dấu phẩy ngăn nghìn (`"3,150.60"`) —
 * bản đầu của tôi dùng `[^",]+` nên cắt ngay ở dấu phẩy và đọc `3` thay vì
 * `3150.60`. Sai đó không ném lỗi, chỉ cho ra một con số nhỏ hợp lý.
 */
function field(unescaped: string, key: string): { value: number | null; basis: string | null } {
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

async function fetchOne(code: string): Promise<{ snap: Snapshot } | { error: string }> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const res = await fetch(PAGE(code), { headers: { "User-Agent": UA }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
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
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.name : "unknown" };
  }
}

/** Đẳng thức tại nguồn: giá/EPS phải ra PER, giá/BPS phải ra PBR. */
function identityGap(s: Snapshot): { per?: number; pbr?: number } {
  const out: { per?: number; pbr?: number } = {};
  if (s.price != null && s.eps != null && s.eps !== 0 && s.per != null && s.per !== 0) {
    out.per = Math.abs(s.price / s.eps - s.per) / Math.abs(s.per) * 100;
  }
  if (s.price != null && s.bps != null && s.bps !== 0 && s.pbr != null && s.pbr !== 0) {
    out.pbr = Math.abs(s.price / s.bps - s.pbr) / Math.abs(s.pbr) * 100;
  }
  return out;
}

async function main(): Promise<number> {
  const i = process.argv.indexOf("--limit");
  const limit = i > -1 ? Number(process.argv[i + 1]) : 0;
  const wanted = limit > 0 ? FLOW_UNIVERSE.slice(0, limit) : FLOW_UNIVERSE;
  if (wanted.length > MAX_CODES_PER_RUN) {
    log(`từ chối chạy ${wanted.length} mã — trần một lần là ${MAX_CODES_PER_RUN}.`);
    log("Nguồn đã chặn ở lần thử 492 mã (85 OK rồi 407 lỗi HTTP 500, chặn kéo");
    log("dài qua cả nghỉ 60s và nhịp 3s). Xem skill market-data-sources §2.2b.");
    log("Muốn phủ cả universe: tìm nguồn khác, đừng nới trần này.");
    return 2;
  }
  const universe = wanted;

  log(`universe ${universe.length} mã (ảnh chụp JPX ${UNIVERSE_SNAPSHOT || "?"})`);
  const t0 = Date.now();

  const snaps: Snapshot[] = [];
  const failures: Array<{ code: string; reason: string }> = [];
  const inconsistent: Array<{ code: string; per?: number; pbr?: number }> = [];

  for (let n = 0; n < universe.length; n++) {
    const got = await fetchOne(universe[n].code);
    if ("error" in got) {
      failures.push({ code: universe[n].code, reason: got.error });
    } else {
      snaps.push(got.snap);
      const g = identityGap(got.snap);
      if ((g.per ?? 0) > IDENTITY_TOL_PCT || (g.pbr ?? 0) > IDENTITY_TOL_PCT) {
        inconsistent.push({ code: got.snap.code, ...g });
      }
    }
    if ((n + 1) % 50 === 0) {
      log(`${n + 1}/${universe.length} · lấy được ${snaps.length} · lỗi ${failures.length}`);
    }
    if (n < universe.length - 1) await sleep(PAUSE_MS);
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

  const out = limit ? OUT_SAMPLE : OUT;
  const payload = {
    fetchedAt: new Date().toISOString(),
    universeCount: universe.length,
    fetchedCount: snaps.length,
    failures,
    inconsistent,
    source: "Yahoo!ファイナンス 個別銘柄ページ (finance.yahoo.co.jp/quote/{code}.T)",
    notes:
      "PER/EPS thường là 会社予想, PBR/BPS là 実績 — xem perBasis/epsBasis từng mã. " +
      "Trường bị khoá sau tường phí trả về 000.00 kèm isLock và đã được đổi thành null, " +
      "KHÔNG phải 0. Universe = TOPIX Core30/Large70/Mid400, không phải toàn sàn.",
    snapshots: snaps,
  };

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  log(`ghi ${path.relative(process.cwd(), out)}` +
      (limit ? "  (chế độ thử — KHÔNG đụng snapshots-latest.json)" : ""));
  return 0;
}

main().then((c) => process.exit(c));
