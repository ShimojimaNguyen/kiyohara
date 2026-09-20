"""Sinh src/lib/screen/universe.ts từ 東証上場銘柄一覧 (JPX data_j.xlsx).

Chạy:  py scripts/build_universe.py

VÌ SAO SINH RA FILE TS THAY VÌ ĐỌC XLSX LÚC CHẠY
------------------------------------------------
Universe đổi khoảng một lần/tháng, còn app chạy mỗi request. Đọc xlsx lúc chạy
là trả giá mỗi lần cho một thứ gần như không đổi, và buộc runtime phải có bộ
đọc ZIP/XML. Sinh ra file TS rồi commit thì:

  - app chỉ import một mảng, không phụ thuộc gì
  - universe thành artifact **xem lại được trong diff** — thêm/bớt mã nào là
    thấy ngay ở PR, thay vì âm thầm đổi dưới chân
  - biết chính xác dữ liệu chụp ngày nào (ghi trong header file)

KHÔNG BỊA: mọi dòng đều đến từ file JPX. Mã thiếu 33業種区分 hoặc 規模区分 thì
BỎ và đếm, không đoán ngành. Con số bỏ được in ra để người chạy thấy.

Nguồn: https://www.jpx.co.jp/markets/statistics-equities/misc/01.html
robots.txt của jpx.co.jp: `User-Agent:*  Disallow:` — cho phép toàn bộ.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "screen", "universe.ts")

# Bộ đọc xls/xlsx dùng chung với jp-market-dashboard. Giữ một bản sao ở đây để
# repo này tự đứng được, nhưng nội dung phải giống hệt — sửa một bên thì chép
# sang bên kia (chưa tách thành package riêng vì mới có hai chỗ dùng).
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from xlsx_reader import read_any  # noqa: E402

INDEX = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html"
BASE = "https://www.jpx.co.jp"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# TOPIX Core30 / Large70 / Mid400 = universe dòng tiền của spec (492 mã).
# Small 1/2 bị loại: thanh khoản mỏng làm close×volume nhiễu hơn là tín hiệu.
LARGE_SCALES = {"TOPIX Core30", "TOPIX Large70", "TOPIX Mid400"}

JST = timezone(timedelta(hours=9))


def log(m: str) -> None:
    print(f"[universe] {m}", flush=True)


def fetch(url: str, timeout: int = 60) -> bytes:
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout).read()


def main() -> int:
    page = fetch(INDEX).decode("utf-8", "replace")
    m = re.search(r'href="([^"]*data_j\.xlsx?)"', page)
    if not m:
        log("không thấy link data_j trên trang JPX — bố cục đã đổi")
        return 1
    url = BASE + m.group(1)
    log(f"tải {url.rsplit('/', 1)[-1]}")
    raw = fetch(url)

    grid = list(read_any(raw).values())[0]
    hdr = [str(x or "") for x in grid[0]]
    try:
        i_date = hdr.index("日付")
        i_code = hdr.index("コード")
        i_name = hdr.index("銘柄名")
        i_sec = hdr.index("33業種区分")
        i_scale = hdr.index("規模区分")
    except ValueError as e:
        log(f"thiếu cột bắt buộc ({e}) — JPX đã đổi header, KHÔNG đoán vị trí cột")
        return 1

    snapshot = None
    rows, skipped_scale, skipped_sector = [], 0, 0
    for r in grid[1:]:
        code_raw = r[i_code] if i_code < len(r) else None
        if not code_raw:
            continue
        if snapshot is None and i_date < len(r) and r[i_date]:
            # Ô ngày về dưới dạng số thực (20260831.0). Bỏ ký tự không phải chữ
            # số sẽ ra 9 chữ số vì cái ".0" — phải cắt phần thập phân trước.
            v = r[i_date]
            d = str(int(v)) if isinstance(v, float) else re.sub(r"[^\d]", "", str(v))
            if len(d) == 8:
                snapshot = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        scale = str(r[i_scale] or "").strip() if i_scale < len(r) else ""
        if scale not in LARGE_SCALES:
            skipped_scale += 1
            continue
        sector = str(r[i_sec] or "").strip() if i_sec < len(r) else ""
        if not sector or sector == "-":
            # Không có ngành thì không phân loại 輸出/輸入 được. Bỏ và đếm.
            skipped_sector += 1
            continue
        code = str(code_raw)
        if code.endswith(".0"):
            code = code[:-2]
        rows.append({
            "code": code.strip().zfill(4),
            "nameJp": str(r[i_name] or "").strip(),
            "sector": sector,
            "scale": scale,
        })

    rows.sort(key=lambda x: x["code"])
    log(f"universe = {len(rows)} mã  (bỏ {skipped_scale} ngoài Core30/Large70/Mid400, "
        f"{skipped_sector} thiếu 33業種区分)")
    if len(rows) < 400:
        log(f"CHỈ {len(rows)} mã — quá ít so với ~492 dự kiến. Không ghi đè file cũ.")
        return 1

    from collections import Counter
    by_scale = Counter(r["scale"] for r in rows)
    log(f"  {dict(by_scale)}  ·  {len({r['sector'] for r in rows})} ngành")

    body = ",\n".join(
        "  { code: %s, nameJp: %s, sector: %s, scale: %s }"
        % (json.dumps(r["code"]), json.dumps(r["nameJp"], ensure_ascii=False),
           json.dumps(r["sector"], ensure_ascii=False), json.dumps(r["scale"]))
        for r in rows
    )
    ts = f'''/* SINH TỰ ĐỘNG — đừng sửa tay.
 *
 * Nguồn: JPX 東証上場銘柄一覧 (data_j.xlsx), ảnh chụp ngày {snapshot or "?"}.
 * Sinh lại:  py scripts/build_universe.py
 *
 * {len(rows)} mã = TOPIX Core30 + Large70 + Mid400. KHÔNG phải toàn bộ ~3.700 mã
 * niêm yết: Small 1/2 bị loại vì thanh khoản mỏng làm close×volume nhiễu hơn là
 * tín hiệu. Mọi con số "toàn thị trường" trên app đều là toàn universe NÀY, và
 * chỗ hiển thị phải nói vậy.
 *
 * Mã thiếu 33業種区分 đã bị loại ({skipped_sector} mã) chứ không đoán ngành.
 */

export type UniverseStock = {{
  code: string;
  nameJp: string;
  sector: string;
  scale: string;
}};

/** Ngày JPX chụp danh sách này. Hiển thị cạnh universe để biết nó cũ chưa. */
export const UNIVERSE_SNAPSHOT = {json.dumps(snapshot or "")};

export const UNIVERSE: UniverseStock[] = [
{body},
];

/** Universe dòng tiền = toàn bộ file này (đã lọc sẵn khi sinh). */
export const FLOW_UNIVERSE: UniverseStock[] = UNIVERSE;

export const UNIVERSE_BY_CODE: Map<string, UniverseStock> = new Map(
  UNIVERSE.map((s) => [s.code, s]),
);
'''
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(ts)
    log(f"ghi {os.path.relpath(OUT, ROOT)}  (ảnh chụp {snapshot})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
