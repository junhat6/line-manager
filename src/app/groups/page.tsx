import { asc } from "drizzle-orm";
import { setGroupKind } from "@/app/actions";
import { getDb } from "@/db/client";
import { lineGroups } from "@/db/schema";
import { formatJstDateTimeLabel } from "@/lib/jst";

export const dynamic = "force-dynamic";

const KIND_LABELS = {
  main: "メイン",
  session: "日程別",
  unknown: "未分類",
} as const;

export default async function GroupsPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(lineGroups)
    .orderBy(asc(lineGroups.joinedAt));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">LINEグループ</h1>
      <p className="text-sm text-slate-600">
        ボットをLINEグループに招待すると、ここに自動で表示されます。
        全体アナウンス用のグループを1つ「メイン」に設定してください。
        日程別グループは、イベント詳細ページで日程に紐付けます。
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          まだグループがありません。LINEアプリでボットをグループに招待してください。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">グループ名</th>
                <th className="px-4 py-2 font-medium">役割</th>
                <th className="px-4 py-2 font-medium">チャネル</th>
                <th className="px-4 py-2 font-medium">状態</th>
                <th className="px-4 py-2 font-medium">参加日時</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((group) => (
                <tr key={group.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    {group.name ?? (
                      <span className="text-slate-400">(名前未取得)</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <form action={setGroupKind} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={group.id} />
                      <select
                        name="kind"
                        defaultValue={group.kind}
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        {Object.entries(KIND_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                      >
                        変更
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {/* joinイベントで自動記録。実態(どのボットが居るか)とズレないよう手動変更UIは設けない */}
                    {group.channel}
                  </td>
                  <td className="px-4 py-2">
                    {group.active ? (
                      <span className="text-green-700">参加中</span>
                    ) : (
                      <span className="text-slate-400">退出済み</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {formatJstDateTimeLabel(group.joinedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
