import {
  MESSAGE_KIND_LABELS,
  MESSAGE_KIND_TRIGGER,
  type MessageKind,
} from "@/contracts/messages";
import type { ScheduledMessage, Session } from "@/db/schema";
import { formatJstDateLabel } from "@/lib/jst";

export type ChecklistItem = {
  id: string;
  kind: MessageKind;
  label: string;
  /** announce はイベント全体宛なので null。グループ紐付け状態の表示に使う */
  sessionId: string | null;
  /** announce はイベント全体宛なので null */
  sessionLabel: string | null;
  trigger: "manual" | "auto";
  status: ScheduledMessage["status"];
  scheduledAt: Date | null;
  sentAt: Date | null;
  error: string | null;
};

const KIND_ORDER: Record<MessageKind, number> = {
  announce: 0,
  group_invite: 1,
  slide_request: 2,
  day_before: 3,
  day_of: 4,
  survey: 5,
};

/**
 * scheduled_messages を「運営フロー順」に並べたチェックリストにする。
 * アナウンス → (日程ごとに) グループ案内 → スライド → 前日 → 当日 → アンケート
 */
export function buildChecklist(
  sessions: Session[],
  rows: ScheduledMessage[],
): ChecklistItem[] {
  const sessionIndex = new Map(sessions.map((s, i) => [s.id, i]));
  const sessionLabels = new Map(
    sessions.map((s) => [s.id, formatJstDateLabel(s.startAt)]),
  );

  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      label: MESSAGE_KIND_LABELS[r.kind],
      sessionId: r.sessionId,
      sessionLabel: r.sessionId ? (sessionLabels.get(r.sessionId) ?? null) : null,
      trigger: MESSAGE_KIND_TRIGGER[r.kind],
      status: r.status,
      scheduledAt: r.scheduledAt,
      sentAt: r.sentAt,
      error: r.error,
    }))
    .sort((a, b) => {
      const ai = sessionIndexOf(a, rows, sessionIndex);
      const bi = sessionIndexOf(b, rows, sessionIndex);
      if (ai !== bi) return ai - bi;
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    });
}

function sessionIndexOf(
  item: ChecklistItem,
  rows: ScheduledMessage[],
  sessionIndex: Map<string, number>,
): number {
  const row = rows.find((r) => r.id === item.id);
  const sid = row?.sessionId;
  if (!sid) return -1; // announce を先頭に
  return sessionIndex.get(sid) ?? 99;
}
