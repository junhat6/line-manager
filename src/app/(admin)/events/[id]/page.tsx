import { asc, eq, inArray } from "drizzle-orm";
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
import {
  formatJstDateTimeLabel,
  formatJstForInput,
} from "@/lib/jst";

export const dynamic = "force-dynamic";

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

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.eventId, id))
    .orderBy(asc(sessions.startAt));
  const smRows = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.eventId, id));
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
  const groupRows = await db
    .select()
    .from(lineGroups)
    .where(eq(lineGroups.active, true))
    .orderBy(asc(lineGroups.joinedAt));

  const mainGroup = groupRows.find((g) => g.kind === "main");
  const bindableGroups = groupRows.filter((g) => g.kind !== "main");
  const checklist = buildChecklist(sessionRows, smRows);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{event.title}</h1>
          <a
            href={`/p/${event.publicToken}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 underline hover:text-slate-700"
          >
            参加状況ページ(アナウンスの「参加状況を確認」で開くもの)↗
          </a>
        </div>
        <div className="flex gap-2">
          {event.status !== "done" && (
            <form action={markEventDone}>
              <input type="hidden" name="eventId" value={event.id} />
              <ConfirmButton
                confirmMessage="このイベントを完了にしますか?"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                完了にする
              </ConfirmButton>
            </form>
          )}
          <form action={deleteEvent}>
            <input type="hidden" name="eventId" value={event.id} />
            <ConfirmButton
              confirmMessage="イベントを削除すると参加者記録・送信予約もすべて消えます。本当に削除しますか?"
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              削除
            </ConfirmButton>
          </form>
        </div>
      </div>

      {!mainGroup && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠️ メイングループが未設定です。アナウンスとグループ案内を送るには、
          ボットをメインのLINEグループに招待して、
          <a href="/groups" className="underline">
            グループ画面
          </a>
          で「メイン」に設定してください。
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-bold">チェックリスト</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">タスク</th>
                <th className="px-4 py-2 font-medium">日程</th>
                <th className="px-4 py-2 font-medium">状態</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">{item.label}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {item.sessionLabel ?? "全体"}
                  </td>
                  <td className="px-4 py-2">
                    <StatusCell item={item} />
                  </td>
                  <td className="px-4 py-2">
                    <ActionCell item={item} eventId={event.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          🕒
          の行は時刻が来ると自動送信されます(サーバーの定期実行が有効な場合)。「今すぐ送る」で前倒しもできます。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-bold">日程ごとの参加者・設定</h2>
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
        <span className="text-green-700">
          ✅ 送信済み{item.sentAt ? ` ${formatJstDateTimeLabel(item.sentAt)}` : ""}
        </span>
      );
    case "sending":
      return <span className="text-slate-500">⏳ 送信中…</span>;
    case "failed":
      return (
        <span className="text-red-600">
          ❌ 失敗
          {item.error && (
            <span className="mt-0.5 block text-xs">{item.error}</span>
          )}
        </span>
      );
    case "skipped":
      return <span className="text-slate-400">スキップ</span>;
    case "pending":
      return item.trigger === "auto" && item.scheduledAt ? (
        <span className="text-slate-600">
          🕒 {formatJstDateTimeLabel(item.scheduledAt)} に自動送信
        </span>
      ) : (
        <span className="text-slate-500">⬜ 未送信</span>
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
  const className = isResendOfSent
    ? "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
    : "rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700";

  return (
    <form action={sendMessageAction}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="eventId" value={eventId} />
      {isResendOfSent && <input type="hidden" name="force" value="1" />}
      <ConfirmButton confirmMessage={confirmMessage} className={className}>
        {label}
      </ConfirmButton>
    </form>
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
    surveyRow && (surveyRow.status === "pending" || surveyRow.status === "failed");

  return (
    <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-bold">{formatJstDateTimeLabel(session.startAt)}</h3>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">
          参加者({attending.length}人)
        </h4>
        {attending.length === 0 ? (
          <p className="text-sm text-slate-500">
            まだ参加者がいません(アナウンスのボタンで自動集計されます)
          </p>
        ) : (
          <ul className="space-y-1">
            {attending.map(({ attendance, member }) => (
              <li
                key={attendance.id}
                className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm"
              >
                <span>
                  {member.displayName}
                  {attendance.source === "manual" && (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                      手動
                    </span>
                  )}
                </span>
                <form action={removeAttendance}>
                  <input
                    type="hidden"
                    name="attendanceId"
                    value={attendance.id}
                  />
                  <input type="hidden" name="eventId" value={eventId} />
                  <ConfirmButton
                    confirmMessage={`${member.displayName} さんを参加者から外しますか?`}
                    className="text-slate-400 hover:text-red-600"
                    aria-label="参加者から外す"
                  >
                    ✕
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {cancelled.length > 0 && (
          <p className="text-xs text-slate-400">
            取消: {cancelled.map((r) => r.member.displayName).join("、")}
          </p>
        )}
        <form action={addManualAttendee} className="flex gap-2 pt-1">
          <input type="hidden" name="sessionId" value={session.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <input
            type="text"
            name="name"
            required
            placeholder="名前を入力して手動追加"
            className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            追加
          </button>
        </form>
      </div>

      <form action={updateSession} className="space-y-3 border-t border-slate-100 pt-4">
        <input type="hidden" name="sessionId" value={session.id} />
        <input type="hidden" name="eventId" value={eventId} />

        <label className="block text-sm">
          <span className="font-medium">開催日時</span>
          <input
            type="datetime-local"
            name="startAt"
            required
            defaultValue={formatJstForInput(session.startAt)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">日程別LINEグループ</span>
          <select
            name="lineGroupId"
            defaultValue={session.lineGroupId ?? ""}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          >
            <option value="">未紐付け</option>
            {bindableGroups.map((g) => (
              <option key={g.id} value={g.lineGroupId}>
                {g.name ?? g.lineGroupId}
              </option>
            ))}
          </select>
          {!boundGroup && session.lineGroupId && (
            <span className="mt-1 block text-xs text-amber-600">
              紐付け中のグループが見つかりません(ボットが退出した可能性)
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="font-medium">グループ招待リンク</span>
          <input
            type="text"
            name="inviteLink"
            defaultValue={session.inviteLink ?? ""}
            placeholder="https://line.me/ti/g/..."
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          />
          <span className="mt-1 block text-xs text-slate-500">
            LINEアプリのグループ設定 → メンバー招待 → リンクをコピー
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">自己紹介スライドURL</span>
          <input
            type="text"
            name="slideUrl"
            defaultValue={session.slideUrl ?? ""}
            placeholder="https://docs.google.com/presentation/..."
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">参加方法(当日案内に載る)</span>
          <textarea
            name="meetingInfo"
            rows={2}
            defaultValue={session.meetingInfo ?? ""}
            placeholder="例: Zoomリンク、会場の住所など"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">当日の流れ(当日案内に載る・任意)</span>
          <textarea
            name="dayFlow"
            rows={3}
            defaultValue={session.dayFlow ?? ""}
            placeholder={"例:\n19:00 乾杯・自己紹介\n19:30 グループトーク"}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">アンケート送信日時</span>
          <input
            type="datetime-local"
            name="surveyAt"
            defaultValue={
              surveyRow?.scheduledAt
                ? formatJstForInput(surveyRow.scheduledAt)
                : ""
            }
            disabled={!surveyEditable}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 disabled:bg-slate-100 disabled:text-slate-400"
          />
          {!surveyEditable && (
            <span className="mt-1 block text-xs text-slate-500">
              アンケートは送信済みのため変更できません
            </span>
          )}
        </label>

        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          保存する
        </button>
        <p className="text-xs text-slate-500">
          開催日時を変えると、未送信の前日・当日案内の予約時刻も自動で追従します。
        </p>
      </form>
    </div>
  );
}
