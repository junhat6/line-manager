import { describe, expect, it } from "vitest";
import {
  buildMonthCandidates,
  extractEventHash,
  nextMonthStart,
  parseChouseisanCsv,
  parseCsvRows,
  rankCandidates,
} from "./chouseisan";
import { jstToUtc } from "./jst";

describe("nextMonthStart", () => {
  it("翌月1日のJST 0:00を返す", () => {
    const now = jstToUtc(2026, 7, 4, 15, 30);
    expect(nextMonthStart(now)).toEqual(jstToUtc(2026, 8, 1));
  });

  it("12月は翌年1月になる", () => {
    const now = jstToUtc(2026, 12, 31, 23, 59);
    expect(nextMonthStart(now)).toEqual(jstToUtc(2027, 1, 1));
  });
});

describe("buildMonthCandidates", () => {
  it("対象月の全日をラベル化する(2026年8月=31日)", () => {
    const labels = buildMonthCandidates(jstToUtc(2026, 8, 1));
    expect(labels).toHaveLength(31);
    expect(labels[0]).toBe("8/1(土)");
    expect(labels[30]).toBe("8/31(月)");
  });

  it("うるう年でない2月は28日まで", () => {
    const labels = buildMonthCandidates(jstToUtc(2026, 2, 1));
    expect(labels).toHaveLength(28);
    expect(labels[27]).toBe("2/28(土)");
  });
});

describe("parseCsvRows", () => {
  it("クォート内のカンマ・改行・エスケープされた引用符を扱える", () => {
    const rows = parseCsvRows('a,"b,c","d\ne","f""g"\r\nh,i');
    expect(rows).toEqual([
      ["a", "b,c", "d\ne", 'f"g'],
      ["h", "i"],
    ]);
  });
});

const SAMPLE_CSV = [
  "8月交流会 日程調整",
  "○△×で入力してください",
  "日程,山田,田中,佐藤,鈴木",
  "8/1(土),○,×,△,",
  "8/2(日),○,○,×,△",
  "8/3(月),○,○,△,",
  "コメント,よろしく!,,,",
].join("\n");

describe("parseChouseisanCsv", () => {
  const targetMonth = jstToUtc(2026, 8, 1);

  it("候補行だけを集計し、ヘッダ行・コメント行は無視する", () => {
    const results = parseChouseisanCsv(SAMPLE_CSV, targetMonth);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      label: "8/1(土)",
      attend: 1,
      maybe: 1,
      absent: 1,
      score: 1.5,
    });
    expect(results[0].date).toEqual(jstToUtc(2026, 8, 1));
  });

  it("○=1点、△=0.5点で採点する(×と未入力は0点)", () => {
    const results = parseChouseisanCsv(SAMPLE_CSV, targetMonth);
    expect(results[1].score).toBe(2.5); // 8/2: ○2 + △1 = 2.5
    expect(results[2].score).toBe(2.5); // 8/3: ○2 + △1 = 2.5
  });

  it("対象月以外の日付は無視する", () => {
    const csv = ["日程,山田", "8/1(土),○", "9/1(火),○"].join("\n");
    const results = parseChouseisanCsv(csv, targetMonth);
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("8/1(土)");
  });
});

describe("rankCandidates", () => {
  it("score降順、同点は早い日付順に並べる", () => {
    const results = parseChouseisanCsv(SAMPLE_CSV, jstToUtc(2026, 8, 1));
    const ranked = rankCandidates(results);
    // 8/2: ○2+△1=2.5 / 8/3: ○2+△1=2.5 / 8/1: 1.5 → 同点の8/2と8/3は日付順
    expect(ranked.map((r) => r.label)).toEqual([
      "8/2(日)",
      "8/3(月)",
      "8/1(土)",
    ]);
  });
});

describe("extractEventHash", () => {
  it("イベントURLからハッシュを取り出す", () => {
    expect(extractEventHash("https://chouseisan.com/s?h=abc123DEF")).toBe(
      "abc123DEF",
    );
  });

  it("ハッシュが無いURLはthrowする", () => {
    expect(() => extractEventHash("https://chouseisan.com/")).toThrow(
      "ハッシュ",
    );
  });
});
