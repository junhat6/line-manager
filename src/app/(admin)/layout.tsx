import Link from "next/link";

/**
 * 管理画面共通のナビ。route group (admin) に閉じ込める —
 * 参加者向け公開ページ(/p/[token])に管理画面へのリンクを見せない
 * (踏むとBasic認証ダイアログが出て参加者を混乱させる)ため。
 */
export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-bold">
            🎉 交流会運営支援
          </Link>
          <Link href="/" className="text-sm hover:underline">
            イベント
          </Link>
          <Link href="/polls" className="text-sm hover:underline">
            日程調整
          </Link>
          <Link href="/groups" className="text-sm hover:underline">
            グループ
          </Link>
          <Link href="/settings" className="text-sm hover:underline">
            設定
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </>
  );
}
