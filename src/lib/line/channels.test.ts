import { describe, expect, it } from "vitest";
import { parseLineChannels } from "./channels";

const BASE = {
  LINE_CHANNEL_ACCESS_TOKEN: "token-1",
  LINE_CHANNEL_SECRET: "secret-1",
};

describe("parseLineChannels", () => {
  it("1組のみ(既存構成)ならチャネル1だけを返す", () => {
    const channels = parseLineChannels(BASE);
    expect([...channels.keys()]).toEqual([1]);
    expect(channels.get(1)).toEqual({
      channel: 1,
      accessToken: "token-1",
      secret: "secret-1",
    });
  });

  it("連番の環境変数からチャネル2を解決する", () => {
    const channels = parseLineChannels({
      ...BASE,
      LINE_CHANNEL_2_ACCESS_TOKEN: "token-2",
      LINE_CHANNEL_2_SECRET: "secret-2",
    });
    expect([...channels.keys()]).toEqual([1, 2]);
    expect(channels.get(2)).toEqual({
      channel: 2,
      accessToken: "token-2",
      secret: "secret-2",
    });
  });

  it("secret だけ欠けている場合は欠けている変数名入りで throw する", () => {
    expect(() =>
      parseLineChannels({ ...BASE, LINE_CHANNEL_2_ACCESS_TOKEN: "token-2" }),
    ).toThrow("LINE_CHANNEL_2_SECRET");
  });

  it("token だけ欠けている場合も変数名入りで throw する", () => {
    expect(() =>
      parseLineChannels({ ...BASE, LINE_CHANNEL_2_SECRET: "secret-2" }),
    ).toThrow("LINE_CHANNEL_2_ACCESS_TOKEN");
  });

  it("連番が飛んでいても設定済みチャネルはそのまま使える(3が無くても2と4は有効)", () => {
    const channels = parseLineChannels({
      ...BASE,
      LINE_CHANNEL_2_ACCESS_TOKEN: "token-2",
      LINE_CHANNEL_2_SECRET: "secret-2",
      LINE_CHANNEL_4_ACCESS_TOKEN: "token-4",
      LINE_CHANNEL_4_SECRET: "secret-4",
    });
    expect([...channels.keys()]).toEqual([1, 2, 4]);
    expect(channels.has(3)).toBe(false);
  });

  it("LINE_CHANNEL_1_* 形式は誤設定として throw する(チャネル1は基本名を使う)", () => {
    expect(() =>
      parseLineChannels({
        ...BASE,
        LINE_CHANNEL_1_ACCESS_TOKEN: "dup",
        LINE_CHANNEL_1_SECRET: "dup",
      }),
    ).toThrow("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("チャネル1が未設定でも解析自体は通る(必須性は getEnv 側で担保)", () => {
    const channels = parseLineChannels({
      LINE_CHANNEL_2_ACCESS_TOKEN: "token-2",
      LINE_CHANNEL_2_SECRET: "secret-2",
    });
    expect(channels.has(1)).toBe(false);
    expect(channels.has(2)).toBe(true);
  });
});
