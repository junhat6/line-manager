/** 定型メッセージ6種。scheduled_messages.kind と1対1で対応する */
export const MESSAGE_KINDS = [
  "announce",
  "group_invite",
  "slide_request",
  "day_before",
  "day_of",
  "survey",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  announce: "開催アナウンス(参加ボタン付き)",
  group_invite: "日程別グループ案内",
  slide_request: "自己紹介スライド案内",
  day_before: "前日案内(前日15:00)",
  day_of: "当日案内(当日9:00)",
  survey: "終了後アンケート",
};

/** 手動送信(ボタン)か自動送信(cron)か。チェックリスト表示と行生成の両方が参照する */
export const MESSAGE_KIND_TRIGGER: Record<MessageKind, "manual" | "auto"> = {
  announce: "manual",
  group_invite: "manual",
  slide_request: "manual",
  day_before: "auto",
  day_of: "auto",
  survey: "auto",
};
