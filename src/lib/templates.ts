import type { messagingApi } from "@line/bot-sdk";
import type {
  DayBeforeInput,
  DayOfInput,
  GroupInviteInput,
  LeaveSurveyInput,
  PollReminderInput,
  PollUrlInput,
  SlideRequestInput,
  SurveyInput,
} from "@/contracts/templates";

type Message = messagingApi.Message;

export function buildGroupInviteMessages(input: GroupInviteInput): Message[] {
  return [
    {
      type: "text",
      text: [
        `【${input.dateLabel}】に参加のみなさんへ`,
        "",
        "日程別のLINEグループを作成しました。",
        "こちらから参加をお願いします👇",
        input.inviteLink,
      ].join("\n"),
    },
  ];
}

export function buildSlideRequestMessages(input: SlideRequestInput): Message[] {
  return [
    {
      type: "text",
      text: [
        `【${input.dateLabel}】参加のみなさんへ`,
        "",
        "自己紹介スライドの記入をお願いします📝",
        input.slideUrl,
        "",
        "まだ書いていない人は、当日までに記入をお願いします!",
      ].join("\n"),
    },
  ];
}

export function buildDayBeforeMessages(input: DayBeforeInput): Message[] {
  return [
    {
      type: "text",
      text: [
        `いよいよ明日【${input.dateLabel}】は交流会です!🎉`,
        "",
        `⏰ 開始時間: ${input.startTime}`,
        "",
        "📝 自己紹介スライド",
        input.slideUrl,
        "",
        "まだ書いていない人は、今日中の記入をお願いします!",
      ].join("\n"),
    },
  ];
}

export function buildDayOfMessages(input: DayOfInput): Message[] {
  const lines = [
    `本日【${input.dateLabel}】は交流会です!🎉`,
    "",
    `⏰ 開始時間: ${input.startTime}`,
    "",
    "🚪 参加方法",
    input.meetingInfo,
    "",
    "📝 自己紹介スライド",
    input.slideUrl,
  ];
  if (input.dayFlow) {
    lines.push("", "📋 当日の流れ", input.dayFlow);
  }
  lines.push("", "それでは、のちほどお会いしましょう!");
  return [{ type: "text", text: lines.join("\n") }];
}

/**
 * 日程調整URL投稿の既定本文。
 * 開始フォームのプリフィルと、本文カラム追加前の既存行のフォールバックの両方で使う
 * (2箇所が同じ文面である保証をここで持つ)。
 */
export function defaultPollMessageBody(month: number): string {
  return [
    `📅 ${month}月交流会の日程調整です!`,
    "参加できる日の入力をお願いします👇",
  ].join("\n");
}

/** 日程調整のURL投稿。本文は管理画面で編集できるため、URLの付加だけを担う */
export function buildPollUrlMessages(input: PollUrlInput): Message[] {
  return [{ type: "text", text: `${input.body}\n${input.url}` }];
}

/** 日程調整の締切当日リマインド。締切を過ぎる前の最後の呼びかけとして送る */
export function buildPollReminderMessages(input: PollReminderInput): Message[] {
  return [
    {
      type: "text",
      text: [
        `⏰【${input.title}】の回答締切は本日${input.deadlineTime}までです!`,
        "まだの方はお早めにお願いします🙏",
        input.url,
      ].join("\n"),
    },
  ];
}

/**
 * 日程別グループを開催前に退会した人へのキャンセル理由ヒアリングDM。
 * 責める印象を与えないよう「参考にしたい」の一言を添える(回答率にも効く)。
 */
export function buildLeaveSurveyMessages(input: LeaveSurveyInput): Message[] {
  return [
    {
      type: "text",
      text: [
        `【${input.dateLabel}】の交流会グループからの退会を確認しました。`,
        "",
        "今後の運営の参考にしたいので、",
        "よろしければキャンセルの理由を教えてください🙏",
        input.formUrl,
      ].join("\n"),
    },
  ];
}

/** 要件で指定された定型文そのまま。URLのみsettingsで差し替え可能 */
export function buildSurveyMessages(input: SurveyInput): Message[] {
  return [
    {
      type: "text",
      text: [
        "◯交流会参加者アンケート",
        "",
        "▽回答が1回目の方用",
        input.firstTimeUrl,
        "",
        "▽回答が2回目以降の方用",
        input.repeatUrl,
      ].join("\n"),
    },
  ];
}
