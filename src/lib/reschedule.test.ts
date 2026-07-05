import { describe, expect, it } from "vitest";
import { resolveScheduledAt } from "./reschedule";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const at = (iso: string) => new Date(iso);

describe("resolveScheduledAt", () => {
  it("フォームが空欄(送信済みでdisabled等)なら変更しない", () => {
    expect(
      resolveScheduledAt(null, at("2026-07-17T06:00:00Z"), DAY_MS),
    ).toBeNull();
  });

  it("ユーザーが変更した値(DB値と不一致)はそのまま尊重する", () => {
    const custom = at("2026-07-17T09:00:00Z");
    expect(
      resolveScheduledAt(custom, at("2026-07-17T06:00:00Z"), 2 * DAY_MS),
    ).toEqual(custom);
  });

  it("触っていない値(DB値と一致)は開催日時の変更量だけ追従する", () => {
    const current = at("2026-07-17T06:00:00Z");
    expect(resolveScheduledAt(current, current, 7 * DAY_MS)).toEqual(
      at("2026-07-24T06:00:00Z"),
    );
  });

  it("カスタマイズ済みの時刻も、その後の開催日変更には相対位置を保って追従する", () => {
    // 前日18:00に変えて保存済み → フォーム値=DB値。開催日を1日ずらすと18:00のまま1日ずれる
    const customized = at("2026-07-17T09:00:00Z");
    expect(resolveScheduledAt(customized, customized, DAY_MS)).toEqual(
      at("2026-07-18T09:00:00Z"),
    );
  });

  it("開催日時が変わっていなければ(shift=0)同じ値を返す(failed行の再アームに使う)", () => {
    const current = at("2026-07-17T06:00:00Z");
    expect(resolveScheduledAt(current, current, 0)).toEqual(current);
  });

  it("DB値がnullの行にフォームから新しい日時を入れられる", () => {
    const formValue = at("2026-07-18T12:00:00Z");
    expect(resolveScheduledAt(formValue, null, DAY_MS)).toEqual(formValue);
  });
});
