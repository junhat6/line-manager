import { describe, expect, it } from "vitest";
import { splitManualSections } from "./manual";

describe("splitManualSections", () => {
  it("h2より前をintro、以降を章ごとのsectionに分ける", () => {
    const md = [
      "# タイトル",
      "導入文です。",
      "",
      "## 1. はじめに",
      "本文A",
      "",
      "### 1.1 小見出し",
      "本文B",
      "",
      "## 2. つぎの章",
      "本文C",
    ].join("\n");

    const doc = splitManualSections(md);

    expect(doc.intro).toBe("# タイトル\n導入文です。");
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]).toEqual({
      id: "manual-section-1",
      title: "1. はじめに",
      body: "本文A\n\n### 1.1 小見出し\n本文B",
    });
    expect(doc.sections[1]).toEqual({
      id: "manual-section-2",
      title: "2. つぎの章",
      body: "本文C",
    });
  });

  it("h2が無ければsectionsは空でintroだけになる", () => {
    const doc = splitManualSections("# タイトル\n本文のみ");
    expect(doc.intro).toBe("# タイトル\n本文のみ");
    expect(doc.sections).toEqual([]);
  });
});
