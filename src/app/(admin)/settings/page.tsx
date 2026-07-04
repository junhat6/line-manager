import { and, eq } from "drizzle-orm";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { saveSettings } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastForm } from "@/components/ToastForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db/client";
import { lineGroups } from "@/db/schema";
import { getChannelQuotas } from "@/lib/line/quota";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = getDb();
  // 互いに依存しない読み取りは並列化してTTFBを縮める
  // (LINE APIを呼ぶgetChannelQuotasが特に遅く、直列だと合算で待つことになる)
  const [surveyUrlFirst, surveyUrlRepeat, mainRows, quotas] = await Promise.all([
    getSetting(db, SETTING_KEYS.surveyUrlFirst),
    getSetting(db, SETTING_KEYS.surveyUrlRepeat),
    db
      .select()
      .from(lineGroups)
      .where(and(eq(lineGroups.kind, "main"), eq(lineGroups.active, true))),
    getChannelQuotas(),
  ]);
  const mainGroup = mainRows[0];

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-xl font-semibold">設定</h1>

      <Card>
        <CardHeader>
          <CardTitle>メイングループ</CardTitle>
          <CardDescription>
            全体アナウンスの送信先になるLINEグループです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mainGroup ? (
            <p className="inline-flex items-center gap-1.5 text-sm">
              <CheckIcon className="size-4 text-success" />
              {mainGroup.name ?? mainGroup.lineGroupId}
            </p>
          ) : (
            <Alert>
              <TriangleAlertIcon className="text-warning" />
              <AlertTitle>未設定です</AlertTitle>
              <AlertDescription>
                <Link href="/groups">グループ画面</Link>
                で全体アナウンス用のグループを「メイン」に設定してください。
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>LINEチャネルと無料枠</CardTitle>
          <CardDescription>
            グループ宛のpushはグループ人数分カウントされます。当月の実測値です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {quotas.map((q) => (
              <li
                key={q.channel}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
              >
                {q.ok ? (
                  <>
                    <span>チャネル{q.channel}</span>
                    <span className="tabular-nums">
                      <span className="font-medium">{q.totalUsage}</span>
                      <span className="text-muted-foreground">
                        {q.limit !== null
                          ? ` / ${q.limit}通`
                          : " 通(上限なしプラン)"}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="text-destructive">
                    チャネル{q.channel}: 消費量を取得できませんでした({q.error})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>アンケートURL</CardTitle>
          <CardDescription>
            イベント後に自動送信されるアンケートのリンク先です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToastForm action={saveSettings}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="surveyUrlFirst">
                  回答が1回目の方用
                </FieldLabel>
                <Input
                  id="surveyUrlFirst"
                  type="url"
                  name="surveyUrlFirst"
                  required
                  spellCheck={false}
                  placeholder="https://…"
                  defaultValue={surveyUrlFirst}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="surveyUrlRepeat">
                  回答が2回目以降の方用
                </FieldLabel>
                <Input
                  id="surveyUrlRepeat"
                  type="url"
                  name="surveyUrlRepeat"
                  required
                  spellCheck={false}
                  placeholder="https://…"
                  defaultValue={surveyUrlRepeat}
                />
              </Field>
              {/* Fieldの中に置くと *:w-full で全幅に伸ばされるためFieldGroup直下に置く */}
              <SubmitButton className="w-fit">保存する</SubmitButton>
            </FieldGroup>
          </ToastForm>
        </CardContent>
      </Card>
    </div>
  );
}
