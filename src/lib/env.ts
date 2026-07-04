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

/**
 * 参加状況の公開ページURLを組み立てるためのベースURL。
 * envSchema には入れない — Vercel 上では VERCEL_PROJECT_PRODUCTION_URL から
 * 自動解決できるので必須にすると逆に手間が増える。APP_BASE_URL は
 * 独自ドメイン等で明示したい場合の上書き用(そちらが優先)。
 * 未設定ならアナウンス組み立て時に例外→チェックリストに理由が表示される。
 */
export function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelHost) return `https://${vercelHost}`;
  throw new Error(
    "APP_BASE_URL が未設定です(参加状況ページのURLをアナウンスに載せるため、アプリの公開URLを設定してください)",
  );
}
