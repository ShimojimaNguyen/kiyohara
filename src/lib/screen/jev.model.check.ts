/* Golden test cho phán đoán của Jev. GỌI MẠNG — tách khỏi `npm test`.
 *
 * Chạy:  TYPESAFE_API_KEY=... npm run test:model
 *
 * VÌ SAO CẦN
 * ----------
 * Model là một phụ thuộc bên ngoài có thể đổi dưới chân mà không báo:
 * `jev-latest` trỏ sang bản mới, hoặc ai đó sửa một chữ trong
 * jev-questions.json. Cả hai đều làm đổi số mà không có dòng diff nào trong
 * logic. File này chốt lại những ca đã ĐO THẬT ngày 2026-09-22, nên trôi là đỏ.
 *
 * Ngưỡng ở đây lỏng hơn số đo thật (biên ±0.1~0.15) vì model không hứa hẹn
 * tất định. Nó bắt sự trôi dạt về CHẤT, không bắt dao động ở chữ số thứ hai.
 *
 * Ca quan trọng nhất trong file này là `KHÔNG bịa`: công ty không tồn tại thì
 * không được có khẳng định mạnh nào. Nếu một ngày ca đó đỏ, dừng dùng Jev cho
 * việc phân loại chứ đừng nới ngưỡng.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STRONG, CONF_MIN, leanOf, type JevLean } from "./jev.ts";

const KEY = process.env.TYPESAFE_API_KEY;
const QDEF = JSON.parse(
  readFileSync(new URL("./jev-questions.json", import.meta.url), "utf8"),
) as {
  model: string;
  questions: Record<string, unknown>;
  wholesale_question: Record<string, unknown>;
};

type State = Record<string, string>;

async function ask(state: State, wholesale = false) {
  const questions = wholesale
    ? { ...QDEF.questions, ...QDEF.wholesale_question }
    : QDEF.questions;
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: QDEF.model, questions }),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  const j = (await res.json()) as {
    answers: Record<string, { noul?: number; choice?: string; confidence?: number }>;
  };
  return {
    rev: j.answers.fx_revenue?.noul ?? null,
    cost: j.answers.fx_cost?.noul ?? null,
    kind: j.answers.wholesale_kind?.choice ?? null,
    conf: j.answers.wholesale_kind?.confidence ?? null,
  };
}

const stock = (ticker: string, name: string, sector: string, evidence?: string): State => ({
  ticker,
  company_name_ja: name,
  jpx_sector_33_ja: sector,
  market: "Tokyo Stock Exchange Prime",
  ...(evidence ? { business_description_ja: evidence } : {}),
});

/* Bằng chứng ở đây viết tay từ sự thật công khai, CHỈ để test cơ chế. Đường
   sản xuất lấy 【事業の内容】 từ 有報 qua EDINET — xem build_fx_roles.py. */
const LNG_EVIDENCE =
  "都市ガス最大手。原料となる液化天然ガス(LNG)のほぼ全量を海外から長期契約で輸入し、" +
  "ドル建てで調達する。売上はほぼ全量が国内の家庭・法人向け都市ガス・電力販売で円建て。";

const skip = { skip: KEY ? false : "cần TYPESAFE_API_KEY" };

test("ca dễ: トヨタ nhận USD", skip, async () => {
  const a = await ask(stock("7203", "トヨタ自動車", "輸送用機器"));
  assert.ok(a.rev! >= STRONG, `rev=${a.rev} phải ≥ ${STRONG}`);
});

test("BẰNG CHỨNG là thứ quyết định: 東京瓦斯 yếu khi thiếu, sắc khi có", skip, async () => {
  const without = await ask(stock("9531", "東京瓦斯", "電気・ガス業"));
  const withEv = await ask(stock("9531", "東京瓦斯", "電気・ガス業", LNG_EVIDENCE));

  // Nửa dưới: thiếu bằng chứng thì KHÔNG được tự tin. Nếu ca này bỗng mạnh lên
  // mà không thêm bằng chứng, nghĩa là model bắt đầu đoán từ trí nhớ — đúng cái
  // ta không muốn.
  assert.ok(without.cost! < STRONG,
    `không bằng chứng: cost=${without.cost} lẽ ra phải dưới ${STRONG}`);

  assert.ok(withEv.cost! >= 0.85, `có bằng chứng: cost=${withEv.cost} phải ≥ 0.85`);
  assert.equal(leanOf({ fxRevenue: withEv.rev, fxCost: withEv.cost }), "import" as JevLean);
});

test("trung tính sạch: 三井不動産 và 東海旅客鉄道", skip, async () => {
  for (const [c, n, s] of [
    ["8801", "三井不動産", "不動産業"],
    ["9022", "東海旅客鉄道", "陸運業"],
  ]) {
    const a = await ask(stock(c!, n!, s!));
    assert.ok(a.rev! <= 0.3 && a.cost! <= 0.3, `${n}: rev=${a.rev} cost=${a.cost}`);
    assert.equal(leanOf({ fxRevenue: a.rev, fxCost: a.cost }), "neutral" as JevLean);
  }
});

test("KHÔNG BỊA: công ty không tồn tại không được có khẳng định mạnh", skip, async () => {
  // Ca quan trọng nhất file này. Đỏ ở đây = dừng dùng Jev, không phải nới ngưỡng.
  for (const [c, n, s] of [
    ["0000", "株式会社ミドリカワ精密", "電気機器"],
    ["0001", "サンライト陸運サービス", "陸運業"],
  ]) {
    const a = await ask(stock(c!, n!, s!));
    assert.ok(a.rev! < STRONG && a.cost! < STRONG,
      `${n} không tồn tại mà rev=${a.rev} cost=${a.cost} — model đang bịa`);
  }
});

test("総合商社: 4 mã lớn, tin cậy cao", skip, async () => {
  for (const [c, n] of [
    ["8058", "三菱商事"], ["8031", "三井物産"],
    ["8001", "伊藤忠商事"], ["8053", "住友商事"],
  ]) {
    const a = await ask(stock(c!, n!, "卸売業"), true);
    assert.equal(a.kind, "sogo_shosha", `${n} → ${a.kind}`);
    assert.ok(a.conf! >= 0.95, `${n} conf=${a.conf}`);
  }
});

test("lối thoát none_of_these: mã KHÔNG phải bán buôn không bị gán bừa", skip, async () => {
  // Lỗi đã gặp 2026-09-22: thiếu lựa chọn này thì セブン&アイ (小売業) nhận
  // domestic_wholesale với conf=0.97 — chắc nịch cho một phương án sai.
  const a = await ask(stock("3382", "セブン&アイ・ホールディングス", "小売業"), true);
  assert.ok(
    a.kind === "none_of_these" || (a.conf ?? 0) < CONF_MIN,
    `mã không phải 卸売業 nhận ${a.kind} conf=${a.conf} — lối thoát không hoạt động`,
  );
});

test("ngưỡng tin cậy chặn được ca bị tên đánh lừa", skip, async () => {
  // 伊藤忠エネクス là công ty năng lượng nội địa, không phải 総合商社. Chữ "伊藤忠"
  // trong tên kéo model sang sogo_shosha — nhưng conf thấp hẳn (đo: 0.44).
  const a = await ask(stock("8133", "伊藤忠エネクス", "卸売業"), true);
  if (a.kind === "sogo_shosha") {
    assert.ok(a.conf! < CONF_MIN,
      `bị tên đánh lừa mà conf=${a.conf} ≥ ${CONF_MIN} — ngưỡng không còn chặn được`);
  }
});
