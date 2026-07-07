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
  /** グループ紐付け状態の表示に使う */
  sessionId: string;
  sessionLabel: string;
  trigger: "manual" | "auto";
  status: ScheduledMessage["status"];
  scheduledAt: Date | null;
  sentAt: Date | null;
  error: string | null;
};

const KIND_ORDER: Record<MessageKind, number> = {
  group_invite: 0,
  slide_request: 1,
  day_before: 2,
  day_of: 3,
  survey: 4,
};

/**
 * scheduled_messages を「運営フロー順」に並べたチェックリストにする。
 * 日程ごとに: グループ案内 → スライド → 前日 → 当日 → アンケート
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
      sessionLabel: sessionLabels.get(r.sessionId) ?? "",
      trigger: MESSAGE_KIND_TRIGGER[r.kind],
      status: r.status,
      scheduledAt: r.scheduledAt,
      sentAt: r.sentAt,
      error: r.error,
    }))
    .sort((a, b) => {
      const ai = sessionIndex.get(a.sessionId) ?? 99;
      const bi = sessionIndex.get(b.sessionId) ?? 99;
      if (ai !== bi) return ai - bi;
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    });
}
