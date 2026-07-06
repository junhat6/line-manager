import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { Button } from "@/components/ui/button";

/**
 * 管理画面共通のナビ。route group (admin) に閉じ込める —
 * 参加者向け公開ページ(/p/[token])に管理画面へのリンクを見せない
 * (踏むとログイン画面に飛ばされて参加者を混乱させる)ため。
 */
export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:ring-3 focus:ring-ring/50"
      >
        本文へスキップ
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link
            href="/"
            className="rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            交流会運営支援
          </Link>
          <AdminNav />
          {/* JS不要のプレーンなform。遷移先でcookieが失効するので画面更新の考慮も不要 */}
          <form method="post" action="/api/auth/logout" className="ml-auto">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              ログアウト
            </Button>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-8">
        {children}
      </main>
    </>
  );
}
