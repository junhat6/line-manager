/**
 * 調整さん実APIとの疎通確認。実行のたびに調整さん上に捨てイベントを作るため、
 * 通常の `npm test` ではスキップし、明示オプトインでのみ実行する:
 *   CHOUSEISAN_E2E=1 npx vitest run src/lib/chouseisan.integration.test.ts
 * 調整さん連携が壊れた疑いがあるときの切り分けに使う。
 */
import { describe, expect, it } from "vitest";
import {
  createChouseisanEvent,
  fetchChouseisanCsv,
  parseChouseisanCsv,
} from "./chouseisan";
import { jstToUtc } from "./jst";

describe.skipIf(!process.env.CHOUSEISAN_E2E)("調整さん実API疎通", () => {
  it("イベント作成 → CSV取得 → パースが通しで動く", async () => {
    const { url } = await createChouseisanEvent({
      title: "接続テスト(無視してください)",
      comment: "line-manager の動作確認用です",
      candidates: ["8/1(土)", "8/2(日)"],
    });
    expect(url).toMatch(/^https:\/\/chouseisan\.com\/s\?h=/);

    const csv = await fetchChouseisanCsv(url);
    expect(csv).toContain("8/1(土)");

    const results = parseChouseisanCsv(csv, jstToUtc(2026, 8, 1));
    expect(results.map((r) => r.label)).toEqual(["8/1(土)", "8/2(日)"]);
    expect(results.every((r) => r.score === 0)).toBe(true);
  }, 30_000);
});
