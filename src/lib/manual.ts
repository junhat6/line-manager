export type ManualSection = {
  id: string;
  title: string;
  body: string;
};

export type ManualDocument = {
  intro: string;
  sections: ManualSection[];
};

/**
 * 運営マニュアル(docs/manual.md)を h2(章)単位で分割する。
 * 章ごとに折りたたみ表示するため、本文からh2見出し行を取り除いてsummary用のtitleに移す。
 * h2より前の部分(タイトル・導入文・ログイン情報の注意書き)はintroとして常に表示する。
 */
export function splitManualSections(markdown: string): ManualDocument {
  const lines = markdown.split("\n");
  const introLines: string[] = [];
  const sections: ManualSection[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (current) {
        sections.push(toSection(current, sections.length));
      }
      current = { title: heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      introLines.push(line);
    }
  }
  if (current) {
    sections.push(toSection(current, sections.length));
  }

  return { intro: introLines.join("\n").trim(), sections };
}

function toSection(
  section: { title: string; lines: string[] },
  index: number,
): ManualSection {
  return {
    id: `manual-section-${index + 1}`,
    title: section.title,
    body: section.lines.join("\n").trim(),
  };
}
