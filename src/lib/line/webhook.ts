import type { webhook } from "@line/bot-sdk";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lineGroupMembers, lineGroups } from "@/db/schema";
import { processMemberLeft } from "@/lib/leave-survey";
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
    case "memberJoined":
      await handleMemberJoined(db, event, channel);
      return;
    case "memberLeft":
      await handleMemberLeft(db, event, channel);
      return;
    default:
      // message / postback などは今回の要件では使わない
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

/**
 * メンバー参加時に表示名を記録する。退会(memberLeft)にはuserIdしか載らず、
 * 退会後はプロフィール取得もできないため、退会通知で名前を出す唯一の材料になる。
 */
async function handleMemberJoined(
  db: Db,
  event: webhook.MemberJoinedEvent,
  channel: number,
): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;
  const groupId = source.groupId;

  for (const member of event.joined.members) {
    if (member.type !== "user" || !member.userId) continue;

    let displayName: string | null = null;
    try {
      displayName = (
        await getLineClient(channel).getGroupMemberProfile(
          groupId,
          member.userId,
        )
      ).displayName;
    } catch {
      // プロフィールが取れなくても参加の記録自体は残す
    }

    await db
      .insert(lineGroupMembers)
      .values({ lineGroupId: groupId, lineUserId: member.userId, displayName })
      .onConflictDoUpdate({
        target: [lineGroupMembers.lineGroupId, lineGroupMembers.lineUserId],
        set: {
          // 再参加(退会→出戻り)でも最新の状態に揃える
          joinedAt: new Date(),
          leftAt: null,
          ...(displayName !== null ? { displayName } : {}),
        },
      });
  }
}

/** メンバー退会。開催前の日程別グループならキャンセル理由のヒアリングにつなぐ */
async function handleMemberLeft(
  db: Db,
  event: webhook.MemberLeftEvent,
  channel: number,
): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;

  const userIds = event.left.members
    .filter((m) => m.type === "user")
    .flatMap((m) => (m.userId ? [m.userId] : []));
  if (userIds.length === 0) return;

  await processMemberLeft(db, {
    lineGroupId: source.groupId,
    userIds,
    leftAt: new Date(event.timestamp),
    channel,
  });
}

