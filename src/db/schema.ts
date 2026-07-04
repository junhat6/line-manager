import {
  boolean,
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
