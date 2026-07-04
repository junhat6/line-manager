import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "交流会運営支援",
  description: "交流会の案内・参加者管理・リマインドを抜け漏れなく進める",
};

export const viewport: Viewport = {
  // モバイルブラウザのUI色を背景(--background: 白)と揃える。
  // 参加状況ページはLINEアプリ内ブラウザで開かれるため見た目に直結する
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={cn("h-full antialiased", geist.variable)}>
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
