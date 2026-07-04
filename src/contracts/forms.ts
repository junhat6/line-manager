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
  surveyAt: z.date().nullable(),
});

export const saveSettingsSchema = z.object({
  surveyUrlFirst: z.url({ error: "1回目用アンケートのURLが不正です" }),
  surveyUrlRepeat: z.url({ error: "2回目以降用アンケートのURLが不正です" }),
});
