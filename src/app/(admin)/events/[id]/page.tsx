import { asc, eq, inArray } from "drizzle-orm";
import {
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  ExternalLinkIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addManualAttendee,
  deleteEvent,
  markEventDone,
  removeAttendance,
  sendMessageAction,
  updateSession,
} from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastForm } from "@/components/ToastForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getDb } from "@/db/client";
import {
  attendances,
  events,
  lineGroups,
  members,
  scheduledMessages,
  sessions,
  type LineGroup,
  type ScheduledMessage,
  type Session,
} from "@/db/schema";
import { buildChecklist, type ChecklistItem } from "@/lib/checklist";
import { formatJstDateTimeLabel, formatJstForInput } from "@/lib/jst";

export const dynamic = "force-dynamic";

const STATUS_LABELS = {
  draft: { text: "準備中", variant: "secondary" },
  announced: { text: "アナウンス済み", variant: "default" },
  done: { text: "完了", variant: "outline" },
} as const;

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const eventRows = await db.select().from(events).where(eq(events.id, id));
  const event = eventRows[0];
  if (!event) notFound();

  // 互いに依存しないクエリは並列化してTTFBを縮める(直列だと往復分だけ遅くなる)
  const [sessionRows, smRows, groupRows] = await Promise.all([
    db
      .select()
      .from(sessions)
      .where(eq(sessions.eventId, id))
      .orderBy(asc(sessions.startAt)),
    db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.eventId, id)),
    db
      .select()
      .from(lineGroups)
      .where(eq(lineGroups.active, true))
      .orderBy(asc(lineGroups.joinedAt)),
  ]);
  const attendanceRows =
    sessionRows.length > 0
      ? await db
          .select({ attendance: attendances, member: members })
          .from(attendances)
          .innerJoin(members, eq(attendances.memberId, members.id))
          .where(
            inArray(
              attendances.sessionId,
              sessionRows.map((s) => s.id),
            ),
          )
          .orderBy(asc(attendances.respondedAt))
      : [];

  const mainGroup = groupRows.find((g) => g.kind === "main");
  const bindableGroups = groupRows.filter((g) => g.kind !== "main");
  const checklist = buildChecklist(sessionRows, smRows);
  const status = STATUS_LABELS[event.status];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-xl font-semibold break-words">
              {event.title}
            </h1>
            <Badge variant={status.variant}>{status.text}</Badge>
          </div>
          <a
            href={`/p/${event.publicToken}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
          >
            参加状況ページ(アナウンスの「参加状況を確認」で開くもの)
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
        <div className="flex shrink-0 gap-2">
          {event.status !== "done" && (
            <ToastForm action={markEventDone}>
              <input type="hidden" name="eventId" value={event.id} />
              <ConfirmButton
                confirmMessage="このイベントを完了にしますか?"
                actionLabel="完了にする"
              >
                完了にする
              </ConfirmButton>
            </ToastForm>
          )}
          <form action={deleteEvent}>
            <input type="hidden" name="eventId" value={event.id} />
            <ConfirmButton
              confirmMessage="イベントを削除すると参加者記録・送信予約もすべて消えます。本当に削除しますか?"
              actionLabel="削除する"
              variant="destructive"
            >
              削除
            </ConfirmButton>
          </form>
        </div>
      </div>

      {!mainGroup && (
        <Alert>
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>メイングループが未設定です</AlertTitle>
          <AlertDescription>
            アナウンスとグループ案内を送るには、ボットをメインのLINEグループに招待して、
            <Link href="/groups">グループ画面</Link>
            で「メイン」に設定してください。
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>チェックリスト</CardTitle>
          <CardDescription>
            時刻付きの行はその時刻に自動送信されます(サーバーの定期実行が有効な場合)。「今すぐ送る」で前倒しもできます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>タスク</TableHead>
                <TableHead>日程</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checklist.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.label}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.sessionLabel ?? "全体"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <StatusCell item={item} />
                  </TableCell>
                  <TableCell>
                    <ActionCell item={item} eventId={event.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">日程ごとの参加者・設定</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {sessionRows.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              eventId={event.id}
              attendanceRows={attendanceRows.filter(
                (r) => r.attendance.sessionId === session.id,
              )}
              bindableGroups={bindableGroups}
              surveyRow={smRows.find(
                (r) => r.sessionId === session.id && r.kind === "survey",
              )}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusCell({ item }: { item: ChecklistItem }) {
  switch (item.status) {
    case "sent":
      return (
        <span className="inline-flex items-center gap-1.5">
          <CheckIcon className="size-4 text-success" />
          送信済み
          {item.sentAt && (
            <span className="text-muted-foreground">
              {formatJstDateTimeLabel(item.sentAt)}
            </span>
          )}
        </span>
      );
    case "sending":
      return <span className="text-muted-foreground">送信中…</span>;
    case "failed":
      return (
        <span className="text-destructive">
          <span className="inline-flex items-center gap-1.5">
            <CircleAlertIcon className="size-4" />
            失敗
          </span>
          {item.error && (
            <span className="mt-0.5 block text-xs">{item.error}</span>
          )}
        </span>
      );
    case "skipped":
      return <span className="text-muted-foreground">スキップ</span>;
    case "pending":
      return item.trigger === "auto" && item.scheduledAt ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <ClockIcon className="size-4" />
          {formatJstDateTimeLabel(item.scheduledAt)} に自動送信
        </span>
      ) : (
        <span className="text-muted-foreground">未送信</span>
      );
  }
}

function ActionCell({
  item,
  eventId,
}: {
  item: ChecklistItem;
  eventId: string;
}) {
  if (item.status === "sending" || item.status === "skipped") return null;

  const isResendOfSent = item.status === "sent";
  const label =
    item.status === "failed"
      ? "再送信"
      : item.status === "sent"
        ? "再送"
        : item.trigger === "manual"
          ? "送信する"
          : "今すぐ送る";
  const confirmMessage = isResendOfSent
    ? `「${item.label}」は送信済みです。再送すると同じ内容がもう一度グループに届きます。本当に再送しますか?`
    : `「${item.label}」をLINEに送信します。よろしいですか?`;

  return (
    <ToastForm action={sendMessageAction}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="eventId" value={eventId} />
      {isResendOfSent && <input type="hidden" name="force" value="1" />}
      <ConfirmButton
        confirmMessage={confirmMessage}
        actionLabel="送信する"
        variant={isResendOfSent ? "outline" : "default"}
        size="xs"
      >
        {label}
      </ConfirmButton>
    </ToastForm>
  );
}

function SessionCard({
  session,
  eventId,
  attendanceRows,
  bindableGroups,
  surveyRow,
}: {
  session: Session;
  eventId: string;
  attendanceRows: {
    attendance: typeof attendances.$inferSelect;
    member: typeof members.$inferSelect;
  }[];
  bindableGroups: LineGroup[];
  surveyRow: ScheduledMessage | undefined;
}) {
  const attending = attendanceRows.filter(
    (r) => r.attendance.status === "attending",
  );
  const cancelled = attendanceRows.filter(
    (r) => r.attendance.status === "cancelled",
  );
  const boundGroup = bindableGroups.find(
    (g) => g.lineGroupId === session.lineGroupId,
  );
  const surveyEditable =
    surveyRow &&
    (surveyRow.status === "pending" || surveyRow.status === "failed");
  const groupItems = [
    { value: "", label: "未紐付け" },
    ...bindableGroups.map((g) => ({
      value: g.lineGroupId,
      label: g.name ?? g.lineGroupId,
    })),
  ];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{formatJstDateTimeLabel(session.startAt)}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <h4 className="text-sm font-medium">参加者({attending.length}人)</h4>
        {attending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだ参加者がいません(アナウンスのボタンで自動集計されます)
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {attending.map(({ attendance, member }) => (
              <li
                key={attendance.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm"
              >
                <span className="inline-flex min-w-0 items-center gap-2 break-words">
                  {member.displayName}
                  {attendance.source === "manual" && (
                    <Badge variant="secondary">手動</Badge>
                  )}
                </span>
                <ToastForm action={removeAttendance} className="shrink-0">
                  <input
                    type="hidden"
                    name="attendanceId"
                    value={attendance.id}
                  />
                  <input type="hidden" name="eventId" value={eventId} />
                  <ConfirmButton
                    confirmMessage={`${member.displayName} さんを参加者から外しますか?`}
                    actionLabel="外す"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="参加者から外す"
                  >
                    <XIcon />
                  </ConfirmButton>
                </ToastForm>
              </li>
            ))}
          </ul>
        )}
        {cancelled.length > 0 && (
          <p className="text-xs text-muted-foreground">
            取消: {cancelled.map((r) => r.member.displayName).join("、")}
          </p>
        )}
        <ToastForm action={addManualAttendee} className="flex gap-2 pt-1">
          <input type="hidden" name="sessionId" value={session.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <Input
            type="text"
            name="name"
            required
            autoComplete="off"
            aria-label="手動追加する参加者名"
            placeholder="名前を入力して手動追加…"
            className="flex-1"
          />
          <SubmitButton variant="outline">追加</SubmitButton>
        </ToastForm>
      </CardContent>

      <CardContent className="border-t pt-(--card-spacing)">
        <ToastForm action={updateSession}>
          <input type="hidden" name="sessionId" value={session.id} />
          <input type="hidden" name="eventId" value={eventId} />

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`startAt-${session.id}`}>
                開催日時
              </FieldLabel>
              <Input
                id={`startAt-${session.id}`}
                type="datetime-local"
                name="startAt"
                required
                defaultValue={formatJstForInput(session.startAt)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`lineGroupId-${session.id}`}>
                日程別LINEグループ
              </FieldLabel>
              <Select
                name="lineGroupId"
                defaultValue={session.lineGroupId ?? ""}
                items={groupItems}
              >
                <SelectTrigger
                  id={`lineGroupId-${session.id}`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {groupItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {!boundGroup && session.lineGroupId && (
                <p className="text-xs text-warning">
                  紐付け中のグループが見つかりません(ボットが退出した可能性)
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={`inviteLink-${session.id}`}>
                グループ招待リンク
              </FieldLabel>
              <Input
                id={`inviteLink-${session.id}`}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                name="inviteLink"
                defaultValue={session.inviteLink ?? ""}
                placeholder="https://line.me/ti/g/…"
              />
              <FieldDescription className="text-xs">
                LINEアプリのグループ設定 → メンバー招待 → リンクをコピー
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={`slideUrl-${session.id}`}>
                自己紹介スライドURL
              </FieldLabel>
              <Input
                id={`slideUrl-${session.id}`}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                name="slideUrl"
                defaultValue={session.slideUrl ?? ""}
                placeholder="https://docs.google.com/presentation/…"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`meetingInfo-${session.id}`}>
                参加方法(当日案内に載る)
              </FieldLabel>
              <Textarea
                id={`meetingInfo-${session.id}`}
                name="meetingInfo"
                rows={2}
                defaultValue={session.meetingInfo ?? ""}
                placeholder="例: Zoomリンク、会場の住所など"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`dayFlow-${session.id}`}>
                当日の流れ(当日案内に載る・任意)
              </FieldLabel>
              <Textarea
                id={`dayFlow-${session.id}`}
                name="dayFlow"
                rows={3}
                defaultValue={session.dayFlow ?? ""}
                placeholder={"例:\n19:00 乾杯・自己紹介\n19:30 グループトーク"}
              />
            </Field>

            <Field data-disabled={!surveyEditable || undefined}>
              <FieldLabel htmlFor={`surveyAt-${session.id}`}>
                アンケート送信日時
              </FieldLabel>
              <Input
                id={`surveyAt-${session.id}`}
                type="datetime-local"
                name="surveyAt"
                defaultValue={
                  surveyRow?.scheduledAt
                    ? formatJstForInput(surveyRow.scheduledAt)
                    : ""
                }
                disabled={!surveyEditable}
              />
              {!surveyEditable && (
                <FieldDescription className="text-xs">
                  アンケートは送信済みのため変更できません
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldDescription className="text-xs">
                開催日時を変えると、未送信の前日・当日案内の予約時刻も自動で追従します。
              </FieldDescription>
            </Field>
            {/* Fieldの中に置くと *:w-full で全幅に伸ばされるためFieldGroup直下に置く */}
            <SubmitButton className="w-fit">保存する</SubmitButton>
          </FieldGroup>
        </ToastForm>
      </CardContent>
    </Card>
  );
}
