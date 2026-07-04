import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// モジュールロード時ではなく初回アクセス時に検証する。
// トップレベルで parse すると `next build` が環境変数なしの環境で失敗するため。
export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
