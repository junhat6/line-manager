/**
 * 日程調整の締切自動処理結果をSlackに通知する。
 * Slack Incoming Webhookのみ(公式SDK不使用、既存の最小依存の流儀に合わせる)。
 * SLACK_WEBHOOK_URLは任意設定 — 未設定でも締切検知・自動取込そのものは動く
 * (通知はあくまで「気づきやすくする」ためのオプトイン層)。
 */
import type { SchedulePoll } from "@/db/schema";
import { getAppBaseUrl } from "@/lib/env";
import { formatJstDateTimeLabel } from "@/lib/jst";
import type { CandidateResult } from "@/lib/chouseisan";
import type { PollImportOutcome } from "@/lib/poll-import";

// ---------- 純粋ロジック(テスト対象) ----------

export type PollDeadlineNotifyOutcome =
  | PollImportOutcome
  | { kind: "error"; message: string };

/** APP_BASE_URLが未設定でthrowしても、通知本文の組み立て自体は落とさない */
function safeAppBaseUrl(): string | null {
  try {
    return getAppBaseUrl();
  } catch {
    return null;
  }
}

/**
 * 候補1件の招待対象者を表示する。招待すべきかどうかの判断材料なので
 * ◯(参加)・△(未定)のみ列挙し、×(不参加)は出さない。
 */
function formatCandidateVoters(c: CandidateResult): string {
  const attend = c.voters.attend.length > 0 ? c.voters.attend.join(", ") : "(なし)";
  const maybe = c.voters.maybe.length > 0 ? c.voters.maybe.join(", ") : "(なし)";
  return `${formatJstDateTimeLabel(c.date)}\n  ◯ ${attend}\n  △ ${maybe}`;
}

/**
 * 締切検知〜自動取込結果のSlack通知本文を組み立てる。
 * 取込成功時は自動採用された上位2日程の招待対象者のみを出す —
 * 落選した候補や0票の候補は調整さんページを見れば済むので通知しない。
 */
export function buildPollDeadlineSlackText(
  poll: SchedulePoll,
  outcome: PollDeadlineNotifyOutcome,
): string {
  const base = safeAppBaseUrl();
  const header = `⏰ 日程調整の締切を検知しました:「${poll.title}」`;
  const chouseisanLine = `調整さん: ${poll.chouseisanUrl}`;
  const pollsLink = base ? `${base}/polls` : null;

  switch (outcome.kind) {
    case "imported": {
      const sorted = [...outcome.adopted].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );
      return [
        header,
        "",
        "✅ 上位2日程でイベントを作成しました",
        ...(base ? [`イベント: ${base}/events/${outcome.eventId}`] : []),
        "",
        sorted.map(formatCandidateVoters).join("\n\n"),
        "",
        chouseisanLine,
      ].join("\n");
    }
    case "no_votes":
      return [
        header,
        "",
        "⚠️ 回答が集まりませんでした(全候補0点)。イベントは自動作成していません。",
        "必要であれば管理画面の「結果を取り込む」で手動取込、または日程調整をやり直してください。",
        ...(pollsLink ? [`管理画面: ${pollsLink}`] : []),
        chouseisanLine,
      ].join("\n");
    case "no_candidates":
      return [
        header,
        "",
        "⚠️ 集計できる候補が見つかりませんでした(調整さんのページ構成が変わった可能性があります)。",
        "管理画面から手動で取り込みを試すか、内容を確認してください。",
        ...(pollsLink ? [`管理画面: ${pollsLink}`] : []),
        chouseisanLine,
      ].join("\n");
    case "already_imported":
      return [
        header,
        "",
        "既に取込済みです。",
        ...(base ? [`イベント: ${base}/events/${outcome.eventId}`] : []),
      ].join("\n");
    case "in_progress":
      return [
        header,
        "",
        "⚠️ ちょうど手動取込と処理が重なったため、今回の自動取込はスキップしました。",
        "取込済みかどうかは管理画面でご確認ください。",
        ...(pollsLink ? [`管理画面: ${pollsLink}`] : []),
      ].join("\n");
    case "error":
      return [
        header,
        "",
        `❌ 自動取込に失敗しました: ${outcome.message}`,
        "管理画面の「結果を取り込む」から手動で再試行してください。",
        ...(pollsLink ? [`管理画面: ${pollsLink}`] : []),
      ].join("\n");
  }
}

// ---------- I/O ----------

/** Slack Incoming Webhookへテキストを投稿する。未設定なら何もしない(opt-in) */
export async function postSlackMessage(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // 本文には調整さんの回答者名(自由入力)がそのまま入るため、mrkdwnを無効化して
    // <!channel> 等のメンション記法やリンク偽装(<url|label>)として解釈されないようにする
    body: JSON.stringify({ text, mrkdwn: false }),
  });
  if (!res.ok) {
    throw new Error(`Slack通知に失敗しました(HTTP ${res.status})`);
  }
}
