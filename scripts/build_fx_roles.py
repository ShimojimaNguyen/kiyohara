"""Sinh src/lib/screen/fx-roles.ts — phán đoán phơi nhiễm ngoại tệ từng mã.

Chạy:  py scripts/build_fx_roles.py              (đủ universe, ghi fx-roles.ts)
       py scripts/build_fx_roles.py --limit 20   (thử, ghi fx-roles.sample.json)

VÌ SAO Ở ĐÂY CHỨ KHÔNG PHẢI LÚC CHẠY
------------------------------------
Phơi nhiễm ngoại tệ là thuộc tính của doanh nghiệp, đổi theo năm tài chính chứ
không theo tuần. 492 request Jev ≈ 30s và ~$0.015 mỗi lần dựng; đặt nó trong
HTTP request thì mỗi người xem trả lại cái giá đó cho một thứ gần như đứng yên.
Cùng lý lẽ đã dùng cho universe.ts và cho việc không nhét job quét vào request.

NÓ LÀM GÌ VÀ KHÔNG LÀM GÌ
-------------------------
Nó KHÔNG thay sector map. Sector map (trade.ts) vẫn là nguồn sự thật cho mọi
tổng yen. File này chỉ sinh ra một lớp chú thích đối chiếu, để người đọc thấy
chỗ nào cách phân loại theo 33業種 có vẻ không khớp với hồ sơ của chính công ty.

Jev KHÔNG chạm vào con số nào. Tài liệu của nó ghi thẳng "is not a calculator",
và đo thật cũng thấy yếu ở đếm/so số/đọc ngày. Mọi phép cộng yen nằm trong TS.

BẰNG CHỨNG QUYẾT ĐỊNH CHẤT LƯỢNG (đo 2026-09-22)
------------------------------------------------
  chỉ tên+ngành      東京瓦斯 cost=0.44   電源開発 0.49   JT rev=0.56
  + 2-3 câu 有報      →        0.92      →     0.90   →      0.87
  + Wikipedia        →        0.74      (太陽誘電 còn TỤT 0.70→0.59)

Nên: có EDINET_API_KEY thì lấy 【事業の内容】 trong 有価証券報告書 làm bằng chứng.
Không có thì vẫn chạy được nhưng gắn nhãn `name_only`, và UI phải nói ra là
căn cứ yếu. Không bao giờ im lặng hạ chất lượng.

KHOÁ
----
  TYPESAFE_API_KEY  bắt buộc
  EDINET_API_KEY    tuỳ chọn; thiếu thì hạ xuống name_only
Chỉ đọc từ env. Không hardcode, không ghi vào file sinh ra.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREEN = os.path.join(ROOT, "src", "lib", "screen")
OUT = os.path.join(SCREEN, "fx-roles.ts")
OUT_SAMPLE = os.path.join(ROOT, "data", "fx-roles.sample.json")
QUESTIONS = os.path.join(SCREEN, "jev-questions.json")
UNIVERSE_TS = os.path.join(SCREEN, "universe.ts")
# Chỉ mục 有報 được commit để lần sau chỉ tải phần mới, không quét lại cả năm.
EDINET_INDEX = os.path.join(ROOT, "data", "edinet-index.json")

UA = "KIYOHARA-fx-roles/0.1"
JEV_URL = "https://api.typesafe.ai/v1/systemone"
EDINET_API = "https://api.edinet-fsa.go.jp/api/v2"
CODELIST = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"

# 有価証券報告書: 内閣府令コード 010, 様式コード 030000.
YUHO_ORDINANCE, YUHO_FORM = "010", "030000"

# Câu nào trong 【事業の内容】 mới đáng đưa cho Jev. Đo thật: nhồi cả văn bản vào
# làm kết quả XẤU ĐI, nên đây là bộ lọc bắt buộc chứ không phải tối ưu vặt.
FX_WORDS = ("輸出", "輸入", "海外", "為替", "ドル", "外貨", "調達", "現地生産", "グローバル")
EVIDENCE_CHARS = 800

# Dưới mức này thì bằng chứng quá mỏng để gọi kết quả là "dựa trên 有報".
MIN_EDINET_COVERAGE = 0.60
MIN_STOCKS = 400


def log(m: str) -> None:
    print(f"[fx-roles] {m}", flush=True)


def http(url: str, headers: dict[str, str] | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout).read()


# ---------------------------------------------------------------- universe

def read_universe() -> list[dict]:
    """Đọc lại chính universe.ts app đang dùng.

    Không tải lại từ JPX: hai nguồn rời nhau sẽ lệch, và lệch ở đây nghĩa là
    chú thích gắn nhầm mã.
    """
    src = open(UNIVERSE_TS, encoding="utf-8").read()
    rows = []
    for m in re.finditer(
        r'\{\s*code:\s*"([^"]+)",\s*nameJp:\s*"([^"]*)",\s*sector:\s*"([^"]*)",\s*scale:\s*"([^"]*)"\s*\}',
        src,
    ):
        rows.append({"code": m.group(1), "nameJp": m.group(2),
                     "sector": m.group(3), "scale": m.group(4)})
    return rows


# ---------------------------------------------------------------- EDINET

def edinet_code_map() -> dict[str, str]:
    """証券コード → EDINETコード. Tải tự do, KHÔNG cần khoá (đã kiểm 2026-09-22)."""
    z = zipfile.ZipFile(io.BytesIO(http(CODELIST, timeout=120)))
    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    lines = z.read(name).decode("cp932", "replace").splitlines()
    hdr = next(csv.reader(lines[1:2]))
    i_sec = next(i for i, c in enumerate(hdr) if "証券" in c)
    i_ed = next(i for i, c in enumerate(hdr) if "ＥＤＩＮＥＴ" in c or "EDINET" in c)
    out = {}
    for r in csv.reader(lines[2:]):
        if len(r) > max(i_sec, i_ed) and r[i_sec].strip():
            sec = r[i_sec].strip()
            out[sec] = r[i_ed].strip()
            # EDINET ghi 証券コード 5 chữ số (thêm 0 cuối); universe dùng 4.
            if len(sec) == 5 and sec.endswith("0"):
                out.setdefault(sec[:4], r[i_ed].strip())
    return out


def edinet_yuho_index(key: str, days: int = 400) -> dict[str, dict]:
    """Quét documents.json theo ngày → {edinetCode: {docId, filingDate}}.

    EDINET chỉ tra được THEO NGÀY, không theo công ty — nên phải quét một cửa
    sổ. Đa số công ty Nhật chốt sổ tháng 3 và nộp 有報 giữa tháng 6, nhưng quét
    đủ ~13 tháng thì phủ cả những công ty chốt sổ tháng khác.

    Chỉ mục được commit; lần chạy sau chỉ quét những ngày chưa có.
    """
    idx, scanned = {}, set()
    try:
        cached = json.load(open(EDINET_INDEX, encoding="utf-8"))
        idx = cached.get("byEdinetCode", {})
        scanned = set(cached.get("scannedDates", []))
        log(f"chỉ mục 有報 sẵn có: {len(idx)} công ty, {len(scanned)} ngày đã quét")
    except Exception:
        log("chưa có chỉ mục 有報 — quét lần đầu (mất ~10-15 phút)")

    today = date.today()
    todo = [today - timedelta(days=i) for i in range(days)]
    todo = [d for d in todo if d.isoformat() not in scanned]
    log(f"cần quét {len(todo)} ngày")

    for n, d in enumerate(todo):
        iso = d.isoformat()
        try:
            raw = http(f"{EDINET_API}/documents.json?date={iso}&type=2",
                       headers={"Ocp-Apim-Subscription-Key": key}, timeout=45)
            j = json.loads(raw)
        except Exception as e:
            log(f"  {iso}: lỗi {type(e).__name__} — bỏ ngày này, KHÔNG đánh dấu đã quét")
            continue
        for doc in (j.get("results") or []):
            if doc.get("ordinanceCode") == YUHO_ORDINANCE and doc.get("formCode") == YUHO_FORM:
                ec = doc.get("edinetCode")
                if not ec:
                    continue
                prev = idx.get(ec)
                # Giữ bản nộp MỚI NHẤT nếu một công ty có nhiều bản (đính chính).
                if not prev or iso > prev["filingDate"]:
                    idx[ec] = {"docId": doc.get("docID"), "filingDate": iso}
        scanned.add(iso)
        if (n + 1) % 50 == 0:
            log(f"  quét {n + 1}/{len(todo)} ngày · {len(idx)} công ty")
        time.sleep(0.25)

    os.makedirs(os.path.dirname(EDINET_INDEX), exist_ok=True)
    with open(EDINET_INDEX, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"byEdinetCode": idx, "scannedDates": sorted(scanned)},
                  f, ensure_ascii=False, indent=1)
    return idx


def edinet_evidence(key: str, doc_id: str) -> str | None:
    """Lấy 【事業の内容】 từ CSV của XBRL, rồi cắt còn những câu nói về ngoại tệ.

    CHƯA KIỂM CHỨNG: viết theo tài liệu EDINET v2 (type=5 = CSV), nhưng không
    chạy thử được vì chưa có khoá. Spike đầu tiên phải xác nhận đúng ba điểm:
    type=5 tồn tại, file là ZIP chứa CSV UTF-16 tab-separated, và tên phần tử
    là jpcrp_cor:DescriptionOfBusinessTextBlock.
    """
    try:
        raw = http(f"{EDINET_API}/documents/{doc_id}?type=5",
                   headers={"Ocp-Apim-Subscription-Key": key}, timeout=120)
    except Exception:
        return None
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return None

    text = None
    for name in z.namelist():
        if not name.lower().endswith(".csv"):
            continue
        body = z.read(name)
        for enc in ("utf-16", "utf-8-sig", "cp932"):
            try:
                s = body.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            continue
        for line in s.splitlines():
            if "DescriptionOfBusinessTextBlock" in line:
                cells = line.split("\t")
                # Ô dài nhất trong dòng là phần nội dung; các ô kia là metadata.
                cand = max(cells, key=len)
                if len(cand) > 200:
                    text = cand
                    break
        if text:
            break
    if not text:
        return None

    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    hits = [s for s in re.split(r"(?<=。)", text) if any(w in s for w in FX_WORDS)]
    if not hits:
        return None
    return " ".join(hits)[:EVIDENCE_CHARS]


# ---------------------------------------------------------------- Jev

def load_questions() -> dict:
    q = json.load(open(QUESTIONS, encoding="utf-8"))
    return {k: v for k, v in q.items() if not k.startswith("_")}


def ask_jev(key: str, qdef: dict, stock: dict, evidence: str | None) -> dict:
    state = {
        "ticker": stock["code"],
        "company_name_ja": stock["nameJp"],
        "jpx_sector_33_ja": stock["sector"],
        "market": "Tokyo Stock Exchange Prime",
    }
    if evidence:
        state["business_description_ja"] = evidence

    questions = dict(qdef["questions"])
    if stock["sector"] == "卸売業":
        questions.update(qdef["wholesale_question"])

    body = json.dumps({"state": state, "model": qdef["model"],
                       "questions": questions}).encode()
    req = urllib.request.Request(
        JEV_URL, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": UA})
    for attempt in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=45))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise
        except Exception:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("unreachable")


# ---------------------------------------------------------------- main

def main() -> int:
    ts_key = os.environ.get("TYPESAFE_API_KEY")
    if not ts_key:
        log("thiếu TYPESAFE_API_KEY trong env — dừng. Không hardcode khoá.")
        return 1
    ed_key = os.environ.get("EDINET_API_KEY")

    limit = 0
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    universe = read_universe()
    if not universe:
        log("không đọc được mã nào từ universe.ts — sinh lại universe trước")
        return 1
    stocks = universe[:limit] if limit else universe
    log(f"universe {len(stocks)} mã" + (f"  (chế độ thử --limit {limit})" if limit else ""))

    # --- bằng chứng
    evidence_by_code: dict[str, dict] = {}
    if ed_key:
        log("có EDINET_API_KEY — lấy 【事業の内容】 từ 有価証券報告書")
        codemap = edinet_code_map()
        idx = edinet_yuho_index(ed_key)
        hits = 0
        for s in stocks:
            ec = codemap.get(s["code"])
            ent = idx.get(ec) if ec else None
            if not ent:
                continue
            ev = edinet_evidence(ed_key, ent["docId"])
            if ev:
                evidence_by_code[s["code"]] = {"text": ev, **ent}
                hits += 1
        cov = hits / len(stocks)
        log(f"bằng chứng 有報: {hits}/{len(stocks)} mã ({cov * 100:.1f}%)")
        if not limit and cov < MIN_EDINET_COVERAGE:
            log(f"phủ dưới {MIN_EDINET_COVERAGE * 100:.0f}% — KHÔNG ghi đè. "
                "Một bảng nửa dựa 有報 nửa dựa mỗi cái tên thì hai loại trông giống "
                "hệt nhau trên UI, và đó là kiểu sai tệ nhất.")
            return 1
    else:
        log("KHÔNG có EDINET_API_KEY — chạy ở mức `name_only`.")
        log("  Đã đo: chỉ tên+ngành thì yếu ở đúng ca quan trọng (東京瓦斯 0.44 "
            "thay vì 0.92). Kết quả vẫn ghi nhãn, nhưng đừng coi là bản cuối.")

    # --- hỏi Jev (song song; giới hạn 1.200 req/phút nên 8 luồng là thoải mái)
    qdef = load_questions()
    reads: dict[str, dict] = {}
    failures: list[dict] = []

    def work(s: dict):
        ev = evidence_by_code.get(s["code"])
        try:
            r = ask_jev(ts_key, qdef, s, ev["text"] if ev else None)
        except Exception as e:
            return s, None, f"{type(e).__name__}"
        return s, (r, ev), None

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        for n, (s, got, err) in enumerate(pool.map(work, stocks)):
            if err:
                failures.append({"code": s["code"], "reason": err})
                continue
            r, ev = got
            a = r.get("answers", {})
            wk = a.get("wholesale_kind")
            reads[s["code"]] = {
                "code": s["code"],
                "fxRevenue": a.get("fx_revenue", {}).get("noul"),
                "fxCost": a.get("fx_cost", {}).get("noul"),
                "wholesaleKind": wk.get("choice") if wk else None,
                "wholesaleConf": wk.get("confidence") if wk else None,
                "evidence": "edinet" if ev else "name_only",
                "filingDate": ev["filingDate"] if ev else None,
                "docId": ev["docId"] if ev else None,
            }
            if (n + 1) % 100 == 0:
                log(f"  Jev {n + 1}/{len(stocks)}")

    log(f"Jev xong: {len(reads)}/{len(stocks)} mã, lỗi {len(failures)}, "
        f"{time.time() - t0:.0f}s")
    if failures:
        log("  lỗi: " + ", ".join(f"{f['code']}({f['reason']})" for f in failures[:5]))

    if not limit and len(reads) < MIN_STOCKS:
        log(f"chỉ {len(reads)} mã có kết quả (< {MIN_STOCKS}) — KHÔNG ghi đè file cũ.")
        return 1

    rows = [reads[s["code"]] for s in stocks if s["code"] in reads]

    # --- chế độ thử KHÔNG đụng artifact production (bài học từ scan.ts)
    if limit:
        os.makedirs(os.path.dirname(OUT_SAMPLE), exist_ok=True)
        with open(OUT_SAMPLE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        log(f"ghi {os.path.relpath(OUT_SAMPLE, ROOT)}  (chế độ thử — KHÔNG đụng fx-roles.ts)")
        return 0

    n_edinet = sum(1 for r in rows if r["evidence"] == "edinet")
    body = ",\n".join(
        "  " + json.dumps(r, ensure_ascii=False, sort_keys=True) for r in rows)
    ts = f'''/* SINH TỰ ĐỘNG — đừng sửa tay.  Sinh lại: py scripts/build_fx_roles.py
 *
 * Phán đoán phơi nhiễm ngoại tệ từng mã, do model Jev (jev-1.13.0) đưa ra.
 * {len(rows)} mã · bằng chứng 有報: {n_edinet}/{len(rows)}.
 *
 * ĐÂY KHÔNG PHẢI SỐ LIỆU CÔNG BỐ. Nó là phán đoán của một model đọc hồ sơ, và
 * mọi chỗ hiển thị phải nói ra điều đó cùng với `evidence` của từng dòng — một
 * kết quả dựa trên 有報 khác hẳn một kết quả dựa trên mỗi cái tên.
 *
 * KHÔNG được cộng vào bất kỳ con số yen nào. Sector map trong trade.ts vẫn là
 * nguồn sự thật duy nhất cho các tổng 輸出/輸入/商社. File này chỉ để đối chiếu.
 *
 * Ngưỡng và cách diễn giải nằm ở jev.ts, không nằm đây.
 */

import type {{ JevRead }} from "./jev.ts";

export const FX_ROLES: JevRead[] = [
{body},
];

export const FX_ROLE_BY_CODE: Map<string, JevRead> = new Map(
  FX_ROLES.map((r) => [r.code, r]),
);
'''
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(ts)
    log(f"ghi {os.path.relpath(OUT, ROOT)}  ({len(rows)} mã, {n_edinet} có 有報)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
