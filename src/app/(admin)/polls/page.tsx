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
import { CustomPollForm } from "@/components/CustomPollForm";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getDb } from "@/db/client";
import { schedulePolls } from "@/db/schema";
import { nextMonthStart } from "@/lib/chouseisan";
import { formatJstDateTimeLabel, toJstParts } from "@/lib/jst";
import {
  DEFAULT_POLL_TIME,
  HALF_HOUR_TIME_ITEMS,
} from "@/lib/poll-time-options";
import { defaultPollMessageBody } from "@/lib/templates";

export const dynamic = "force-dynamic";

export default async function PollsPage() {
  const db = getDb();
  const polls = await db
    .select()
    .from(schedulePolls)
    .orderBy(desc(schedulePolls.createdAt));

  // フォームのプリフィル用。dynamic="force-dynamic" なのでリクエスト時点の来月が入る
  const nextMonthParts = toJstParts(nextMonthStart(new Date()));
  const nextMonth = nextMonthParts.month;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">日程調整</h1>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        調整さん(chouseisan.com)に日時候補の出欠表を作り、URLをメイングループへ自動投稿します。
        かんたん作成は来月の全日程、カスタム作成はカレンダーで選んだ日付と時刻が候補になります。
        回答が集まったら「結果を取り込む」で、◯=1点・△=0.5点の集計上位2日程のイベントが自動作成されます(候補の時刻がそのまま開催時刻に。同点は早い日付を優先)。
      </p>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>来月({nextMonth}月)の日程調整をかんたん作成</CardTitle>
          <CardDescription>
            来月の全日程を候補にします。下のメッセージと調整さんのURLがメイングループに投稿されます。文面は自由に編集できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToastForm action={startSchedulePoll}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>開始時刻(全候補共通)</FieldLabel>
                <Select
                  name="time"
                  defaultValue={DEFAULT_POLL_TIME}
                  items={HALF_HOUR_TIME_ITEMS}
                >
                  <SelectTrigger size="sm" aria-label="開始時刻">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {HALF_HOUR_TIME_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  候補は「8/1(土) 20:00」のように日付+この時刻で作られ、取込後の開催時刻になります
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="poll-message">
                  グループに投稿するメッセージ
                </FieldLabel>
                <Textarea
                  id="poll-message"
                  name="message"
                  rows={3}
                  required
                  defaultValue={defaultPollMessageBody(nextMonth)}
                />
                <FieldDescription className="text-xs">
                  末尾に調整さんのURLが自動で付きます
                </FieldDescription>
              </Field>
              {/* Fieldの中に置くと *:w-full で全幅に伸ばされるためFieldGroup直下に置く */}
              <ConfirmButton
                confirmMessage="調整さんに来月全日程の日程調整を作成し、上のメッセージをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
                actionLabel="開始する"
                variant="default"
                size="default"
                className="w-fit"
              >
                <PlusIcon data-icon="inline-start" />
                来月の日程調整を開始
              </ConfirmButton>
            </FieldGroup>
          </ToastForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>カスタム日程調整を作成</CardTitle>
          <CardDescription>
            候補にする日付と開始時刻を自由に選んで作成します。月をまたぐ候補も選べます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomPollForm
            defaultMessage={defaultPollMessageBody(nextMonth)}
            initialYear={nextMonthParts.year}
            initialMonth={nextMonth}
          />
        </CardContent>
      </Card>

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
