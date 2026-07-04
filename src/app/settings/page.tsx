import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { saveSettings } from "@/app/actions";
import { getDb } from "@/db/client";
import { lineGroups } from "@/db/schema";
import { getChannelQuotas } from "@/lib/line/quota";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = getDb();
  const surveyUrlFirst = await getSetting(db, SETTING_KEYS.surveyUrlFirst);
  const surveyUrlRepeat = await getSetting(db, SETTING_KEYS.surveyUrlRepeat);
  const mainRows = await db
    .select()
    .from(lineGroups)
    .where(and(eq(lineGroups.kind, "main"), eq(lineGroups.active, true)));
  const mainGroup = mainRows[0];
  const quotas = await getChannelQuotas();

  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-xl font-bold">設定</h1>

      <section className="space-y-2">
        <h2 className="font-bold">メイングループ</h2>
        {mainGroup ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            ✅ {mainGroup.name ?? mainGroup.lineGroupId}
          </p>
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            未設定です。
            <Link href="/groups" className="underline">
              グループ画面
            </Link>
            で全体アナウンス用のグループを「メイン」に設定してください。
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">LINEチャネルと無料枠</h2>
        <p className="text-xs text-slate-500">
          グループ宛のpushはグループ人数分カウントされます。当月の実測値です。
        </p>
        <ul className="space-y-2">
          {quotas.map((q) => (
            <li
              key={q.channel}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm"
            >
              {q.ok ? (
                <span>
                  チャネル{q.channel}: 当月消費{" "}
                  <span className="font-bold">{q.totalUsage}</span>
                  {q.limit !== null ? ` / ${q.limit}通` : "通(上限なしプラン)"}
                </span>
              ) : (
                <span className="text-amber-800">
                  チャネル{q.channel}: 消費量を取得できませんでした(
                  {q.error})
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">アンケートURL</h2>
        <form
          action={saveSettings}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
        >
          <label className="block text-sm">
            <span className="font-medium">回答が1回目の方用</span>
            <input
              type="url"
              name="surveyUrlFirst"
              required
              defaultValue={surveyUrlFirst}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">回答が2回目以降の方用</span>
            <input
              type="url"
              name="surveyUrlRepeat"
              required
              defaultValue={surveyUrlRepeat}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            保存する
          </button>
        </form>
      </section>
    </div>
  );
}
