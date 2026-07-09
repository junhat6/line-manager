import { describe, expect, it } from "vitest";
import {
  buildMonthCandidateDates,
  extractEventHash,
  nextMonthStart,
  parseChouseisanCsv,
  parseCsvRows,
  rankCandidates,
  tallyChouseisanCsvByLabel,
  toPollCandidates,
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

describe("buildMonthCandidateDates", () => {
  it("対象月の全日を共通時刻で並べる(2026年8月=31日)", () => {
    const dates = buildMonthCandidateDates(jstToUtc(2026, 8, 1), 20, 0);
    expect(dates).toHaveLength(31);
    expect(dates[0]).toEqual(jstToUtc(2026, 8, 1, 20, 0));
    expect(dates[30]).toEqual(jstToUtc(2026, 8, 31, 20, 0));
  });

  it("うるう年でない2月は28日まで", () => {
    const dates = buildMonthCandidateDates(jstToUtc(2026, 2, 1), 20, 30);
    expect(dates).toHaveLength(28);
    expect(dates[27]).toEqual(jstToUtc(2026, 2, 28, 20, 30));
  });
});

describe("toPollCandidates", () => {
  it("日時をラベル化し、昇順に並べる", () => {
    const candidates = toPollCandidates([
      jstToUtc(2026, 8, 2, 13, 30),
      jstToUtc(2026, 8, 1, 20, 0),
    ]);
    expect(candidates).toEqual([
      {
        label: "8/1(土) 20:00",
        startAt: jstToUtc(2026, 8, 1, 20, 0).toISOString(),
      },
      {
        label: "8/2(日) 13:30",
        startAt: jstToUtc(2026, 8, 2, 13, 30).toISOString(),
      },
    ]);
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

  it("名前ヘッダー行(候補行の直前行)と列位置を突き合わせて誰が投票したか返す", () => {
    const results = parseChouseisanCsv(SAMPLE_CSV, targetMonth);
    expect(results[0].voters).toEqual({
      attend: ["山田"],
      maybe: ["佐藤"],
      absent: ["田中"],
    });
  });
});

describe("tallyChouseisanCsvByLabel", () => {
  const candidates = toPollCandidates([
    jstToUtc(2026, 8, 1, 20, 0),
    jstToUtc(2026, 8, 8, 13, 30),
    jstToUtc(2026, 9, 5, 20, 0),
  ]);
  const csv = [
    "8月交流会 日程調整",
    "○△×で入力してください",
    "日程,山田,田中,佐藤",
    "8/1(土) 20:00,○,×,△",
    "8/8(土) 13:30,○,○,×",
    "9/5(土) 20:00,△,,×",
    "コメント,よろしく!,,",
  ].join("\n");

  it("保存した候補ラベルと一致する行だけを集計し、開始日時を復元する", () => {
    const results = tallyChouseisanCsvByLabel(csv, candidates);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      label: "8/1(土) 20:00",
      attend: 1,
      maybe: 1,
      absent: 1,
      score: 1.5,
    });
    expect(results[0].date).toEqual(jstToUtc(2026, 8, 1, 20, 0));
    // 月をまたぐ候補も候補一覧に基づいて正しい年月に復元される
    expect(results[2].date).toEqual(jstToUtc(2026, 9, 5, 20, 0));
  });

  it("候補に無いラベルの行(ヘッダ・コメント)は無視する", () => {
    const results = tallyChouseisanCsvByLabel(csv, candidates);
    expect(results.map((r) => r.label)).toEqual([
      "8/1(土) 20:00",
      "8/8(土) 13:30",
      "9/5(土) 20:00",
    ]);
  });

  it("同じラベルが複数回現れたら最初の行だけ採用する", () => {
    const dup = ["8/1(土) 20:00,○", "8/1(土) 20:00,×"].join("\n");
    const results = tallyChouseisanCsvByLabel(
      dup,
      toPollCandidates([jstToUtc(2026, 8, 1, 20, 0)]),
    );
    expect(results).toHaveLength(1);
    expect(results[0].attend).toBe(1);
  });

  it("名前ヘッダー行と列位置を突き合わせて誰が投票したか返す", () => {
    const results = tallyChouseisanCsvByLabel(csv, candidates);
    expect(results[0].voters).toEqual({
      attend: ["山田"],
      maybe: ["佐藤"],
      absent: ["田中"],
    });
  });

  it("名前ヘッダー行が無い(先頭行が候補行)場合は「N人目」にフォールバックする", () => {
    const noHeader = ["8/1(土) 20:00,○,×"].join("\n");
    const results = tallyChouseisanCsvByLabel(
      noHeader,
      toPollCandidates([jstToUtc(2026, 8, 1, 20, 0)]),
    );
    expect(results[0].voters).toEqual({
      attend: ["1人目"],
      maybe: [],
      absent: ["2人目"],
    });
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
