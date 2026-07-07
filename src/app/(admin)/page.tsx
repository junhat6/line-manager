import { asc, desc, inArray } from "drizzle-orm";
import { CalendarPlusIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getDb } from "@/db/client";
import { events, sessions } from "@/db/schema";
import { formatJstDateTimeLabel } from "@/lib/jst";

export const dynamic = "force-dynamic";

const STATUS_LABELS = {
  draft: { text: "準備中", variant: "secondary" },
  done: { text: "完了", variant: "outline" },
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">イベント</h1>
        {/* Base UI Buttonはbutton以外をrenderする場合nativeButton={false}が必要 */}
        <Button render={<Link href="/events/new" />} nativeButton={false}>
          <PlusIcon data-icon="inline-start" />
          新しいイベント
        </Button>
      </div>

      {eventRows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarPlusIcon />
            </EmptyMedia>
            <EmptyTitle>まだイベントがありません</EmptyTitle>
            <EmptyDescription>
              「新しいイベント」から作成してください。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {eventRows.map((event) => {
            const status = STATUS_LABELS[event.status];
            const dates = sessionRows.filter((s) => s.eventId === event.id);
            return (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card className="transition-colors hover:bg-muted/50">
                    <CardContent className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 font-medium break-words">
                          {event.title}
                        </span>
                        <Badge variant={status.variant}>{status.text}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {dates.length > 0
                          ? dates
                              .map((s) => formatJstDateTimeLabel(s.startAt))
                              .join(" / ")
                          : "日程未登録"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
