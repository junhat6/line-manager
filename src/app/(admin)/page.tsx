import { asc, desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { events, sessions } from "@/db/schema";
import { formatJstDateTimeLabel } from "@/lib/jst";

export const dynamic = "force-dynamic";

const STATUS_LABELS = {
  draft: { text: "準備中", className: "bg-slate-200 text-slate-700" },
  announced: { text: "アナウンス済み", className: "bg-blue-100 text-blue-800" },
  done: { text: "完了", className: "bg-green-100 text-green-800" },
} as const;

export default async function HomePage() {
  const db = getDb();
  const eventRows = await db
    .select()
    .from(events)
    .orderBy(desc(events.createdAt));
  const sessionRows =
    eventRows.length > 0
      ? await db
          .select()
          .from(sessions)
          .where(
            inArray(
              sessions.eventId,
              eventRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(sessions.startAt))
      : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">イベント一覧</h1>
        <Link
          href="/events/new"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          + 新しいイベント
        </Link>
      </div>

      {eventRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          まだイベントがありません。「新しいイベント」から作成してください。
        </div>
      ) : (
        <ul className="space-y-3">
          {eventRows.map((event) => {
            const status = STATUS_LABELS[event.status];
            const dates = sessionRows.filter((s) => s.eventId === event.id);
            return (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{event.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}
                    >
                      {status.text}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {dates.length > 0
                      ? dates
                          .map((s) => formatJstDateTimeLabel(s.startAt))
                          .join(" / ")
                      : "日程未登録"}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
