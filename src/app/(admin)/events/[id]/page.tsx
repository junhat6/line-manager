import { asc, eq } from "drizzle-orm";
import {
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  Link2Icon,
  Link2OffIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteEvent,
  markEventDone,
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
  events,
  lineGroups,
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

  const mainGroup = groupRows.find((g) => g.kind === "main");
  const bindableGroups = groupRows.filter((g) => g.kind !== "main");
  const checklist = buildChecklist(sessionRows, smRows);
  const sessionById = new Map(sessionRows.map((s) => [s.id, s]));
  const status = STATUS_LABELS[event.status];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-xl font-semibold break-words">
            {event.title}
          </h1>
          <Badge variant={status.variant}>{status.text}</Badge>
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
            グループ案内を送るには、ボットをメインのLINEグループに招待して、
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
                    {item.sessionId && (
                      <GroupBindingHint
                        session={sessionById.get(item.sessionId)}
                        groups={groupRows}
                      />
                    )}
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
        <h2 className="font-semibold">日程ごとの設定</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {sessionRows.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              eventId={event.id}
              bindableGroups={bindableGroups}
              messageRows={smRows.filter((r) => r.sessionId === session.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * チェックリストの日程列に出す、日程別LINEグループの紐付け状態。
 * 未紐付けのまま自動送信の時刻を迎えると失敗するため、
 * テーブルを下にスクロールして日程カードを見なくても気づけるようにする。
 */
function GroupBindingHint({
  session,
  groups,
}: {
  session: Session | undefined;
  groups: LineGroup[];
}) {
  if (!session) return null;
  const group = groups.find((g) => g.lineGroupId === session.lineGroupId);
  if (session.lineGroupId && group) {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-xs">
        <Link2Icon className="size-3 shrink-0" />
        {group.name ?? group.lineGroupId}
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
      <Link2OffIcon className="size-3 shrink-0" />
      {session.lineGroupId
        ? "紐付け先グループが見つかりません"
        : "グループ未紐付け"}
    </span>
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

/**
 * 自動送信(前日・当日・アンケート)の予約日時フィールド。
 * 送信済みの行は履歴なので disabled にする(disabled の入力はFormDataに
 * 含まれず、サーバー側も「空欄=変更しない」と解釈する)。
 */
function ScheduledAtField({
  sessionId,
  name,
  label,
  row,
}: {
  sessionId: string;
  name: string;
  label: string;
  row: ScheduledMessage | undefined;
}) {
  const editable =
    row && (row.status === "pending" || row.status === "failed");
  return (
    <Field data-disabled={!editable || undefined}>
      <FieldLabel htmlFor={`${name}-${sessionId}`}>{label}</FieldLabel>
      <Input
        id={`${name}-${sessionId}`}
        type="datetime-local"
        name={name}
        defaultValue={
          row?.scheduledAt ? formatJstForInput(row.scheduledAt) : ""
        }
        disabled={!editable}
      />
      {!editable && (
        <FieldDescription className="text-xs">
          送信済みのため変更できません
        </FieldDescription>
      )}
    </Field>
  );
}

function SessionCard({
  session,
  eventId,
  bindableGroups,
  messageRows,
}: {
  session: Session;
  eventId: string;
  bindableGroups: LineGroup[];
  /** この日程に紐づく scheduled_messages(送信日時フィールドの現在値・編集可否に使う) */
  messageRows: ScheduledMessage[];
}) {
  const boundGroup = bindableGroups.find(
    (g) => g.lineGroupId === session.lineGroupId,
  );
  const rowOf = (kind: ScheduledMessage["kind"]) =>
    messageRows.find((r) => r.kind === kind);
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

      <CardContent>
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

            <ScheduledAtField
              sessionId={session.id}
              name="dayBeforeAt"
              label="前日案内の送信日時"
              row={rowOf("day_before")}
            />
            <ScheduledAtField
              sessionId={session.id}
              name="dayOfAt"
              label="当日案内の送信日時"
              row={rowOf("day_of")}
            />
            <ScheduledAtField
              sessionId={session.id}
              name="surveyAt"
              label="アンケートの送信日時"
              row={rowOf("survey")}
            />

            <Field>
              <FieldDescription className="text-xs">
                開催日時を変えると、変更していない送信日時も同じ時間差で自動的にずれます。個別に変更した送信日時はそのまま使われます。
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
