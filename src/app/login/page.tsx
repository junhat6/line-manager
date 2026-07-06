import type { Metadata } from "next";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * 管理画面のログインページ。
 * 未ログインアクセスは src/proxy.ts がここへリダイレクトし、元のURLを ?from= で渡す。
 * 送信先はServer Actionではなく専用Route Handler(/api/auth/login) —
 * proxyの認証免除を「そのパスへのPOST」だけに絞るため(Server Actionだと
 * actionIdのグローバルディスパッチに免除が波及する)。プレーンなformなのでJSなしでも動く。
 */

export const metadata: Metadata = {
  title: "ログイン",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm items-center px-5">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>交流会運営支援</CardTitle>
          <CardDescription>
            運営メンバー向けの管理画面です。運営マニュアルに記載のユーザー名とパスワードでログインしてください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/auth/login">
            {from && <input type="hidden" name="from" value={from} />}
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>ユーザー名またはパスワードが違います</AlertTitle>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="user">ユーザー名</FieldLabel>
                <Input id="user" name="user" autoComplete="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">パスワード</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button type="submit" className="w-full">
                ログイン
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
