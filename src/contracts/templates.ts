/**
 * メッセージテンプレートの変数コントラクト。
 * テンプレート実装(src/lib/templates.ts)はこの型だけに依存し、DBの形を知らない。
 */

export type GroupInviteInput = {
  /** 例: "7/18(土)" */
  dateLabel: string;
  inviteLink: string;
};

export type SlideRequestInput = {
  dateLabel: string;
  slideUrl: string;
};

export type DayBeforeInput = {
  dateLabel: string;
  /** 例: "19:00" */
  startTime: string;
  slideUrl: string;
};

export type DayOfInput = {
  dateLabel: string;
  startTime: string;
  meetingInfo: string;
  slideUrl: string;
  /** 未設定なら当日の流れのセクションを省略 */
  dayFlow: string | null;
};

export type SurveyInput = {
  firstTimeUrl: string;
  repeatUrl: string;
};

export type PollUrlInput = {
  /** 管理画面で編集できる本文(URLは含めない) */
  body: string;
  /** 調整さんのイベントページURL。本文の末尾に付加される */
  url: string;
};
