import { z } from "zod";

/**
 * LINEのpostbackボタンに埋め込むdata(最大300文字)のコントラクト。
 * 参加ボタン・取消ボタンの両方がこの形式を使う。
 */
export const postbackDataSchema = z.object({
  action: z.enum(["attend", "cancel"]),
  sessionId: z.uuid(),
});

export type PostbackData = z.infer<typeof postbackDataSchema>;

export function encodePostbackData(data: PostbackData): string {
  return JSON.stringify(data);
}

/** 不正なdataは例外にせずnullを返す(他ボットのpostback等が混ざりうるため) */
export function parsePostbackData(raw: string): PostbackData | null {
  try {
    return postbackDataSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
