/** 定型メッセージ5種。scheduled_messages.kind と1対1で対応する */
export const MESSAGE_KINDS = [
  "group_invite",
  "slide_request",
  "day_before",
  "day_of",
  "survey",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  group_invite: "日程別グループ案内",
  slide_request: "自己紹介スライド案内",
  // 送信時刻は日程ごとに変更できるため、ラベルに時刻を焼き込まない
  // (実際の予約時刻はチェックリストの状態列に出る)
  day_before: "前日案内",
  day_of: "当日案内",
  survey: "終了後アンケート",
};

/** 手動送信(ボタン)か自動送信(cron)か。チェックリスト表示と行生成の両方が参照する */
export const MESSAGE_KIND_TRIGGER: Record<MessageKind, "manual" | "auto"> = {
  group_invite: "manual",
  slide_request: "manual",
  day_before: "auto",
  day_of: "auto",
  survey: "auto",
};
