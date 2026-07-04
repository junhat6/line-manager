import { desc } from "drizzle-orm";
import {
  CalendarSearchIcon,
  ExternalLinkIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import {
  importSchedulePoll,
  postSchedulePollUrl,
  startSchedulePoll,
} from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ToastForm } from "@/components/ToastForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getDb } from "@/db/client";
import { schedulePolls } from "@/db/schema";
import { formatJstDateTimeLabel, toJstParts } from "@/lib/jst";

export const dynamic = "force-dynamic";

export default async function PollsPage() {
  const db = getDb();
  const polls = await db
    .select()
    .from(schedulePolls)
    .orderBy(desc(schedulePolls.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">日程調整</h1>
        <ToastForm action={startSchedulePoll}>
          <ConfirmButton
            confirmMessage="調整さんに来月全日程の日程調整を作成し、URLをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
            actionLabel="開始する"
            variant="default"
            size="default"
          >
            <PlusIcon data-icon="inline-start" />
            来月の日程調整を開始
          </ConfirmButton>
        </ToastForm>
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        「開始」で調整さん(chouseisan.com)に来月の全日程を候補にした出欠表を作り、URLをメイングループへ自動投稿します。
        回答が集まったら「結果を取り込む」で、◯=1点・△=0.5点の集計上位2日程のイベントが自動作成されます(同点は早い日付を優先)。
      </p>

      {polls.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarSearchIcon />
            </EmptyMedia>
            <EmptyTitle>まだ日程調整がありません</EmptyTitle>
            <EmptyDescription>
              「来月の日程調整を開始」から始めてください。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {polls.map((poll) => (
            <li key={poll.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{poll.title}</CardTitle>
                  <CardDescription>
                    作成: {formatJstDateTimeLabel(poll.createdAt)} / 対象:{" "}
                    {toJstParts(poll.targetMonth).year}年
                    {toJstParts(poll.targetMonth).month}月
                  </CardDescription>
                  <CardAction>
                    {poll.status === "imported" ? (
                      poll.importedEventId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          render={
                            <Link href={`/events/${poll.importedEventId}`} />
                          }
                          nativeButton={false}
                        >
                          取込済み — イベントを見る
                        </Button>
                      ) : (
                        // 取込で作ったイベントが削除された場合は再取込を許す
                        <ToastForm
                          action={importSchedulePoll}
                          className="flex items-center gap-2"
                        >
                          <span className="text-sm text-muted-foreground">
                            イベント削除済み
                          </span>
                          <input type="hidden" name="id" value={poll.id} />
                          <ConfirmButton
                            confirmMessage="調整さんの回答を集計し直し、上位2日程でイベントを再作成します。よろしいですか?"
                            actionLabel="取り込み直す"
                          >
                            結果を取り込み直す
                          </ConfirmButton>
                        </ToastForm>
                      )
                    ) : (
                      <ToastForm action={importSchedulePoll}>
                        <input type="hidden" name="id" value={poll.id} />
                        <ConfirmButton
                          confirmMessage="調整さんの回答を集計し、上位2日程でイベントを自動作成します。よろしいですか?"
                          actionLabel="取り込む"
                          variant="default"
                        >
                          結果を取り込んでイベント作成
                        </ConfirmButton>
                      </ToastForm>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent className="flex items-center gap-3 text-sm">
                  <a
                    href={poll.chouseisanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-3 hover:text-muted-foreground"
                  >
                    調整さんで開く
                    <ExternalLinkIcon className="size-3" />
                  </a>
                  {poll.postedAt ? (
                    <span className="text-muted-foreground">
                      グループ投稿済み {formatJstDateTimeLabel(poll.postedAt)}
                    </span>
                  ) : (
                    <ToastForm
                      action={postSchedulePollUrl}
                      className="flex items-center gap-2"
                    >
                      <Badge variant="destructive">未投稿</Badge>
                      <input type="hidden" name="id" value={poll.id} />
                      <ConfirmButton
                        confirmMessage="日程調整のURLをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
                        actionLabel="投稿する"
                        size="xs"
                      >
                        <SendIcon data-icon="inline-start" />
                        グループに投稿する
                      </ConfirmButton>
                    </ToastForm>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
