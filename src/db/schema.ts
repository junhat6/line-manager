import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", ["draft", "done"]);

export const groupKindEnum = pgEnum("group_kind", [
  "main",
  "session",
  "unknown",
]);

export const messageKindEnum = pgEnum("message_kind", [
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

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
}).enableRLS();

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
}).enableRLS();

/**
 * グループメンバーの記録。memberJoined webhookで表示名を控えておく。
 * 退会(memberLeft)イベントにはuserIdしか載らず、退会後はプロフィール取得APIも
 * 使えないため、退会通知に人間が読める名前を出すには参加時点の記録が唯一の手段。
 * この機能の導入前から参加しているメンバーは記録がない(通常ボットは既存メンバーの
 * 一覧取得APIを使えない)ので、displayNameが引けない退会はuserIdのまま通知する。
 */
export const lineGroupMembers = pgTable(
  "line_group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** LINEのグループID(lineGroups.lineGroupIdと同じ値空間。FKにしないのはグループ再招待でも記録を残すため) */
    lineGroupId: text("line_group_id").notNull(),
    lineUserId: text("line_user_id").notNull(),
    /** 参加時にプロフィール取得できなかった場合はnull */
    displayName: text("display_name"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 退会を検知した時刻。同じ人が再参加したらnullに戻す */
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.lineGroupId, t.lineUserId)],
).enableRLS();

/**
 * 送信キュー兼チェックリストの実体。
 * scheduledAt が null の行は手動送信(管理画面のボタン)、非null の行は cron tick が拾う。
 */
export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
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
}).enableRLS();

export const pollStatusEnum = pgEnum("poll_status", ["open", "imported"]);

/**
 * 日程調整の候補1件。調整さんに登録したラベルと、その候補の開催開始日時のペア。
 * ラベルは取込時にCSVの行と突き合わせるキーなので、登録後に変えてはいけない。
 */
export type PollCandidate = {
  /** 調整さんの候補欄に登録したラベル。例: "8/1(土) 20:00" */
  label: string;
  /** 開催開始日時(ISO 8601)。取込時にセッションのstartAtになる */
  startAt: string;
};

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
  /**
   * 候補日の対象月(その月の1日 JST)。管理画面の「対象: ◯月」表示と、
   * candidates が null の既存行で候補ラベル「7/18(土)」→日付を復元するのに使う。
   * 候補が月をまたぐ場合は最初(最早)の候補日の月。
   */
  targetMonth: timestamp("target_month", { withTimezone: true }).notNull(),
  /**
   * 調整さんに登録した候補の一覧。取込時はラベルでCSV行と突き合わせ、
   * startAt がそのままイベント日程になる。
   * null はカラム追加前の既存行で、targetMonth + M/Dパース + 19:00 の旧ロジックで復元する。
   */
  candidates: jsonb("candidates").$type<PollCandidate[]>(),
  status: pollStatusEnum("status").notNull().default("open"),
  /** 回答の締切日時。cronがこれを過ぎたopenな行を検知して自動取込する(nullは締切未設定=自動取込の対象外) */
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  /**
   * cronが締切超過を処理済みの印。statusとは独立して持つ — 0票で締切を迎えた場合は
   * イベントを作らずstatusをopenのまま(手動の「結果を取り込む」を使えるように)残したいが、
   * 同じ行を次回のtickで再処理しないためのフラグが別途必要なため
   */
  deadlineHandledAt: timestamp("deadline_handled_at", { withTimezone: true }),
  /**
   * 締切当日のリマインドをメイングループに送信済みの印(冪等フラグ)。
   * リマインド予定時刻(締切日17:00 JST)の算出はアプリ側(computeReminderAt)で行い、
   * ここではdeadlineHandledAtと同じ「一度送ったら二度と送らない」の担保のみを持つ。
   * 送信失敗時もセットしたままにし、自動リトライはしない(復旧は管理画面の手動送信)。
   */
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  /**
   * 取込処理(importPollResults)がこの行をクレーム中である印。
   * 手動の「結果を取り込む」ボタンとcronの自動取込がほぼ同時に走ると、
   * 両方が同じ調整さんCSVから重複してイベントを作ってしまう(片方のイベントの
   * 予約メッセージが孤立したまま実際に送信される)ため、両者が共通で経由する
   * importPollResults の入口でここをクレームして片方を弾く
   */
  importingAt: timestamp("importing_at", { withTimezone: true }),
  /** URLをメイングループに投稿した時刻(nullなら未投稿=投稿失敗の可能性) */
  postedAt: timestamp("posted_at", { withTimezone: true }),
  /** 取込で作成されたイベント。イベント削除時はnullに戻る(調整の履歴は残す) */
  importedEventId: uuid("imported_event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/** key-value設定(メイングループID、アンケートURLなど) */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
}).enableRLS();

export type Event = typeof events.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type LineGroup = typeof lineGroups.$inferSelect;
export type LineGroupMember = typeof lineGroupMembers.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type SchedulePoll = typeof schedulePolls.$inferSelect;
