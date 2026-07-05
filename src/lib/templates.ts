import type { messagingApi } from "@line/bot-sdk";
import { encodePostbackData } from "@/contracts/postback";
import type {
  AnnounceInput,
  DayBeforeInput,
  DayOfInput,
  GroupInviteInput,
  PollUrlInput,
  SlideRequestInput,
  SurveyInput,
} from "@/contracts/templates";

type Message = messagingApi.Message;
type FlexComponent = messagingApi.FlexComponent;

/**
 * 開催アナウンス。日程ごとに「参加する」ボタンを置く。
 * postback に displayText を付けない — タップしてもトークに何も流れず、
 * LINE標準の投票と同じ静かな挙動になる(通知が増える方が害という運用判断)。
 * 押した本人へのフィードバックは「参加状況を確認」ボタン(公開ページ)が担う。
 */
export function buildAnnounceMessages(input: AnnounceInput): Message[] {
  const sessionBlocks: FlexComponent[] = input.sessions.flatMap(
    (s): FlexComponent[] => [
      {
        type: "button",
        style: "primary",
        height: "sm",
        action: {
          type: "postback",
          label: `${s.label} に参加`,
          data: encodePostbackData({ action: "attend", sessionId: s.sessionId }),
        },
      },
      {
        type: "button",
        style: "link",
        height: "sm",
        action: {
          type: "postback",
          label: `${s.label} を取り消す`,
          data: encodePostbackData({ action: "cancel", sessionId: s.sessionId }),
        },
      },
    ],
  );

  return [
    {
      type: "flex",
      altText: `【${input.eventTitle}】開催日程のお知らせ`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: `🎉 ${input.eventTitle}`,
              weight: "bold",
              size: "lg",
              wrap: true,
            },
            {
              type: "text",
              text: "以下の日程で開催します!\n参加する日程のボタンを押してください(両方参加もOK)\n※タップしてもトークには流れません。登録できたかは下の「参加状況を確認」から見られます",
              size: "sm",
              wrap: true,
            },
            ...sessionBlocks,
            { type: "separator" },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "uri",
                label: "参加状況を確認",
                uri: input.statusUrl,
              },
            },
          ],
        },
      },
    },
  ];
}

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
