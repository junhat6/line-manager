import type { Metadata } from "next";
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
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
