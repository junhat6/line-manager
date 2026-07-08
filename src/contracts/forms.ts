import { z } from "zod";

/**
 * Server Actionの実行結果。UIはこれをトーストに変換して表示する。
 * 期待されるエラー(検証・業務エラー)はthrowせず戻り値で返すのがNext.jsの規約
 * (throwするとエラーページ行きになり、その場でリカバリできないため)。
 */
export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** 空文字はnullに、それ以外はhttp(s) URLのみ許可 */
const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\//.test(v), {
    message: "URLは http(s):// で始めてください",
  })
  .transform((v) => (v === "" ? null : v));

/** 空文字はnullに変換する自由入力 */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

export const createEventSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください"),
  sessions: z
    .array(z.object({ startAt: z.date() }))
    .min(1, "日程を1つ以上入力してください")
    .max(2),
});

export const updateSessionSchema = z.object({
  sessionId: z.uuid(),
  eventId: z.uuid(),
  startAt: z.date(),
  lineGroupId: optionalText,
  inviteLink: optionalUrl,
  slideUrl: optionalUrl,
  meetingInfo: optionalText,
  dayFlow: optionalText,
  /** 自動送信3種の予約日時。null=フォーム空欄(送信済みでdisabled等)で、変更しない */
  dayBeforeAt: z.date().nullable(),
  dayOfAt: z.date().nullable(),
  surveyAt: z.date().nullable(),
});

/** メイングループに投稿する本文。調整さんのURLは送信時に末尾へ付加される */
const pollMessage = z
  .string()
  .trim()
  .min(1, "グループに投稿するメッセージを入力してください")
  .max(4000, "メッセージが長すぎます(4000文字以内)");

/** 開始時刻 "HH:MM"。運用上30分刻みしか使わないため 00分/30分 のみ許可 */
const halfHourTime = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):(00|30)$/,
    "時刻は30分刻み(例 20:00、20:30)で指定してください",
  );

/** かんたん作成: 来月の全日程を候補にする。時刻は全候補共通 */
export const startSchedulePollSchema = z.object({
  message: pollMessage,
  time: halfHourTime,
});

/** カスタム作成: カレンダーで選んだ日付ごとに開始時刻を持つ */
export const startCustomSchedulePollSchema = z.object({
  message: pollMessage,
  candidates: z
    .array(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "候補日の形式が不正です"),
        time: halfHourTime,
      }),
    )
    .min(1, "候補日をカレンダーから1つ以上選んでください")
    .max(62, "候補日が多すぎます(62日以内にしてください)")
    .refine((cs) => new Set(cs.map((c) => c.date)).size === cs.length, {
      message: "同じ候補日が重複しています",
    }),
});

export const saveSettingsSchema = z.object({
  surveyUrlFirst: z.url({ error: "1回目用アンケートのURLが不正です" }),
  surveyUrlRepeat: z.url({ error: "2回目以降用アンケートのURLが不正です" }),
});
