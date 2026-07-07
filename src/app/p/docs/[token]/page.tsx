import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAppBaseUrl } from "@/lib/env";

/**
 * 運営マニュアルの限定公開ページ。
 * /p/ 配下のGET/HEADは src/proxy.ts で管理画面ログインが免除され、
 * 推測不能なURL(DOCS_TOKEN)自体が認可を兼ねる。
 * 管理画面ログインのID/パスワードを表示するページなので:
 * - 原稿(docs/manual.md)には秘密を書かず、envからリクエスト時に描画する
 *   (リポジトリに秘密が残らず、パスワード変更も自動で反映される)
 * - force-dynamic は必須: 静的化すると資格情報入りHTMLがビルド成果物や共有キャッシュに固定される
 * - DOCS_TOKEN 未設定・不一致はどちらも404(fail closed。ページの存在自体を隠す)
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "運営マニュアル",
  // トークン付きURLのページなので検索エンジンに載せない
  robots: { index: false, follow: false },
  // 本文の外部リンク(調整さん等)を踏んだときにトークン付きURLがRefererで漏れるのを防ぐ
  referrer: "no-referrer",
};

// next.config.ts の outputFileTracingIncludes がこのファイルをサーバーレスバンドルに同梱する
const MANUAL_PATH = path.join(process.cwd(), "docs/manual.md");

// 原稿はデプロイ単位で不変なのでインスタンス内で1回だけ読む(開発中は編集を即反映したいので毎回読む)
let manualCache: string | undefined;
async function readManual(): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    return readFile(MANUAL_PATH, "utf-8");
  }
  manualCache ??= await readFile(MANUAL_PATH, "utf-8");
  return manualCache;
}

// 文字列比較の応答時間差からトークンを推測されないようにする
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export default async function ManualPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const expected = process.env.DOCS_TOKEN;
  if (!expected || !safeEqual(token, expected)) notFound();

  const manual = await readManual();
  const adminUser = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;
  let adminUrl: string | null;
  try {
    adminUrl = getAppBaseUrl();
  } catch {
    adminUrl = null; // ベースURL未解決(ローカル等)でもマニュアル自体は表示する
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>管理画面のログイン情報</CardTitle>
          <CardDescription>
            管理画面を開くとログイン画面が表示されるので、以下のIDとパスワードを入力してください。運営メンバー以外に共有しないでください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {adminUser && adminPassword ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">URL</dt>
              <dd className="break-all">
                {adminUrl ? (
                  <a href={adminUrl} className="underline underline-offset-3">
                    {adminUrl}
                  </a>
                ) : (
                  "このページと同じドメインのトップページ(/)"
                )}
              </dd>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="font-mono break-all">{adminUser}</dd>
              <dt className="text-muted-foreground">パスワード</dt>
              <dd className="font-mono break-all">{adminPassword}</dd>
            </dl>
          ) : (
            <p className="text-sm text-destructive">
              ADMIN_USER / ADMIN_PASSWORD
              が未設定です。Vercelの環境変数を確認してください。
            </p>
          )}
        </CardContent>
      </Card>

      <Markdown>{manual}</Markdown>
    </main>
  );
}
