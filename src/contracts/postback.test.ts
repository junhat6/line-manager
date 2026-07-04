import { describe, expect, it } from "vitest";
import { encodePostbackData, parsePostbackData } from "./postback";

describe("postback data contract", () => {
  it("エンコードとパースで往復できる", () => {
    const data = {
      action: "attend" as const,
      sessionId: "0d4ee5c2-7c3a-4c4c-9a5e-4f8a0d9b6c1a",
    };
    const encoded = encodePostbackData(data);
    // LINEのpostback dataは最大300文字
    expect(encoded.length).toBeLessThanOrEqual(300);
    expect(parsePostbackData(encoded)).toEqual(data);
  });

  it("不正なデータはnull(例外にしない)", () => {
    expect(parsePostbackData("not json")).toBeNull();
    expect(parsePostbackData("{}")).toBeNull();
    expect(
      parsePostbackData(JSON.stringify({ action: "attend", sessionId: "x" })),
    ).toBeNull();
    expect(
      parsePostbackData(
        JSON.stringify({
          action: "explode",
          sessionId: "0d4ee5c2-7c3a-4c4c-9a5e-4f8a0d9b6c1a",
        }),
      ),
    ).toBeNull();
  });
});
