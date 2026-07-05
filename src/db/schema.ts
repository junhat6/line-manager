import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "announced",
  "done",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "attending",
  "cancelled",
]);

export const attendanceSourceEnum = pgEnum("attendance_source", [
  "postback",
  "manual",
]);

export const groupKindEnum = pgEnum("group_kind", [
  "main",
  "session",
  "unknown",
]);

export const messageKindEnum = pgEnum("message_kind", [
  "announce",
  "group_invite",
  "slide_request",
  "day_before",
  "day_of",
  "survey",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
]);

/** 交流会の「回」(例: 7月交流会)。1回につき開催日程(sessions)を通常2つ持つ */
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  status: eventStatusEnum("status").notNull().default("draft"),
  /**
   * 参加状況の公開ページ(/p/[token])用トークン。
   * id とは別に持つ — id は管理画面URLに露出しており、公開を止めたくなったら
   * このトークンだけ無効化(再生成)できる余地を残すため。
   */
  publicToken: uuid("public_token").notNull().defaultRandom().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** 開催日程。日程別LINEグループ・スライドURLなどはここに紐づく */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  meetingInfo: text("meeting_info"),
  dayFlow: text("day_flow"),
  slideUrl: text("slide_url"),
  /** 日程別LINEグループのID(管理画面で紐付けるまでnull) */
  lineGroupId: text("line_group_id"),
  /** 日程別グループの招待リンク(運営者がLINEアプリで発行して貼る) */
  inviteLink: text("invite_link"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** LINEユーザー。postback受信時に自動登録。手動追加は lineUserId が "manual:" 始まり */
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  lineUserId: text("line_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  pictureUrl: text("picture_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** 日程ごとの参加表明。(sessionId, memberId) で一意 = ボタン連打しても1レコード */
export const attendances = pgTable(
  "attendances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum("status").notNull().default("attending"),
    source: attendanceSourceEnum("source").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attendances_session_member_uq").on(t.sessionId, t.memberId),
  ],
);

/** ボットが参加しているLINEグループ。joinイベントで自動登録 */
export const lineGroups = pgTable("line_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  lineGroupId: text("line_group_id").notNull().unique(),
  name: text("name"),
  kind: groupKindEnum("kind").notNull().default("unknown"),
  active: boolean("active").notNull().default(true),
  /**
   * このグループに参加しているボットのLINEチャネル番号(環境変数の連番に対応)。
   * joinイベントで自動記録される。グループ↔チャネルの唯一の真実源で、
   * 送信時はここを参照して使うボットを決める。
   */
  channel: integer("channel").notNull().default(1),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 送信キュー兼チェックリストの実体。
 * scheduledAt が null の行は手動送信(管理画面のボタン)、非null の行は cron tick が拾う。
 */
export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  /** announce はイベント全体宛のため null */
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "cascade",
  }),
  kind: messageKindEnum("kind").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: messageStatusEnum("status").notNull().default("pending"),
  /** 二重送信防止のclaim時刻。sendingのまま古い行は中断とみなしfailedへ */
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pollStatusEnum = pgEnum("poll_status", ["open", "imported"]);

/**
 * 調整さん(chouseisan.com)の日程調整。
 * 管理画面の「日程調整を開始」で調整さんイベントを作成してURLを記録し、
 * 「結果を取り込む」でCSVを集計して上位2日程のイベント(events)に変換する。
 */
export const schedulePolls = pgTable("schedule_polls", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** 調整さんのイベントページURL(グループに共有するもの) */
  chouseisanUrl: text("chouseisan_url").notNull(),
  /**
   * グループ投稿の本文(開始フォームで編集可能)。URLは送信時に末尾へ付加する。
   * null はカラム追加前の既存行で、既定文面にフォールバックする。
   */
  message: text("message"),
  /** 候補日の対象月(その月の1日 JST)。候補ラベル「7/18(土)」→日付の復元に使う */
  targetMonth: timestamp("target_month", { withTimezone: true }).notNull(),
  status: pollStatusEnum("status").notNull().default("open"),
  /** URLをメイングループに投稿した時刻(nullなら未投稿=投稿失敗の可能性) */
  postedAt: timestamp("posted_at", { withTimezone: true }),
  /** 取込で作成されたイベント。イベント削除時はnullに戻る(調整の履歴は残す) */
  importedEventId: uuid("imported_event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** key-value設定(メイングループID、アンケートURLなど) */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Event = typeof events.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type LineGroup = typeof lineGroups.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type SchedulePoll = typeof schedulePolls.$inferSelect;
