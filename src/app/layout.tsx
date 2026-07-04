import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "交流会運営支援",
  description: "交流会の案内・参加者管理・リマインドを抜け漏れなく進める",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
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
      </body>
    </html>
  );
}
