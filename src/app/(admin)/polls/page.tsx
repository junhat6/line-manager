import { desc } from "drizzle-orm";
import {
  CalendarSearchIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import {
  importSchedulePoll,
  postSchedulePollUrl,
  sendPollReminder,
  startSchedulePoll,
} from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CustomPollForm } from "@/components/CustomPollForm";
import { ToastForm } from "@/components/ToastForm";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Input } from "@/components/ui/input";
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
import { schedulePolls, type SchedulePoll } from "@/db/schema";
import { nextMonthStart } from "@/lib/chouseisan";
import {
  formatJstDateTimeLabel,
  formatJstForInput,
  jstToUtc,
  toJstParts,
} from "@/lib/jst";
import {
  DEFAULT_POLL_TIME,
  HALF_HOUR_TIME_ITEMS,
} from "@/lib/poll-time-options";
import { defaultPollMessageBody } from "@/lib/templates";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 既定の締切: 候補開始日の7日前 21:00 JST(運営はそのまま/自由に変更できる) */
function defaultDeadlineDate(candidateStart: Date): Date {
  const p = toJstParts(new Date(candidateStart.getTime() - WEEK_MS));
  return jstToUtc(p.year, p.month, p.day, 21, 0);
}

function PollStatusBadge({ poll }: { poll: SchedulePoll }) {
  if (poll.status === "imported") {
    return poll.importedEventId ? (
      <Badge variant="secondary">取込済み</Badge>
    ) : (
      <Badge variant="destructive">要再取込</Badge>
    );
  }

  return poll.postedAt ? (
    <Badge variant="outline">回答受付中</Badge>
  ) : (
    <Badge variant="destructive">LINE未投稿</Badge>
  );
}

function PollCard({ poll }: { poll: SchedulePoll }) {
  const targetMonth = toJstParts(poll.targetMonth);
  const canSendReminder =
    poll.status === "open" &&
    poll.postedAt &&
    poll.deadlineAt &&
    !poll.deadlineHandledAt &&
    !poll.reminderSentAt;

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <PollStatusBadge poll={poll} />
          <CardTitle>
            <h3 className="break-words text-pretty">{poll.title}</h3>
          </CardTitle>
        </div>
        <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            対象 {targetMonth.year}年{targetMonth.month}月
          </span>
          <span>
            締切{" "}
            {poll.deadlineAt
              ? formatJstDateTimeLabel(poll.deadlineAt)
              : "未設定"}
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-2">
        {poll.postedAt ? (
          <Badge variant="ghost">
            LINE投稿済み {formatJstDateTimeLabel(poll.postedAt)}
          </Badge>
        ) : (
          <ToastForm
            action={postSchedulePollUrl}
            className="flex items-center gap-2"
          >
            <input type="hidden" name="id" value={poll.id} />
            <ConfirmButton
              confirmMessage="日程調整のURLをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
              actionLabel="投稿する"
              size="xs"
            >
              <SendIcon data-icon="inline-start" aria-hidden="true" />
              LINEに投稿
            </ConfirmButton>
          </ToastForm>
        )}

        {poll.reminderSentAt ? (
          <Badge variant="ghost">
            リマインド済み {formatJstDateTimeLabel(poll.reminderSentAt)}
          </Badge>
        ) : (
          canSendReminder && (
            <ToastForm
              action={sendPollReminder}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="id" value={poll.id} />
              <ConfirmButton
                confirmMessage="締切リマインドをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
                actionLabel="送信する"
                size="xs"
              >
                <SendIcon data-icon="inline-start" aria-hidden="true" />
                リマインドを送る
              </ConfirmButton>
            </ToastForm>
          )
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-between gap-2">
        <a
          href={poll.chouseisanUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          調整さんを開く
          <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
        </a>

        {poll.status === "imported" ? (
          poll.importedEventId ? (
            <Link
              href={`/events/${poll.importedEventId}`}
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              イベントを見る
            </Link>
          ) : (
            <ToastForm action={importSchedulePoll}>
              <input type="hidden" name="id" value={poll.id} />
              <ConfirmButton
                confirmMessage="調整さんの回答を集計し直し、上位2日程でイベントを再作成します。よろしいですか?"
                actionLabel="取り込み直す"
                variant="default"
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
              結果を取り込む
            </ConfirmButton>
          </ToastForm>
        )}
      </CardFooter>
    </Card>
  );
}

export default async function PollsPage() {
  const db = getDb();
  const polls = await db
    .select()
    .from(schedulePolls)
    .orderBy(desc(schedulePolls.createdAt));

  // フォームのプリフィル用。dynamic="force-dynamic" なのでリクエスト時点の来月が入る
  const nextMonthStartDate = nextMonthStart(new Date());
  const nextMonthParts = toJstParts(nextMonthStartDate);
  const nextMonth = nextMonthParts.month;
  const deadlineAt = defaultDeadlineDate(nextMonthStartDate);
  const defaultDeadline = formatJstForInput(deadlineAt);
  const defaultMessage = defaultPollMessageBody(nextMonth);
  const activePolls = polls.filter(
    (poll) => poll.status === "open" || !poll.importedEventId,
  );
  const completedPolls = polls.filter(
    (poll) => poll.status === "imported" && poll.importedEventId,
  );

  return (
    <div className="flex flex-col gap-10">
      <header className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-xl font-semibold text-pretty">日程調整</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          候補日を作成してLINEへ共有します。締切後は回答上位2日程をイベントへ自動で取り込みます。
        </p>
      </header>

      <section
        aria-labelledby="create-poll-heading"
        className="flex flex-col gap-4"
      >
        <div>
          <h2 id="create-poll-heading" className="text-lg font-semibold">
            新しく作る
          </h2>
          <p className="text-sm text-muted-foreground">
            通常は「来月分を作成」だけで始められます。
          </p>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ToastForm action={startSchedulePoll}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h3 className="text-pretty">
                    {nextMonth}月の全日程で作成
                  </h3>
                </CardTitle>
                <CardDescription>
                  全候補を{DEFAULT_POLL_TIME}
                  開始で作成し、調整さんのURLをLINEへ投稿します。
                </CardDescription>
                <CardAction>
                  <Badge variant="secondary">おすすめ</Badge>
                </CardAction>
              </CardHeader>

              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  回答締切 {formatJstDateTimeLabel(deadlineAt)}
                </p>
                <details className="group rounded-lg border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                    時刻・締切・投稿文を変更
                    <ChevronDownIcon
                      className="size-4 shrink-0 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="border-t p-4">
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel>開始時刻</FieldLabel>
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
                          すべての候補日に共通の時刻です
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="poll-deadline">
                          回答の締切日時
                        </FieldLabel>
                        <Input
                          id="poll-deadline"
                          type="datetime-local"
                          name="deadline"
                          autoComplete="off"
                          required
                          defaultValue={defaultDeadline}
                        />
                        <FieldDescription className="text-xs">
                          締切当日にLINEでリマインドし、締切後に結果を自動で取り込みます
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="poll-message">
                          LINEに投稿するメッセージ
                        </FieldLabel>
                        <Textarea
                          id="poll-message"
                          name="message"
                          autoComplete="off"
                          rows={3}
                          required
                          defaultValue={defaultMessage}
                        />
                        <FieldDescription className="text-xs">
                          調整さんのURLは末尾に自動で付きます
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </div>
                </details>
              </CardContent>

              <CardFooter>
                <ConfirmButton
                  confirmMessage="調整さんに来月全日程の日程調整を作成し、設定したメッセージをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
                  actionLabel="作成する"
                  variant="default"
                  size="default"
                >
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  {nextMonth}月分を作成
                </ConfirmButton>
              </CardFooter>
            </Card>
          </ToastForm>

          <Card>
            <CardHeader>
              <CardTitle>
                <h3 className="text-pretty">候補日を選んで作成</h3>
              </CardTitle>
              <CardDescription>
                特定の日だけ、月をまたぐ候補、日ごとに異なる時刻を設定できます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <details className="group">
                <summary
                  className={buttonVariants({
                    variant: "outline",
                    size: "default",
                    className:
                      "min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden",
                  })}
                >
                  <span className="group-open:hidden">カレンダーを開く</span>
                  <span className="hidden group-open:inline">
                    カレンダーを閉じる
                  </span>
                  <ChevronDownIcon
                    data-icon="inline-end"
                    className="group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="mt-5">
                  <CustomPollForm
                    defaultMessage={defaultMessage}
                    defaultDeadline={defaultDeadline}
                    initialYear={nextMonthParts.year}
                    initialMonth={nextMonth}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="poll-status-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="poll-status-heading" className="text-lg font-semibold">
              日程調整の状況
            </h2>
            <p className="text-sm text-muted-foreground">
              進行中の調整だけを先に表示しています。
            </p>
          </div>
          {activePolls.length > 0 && (
            <Badge variant="secondary">{activePolls.length}件進行中</Badge>
          )}
        </div>

        {activePolls.length === 0 ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarSearchIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>進行中の日程調整はありません</EmptyTitle>
              <EmptyDescription>
                新しく作成すると、ここで回答状況を確認できます。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {activePolls.map((poll) => (
              <li key={poll.id}>
                <PollCard poll={poll} />
              </li>
            ))}
          </ul>
        )}

        {completedPolls.length > 0 && (
          <details className="group rounded-xl border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              完了した日程調整
              <Badge variant="secondary">{completedPolls.length}件</Badge>
              <ChevronDownIcon
                className="ml-auto size-4 shrink-0 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul className="flex flex-col gap-3 border-t p-4">
              {completedPolls.map((poll) => (
                <li key={poll.id}>
                  <PollCard poll={poll} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
