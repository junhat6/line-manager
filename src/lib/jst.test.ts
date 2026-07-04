import { describe, expect, it } from "vitest";
import {
  dayBeforeAt15,
  dayOfAt9,
  defaultSurveyAt,
  formatJstDateLabel,
  formatJstDateTimeLabel,
  formatJstForInput,
  parseJstFromInput,
} from "./jst";

describe("jst", () => {
  const startAt = new Date("2026-07-18T19:00:00+09:00");

  it("前日15:00 JST を計算する", () => {
    expect(dayBeforeAt15(startAt).toISOString()).toBe(
      new Date("2026-07-17T15:00:00+09:00").toISOString(),
    );
  });

  it("月をまたぐ前日15:00 も正しい", () => {
    const aug1 = new Date("2026-08-01T19:00:00+09:00");
    expect(dayBeforeAt15(aug1).toISOString()).toBe(
      new Date("2026-07-31T15:00:00+09:00").toISOString(),
    );
  });

  it("当日9:00 JST を計算する", () => {
    expect(dayOfAt9(startAt).toISOString()).toBe(
      new Date("2026-07-18T09:00:00+09:00").toISOString(),
    );
  });

  it("アンケートのデフォルトは当日21:00 JST", () => {
    expect(defaultSurveyAt(startAt).toISOString()).toBe(
      new Date("2026-07-18T21:00:00+09:00").toISOString(),
    );
  });

  it("日付ラベルをJSTの曜日付きで整形する", () => {
    expect(formatJstDateLabel(startAt)).toBe("7/18(土)");
    expect(formatJstDateTimeLabel(startAt)).toBe("7/18(土) 19:00");
  });

  it("UTC境界をまたいでもJSTの日付になる", () => {
    // JST 7/18 00:30 = UTC 7/17 15:30。UTCで整形すると日付がずれる
    const midnight = new Date("2026-07-18T00:30:00+09:00");
    expect(formatJstDateLabel(midnight)).toBe("7/18(土)");
  });

  it("datetime-local の値と往復できる", () => {
    expect(formatJstForInput(startAt)).toBe("2026-07-18T19:00");
    expect(parseJstFromInput("2026-07-18T19:00").toISOString()).toBe(
      startAt.toISOString(),
    );
  });

  it("不正な日時文字列は例外", () => {
    expect(() => parseJstFromInput("invalid")).toThrow();
  });
});
