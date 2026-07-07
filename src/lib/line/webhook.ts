import type { webhook } from "@line/bot-sdk";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lineGroups } from "@/db/schema";
import { getLineClient } from "./client";

export async function handleWebhookEvent(
  db: Db,
  event: webhook.Event,
  channel = 1,
): Promise<void> {
  switch (event.type) {
    case "join":
      await handleJoin(db, event, channel);
      return;
    case "leave":
      await handleLeave(db, event, channel);
      return;
    default:
      // message / postback / memberJoined などは今回の要件では使わない
      return;
  }
}

/** ボットがグループに招待されたら記録する。これが日程グループ紐付けの入口 */
async function handleJoin(
  db: Db,
  event: webhook.JoinEvent,
  channel: number,
): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;
  const groupId = source.groupId;

  let name: string | null = null;
  try {
    name = (await getLineClient(channel).getGroupSummary(groupId)).groupName;
  } catch {
    // グループ名が取れなくても記録自体は続行する
  }

  await db
    .insert(lineGroups)
    .values({ lineGroupId: groupId, name, channel, active: true })
    .onConflictDoUpdate({
      target: lineGroups.lineGroupId,
      set: {
        active: true,
        // ボットを入れ替えた(旧ボット退出→新ボット招待)場合に担当チャネルを追従させる
        channel,
        joinedAt: new Date(),
        ...(name !== null ? { name } : {}),
      },
    });
}

async function handleLeave(
  db: Db,
  event: webhook.LeaveEvent,
  channel: number,
): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;
  // channel も条件に入れる: ボット入れ替え時、旧ボットの leave が新ボットの
  // join より後に届いても、新しい紐付けを inactive にしないため
  await db
    .update(lineGroups)
    .set({ active: false })
    .where(
      and(
        eq(lineGroups.lineGroupId, source.groupId),
        eq(lineGroups.channel, channel),
      ),
    );
}

