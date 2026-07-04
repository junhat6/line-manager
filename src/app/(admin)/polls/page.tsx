import { desc } from "drizzle-orm";
import Link from "next/link";
import {
  importSchedulePoll,
  postSchedulePollUrl,
  startSchedulePoll,
} from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">日程調整</h1>
        <form action={startSchedulePoll}>
          <ConfirmButton
            confirmMessage="調整さんに来月全日程の日程調整を作成し、URLをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + 来月の日程調整を開始
          </ConfirmButton>
        </form>
      </div>
      <p className="text-sm text-slate-600">
        「開始」で調整さん(chouseisan.com)に来月の全日程を候補にした出欠表を作り、URLをメイングループへ自動投稿します。
        回答が集まったら「結果を取り込む」で、◯=1点・△=0.5点の集計上位2日程のイベントが自動作成されます(同点は早い日付を優先)。
      </p>

      {polls.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          まだ日程調整がありません。「+ 来月の日程調整を開始」から始めてください。
        </div>
      ) : (
        <ul className="space-y-3">
          {polls.map((poll) => (
            <li
              key={poll.id}
              className="space-y-2 rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-bold">{poll.title}</p>
                  <p className="text-xs text-slate-500">
                    作成: {formatJstDateTimeLabel(poll.createdAt)} / 対象:{" "}
                    {toJstParts(poll.targetMonth).year}年
                    {toJstParts(poll.targetMonth).month}月
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {poll.status === "imported" ? (
                    poll.importedEventId ? (
                      <Link
                        href={`/events/${poll.importedEventId}`}
                        className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
                      >
                        ✅ 取込済み → イベントを見る
                      </Link>
                    ) : (
                      // 取込で作ったイベントが削除された場合は再取込を許す
                      <form
                        action={importSchedulePoll}
                        className="flex items-center gap-2"
                      >
                        <span className="text-sm text-slate-500">
                          イベント削除済み
                        </span>
                        <input type="hidden" name="id" value={poll.id} />
                        <ConfirmButton
                          confirmMessage="調整さんの回答を集計し直し、上位2日程でイベントを再作成します。よろしいですか?"
                          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
                        >
                          結果を取り込み直す
                        </ConfirmButton>
                      </form>
                    )
                  ) : (
                    <form action={importSchedulePoll}>
                      <input type="hidden" name="id" value={poll.id} />
                      <ConfirmButton
                        confirmMessage="調整さんの回答を集計し、上位2日程でイベントを自動作成します。よろしいですか?"
                        className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                      >
                        結果を取り込んでイベント作成
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <a
                  href={poll.chouseisanUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 underline"
                >
                  調整さんで開く
                </a>
                {poll.postedAt ? (
                  <span className="text-slate-500">
                    📨 グループ投稿済み {formatJstDateTimeLabel(poll.postedAt)}
                  </span>
                ) : (
                  <form action={postSchedulePollUrl}>
                    <input type="hidden" name="id" value={poll.id} />
                    <ConfirmButton
                      confirmMessage="日程調整のURLをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)"
                      className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      ⚠️ 未投稿 — グループに投稿する
                    </ConfirmButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
