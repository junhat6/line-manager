import { asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { attendances, events, members, sessions } from "@/db/schema";
import { formatJstDateTimeLabel } from "@/lib/jst";

/**
 * 参加状況の公開ページ。アナウンスFlexの「参加状況を確認」ボタンから開く。
 * 参加ボタンはサイレント(トークに何も流れない)ため、押した本人が
 * 「自分の登録が記録されたか」を確認できる唯一の導線。
 * Basic認証の対象外(src/proxy.ts のmatcherで除外)なので、
 * このページには閲覧専用の情報だけを置き、操作は一切置かない。
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "参加状況",
  // トークン付きURLのページなので検索エンジンに載せない
  robots: { index: false, follow: false },
};

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // uuid型カラムに不正な文字列で問い合わせるとPostgresがエラーになるため先に弾く
  if (!z.uuid().safeParse(token).success) notFound();

  const db = getDb();
  const eventRows = await db
    .select()
    .from(events)
    .where(eq(events.publicToken, token));
  const event = eventRows[0];
  if (!event) notFound();

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.eventId, event.id))
    .orderBy(asc(sessions.startAt));
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

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <h1 className="text-lg font-bold">🎉 {event.title} の参加状況</h1>
      <p className="mt-2 text-sm text-slate-600">
        アナウンスのボタンを押すと、ここに名前が載ります。
        押した直後に名前が見当たらないときは、少し待ってから開き直してください。
      </p>

      <div className="mt-6 space-y-5">
        {sessionRows.map((session) => {
          const rows = attendanceRows.filter(
            (r) => r.attendance.sessionId === session.id,
          );
          const attending = rows.filter(
            (r) => r.attendance.status === "attending",
          );
          const cancelled = rows.filter(
            (r) => r.attendance.status === "cancelled",
          );
          return (
            <section
              key={session.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <h2 className="font-bold">
                {formatJstDateTimeLabel(session.startAt)}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                参加 {attending.length}人
              </p>
              {attending.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  まだ参加表明がありません
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {attending.map(({ attendance, member }) => (
                    <li
                      key={attendance.id}
                      className="rounded bg-slate-50 px-3 py-1.5 text-sm"
                    >
                      {member.displayName}
                    </li>
                  ))}
                </ul>
              )}
              {cancelled.length > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  取消: {cancelled.map((r) => r.member.displayName).join("、")}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
