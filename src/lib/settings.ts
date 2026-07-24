import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

export const SETTING_KEYS = {
  surveyUrlFirst: "survey_url_first",
  surveyUrlRepeat: "survey_url_repeat",
  leaveSurveyUrl: "leave_survey_url",
} as const;

type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * 要件で指定された定型アンケートURL。
 * DBに保存があればそちらを優先し、なければこのデフォルトを使う
 * (seedを不要にして初期セットアップの手順を減らすため)。
 */
export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  survey_url_first:
    "https://docs.google.com/forms/d/1uG--hgYSz0N4cExd-BR-nG8sc4B_HpfjXpxWykDoskI/viewform",
  survey_url_repeat:
    "https://docs.google.com/forms/d/1_gcDRUXR2NihNjgGcdsK1Bl_33FyhTmi2lmuxSNguUE/viewform",
  // 空 = 未設定。退会者へのキャンセル理由DMを送らず、Slack通知のみになる
  leave_survey_url: "",
};

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return rows[0]?.value ?? SETTING_DEFAULTS[key];
}

export async function setSetting(
  db: Db,
  key: SettingKey,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
