import type { webhook } from "@line/bot-sdk";
import { eq } from "drizzle-orm";
import { parsePostbackData } from "@/contracts/postback";
import type { Db } from "@/db/client";
import { attendances, lineGroups, members, sessions } from "@/db/schema";
import { getLineClient } from "./client";

export async function handleWebhookEvent(
  db: Db,
  event: webhook.Event,
): Promise<void> {
  switch (event.type) {
    case "join":
      await handleJoin(db, event);
      return;
    case "leave":
      await handleLeave(db, event);
      return;
    case "postback":
      await handlePostback(db, event);
      return;
    default:
      // message / memberJoined などは今回の要件では使わない
      return;
  }
}

/** ボットがグループに招待されたら記録する。これが日程グループ紐付けの入口 */
async function handleJoin(db: Db, event: webhook.JoinEvent): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;
  const groupId = source.groupId;

  let name: string | null = null;
  try {
    name = (await getLineClient().getGroupSummary(groupId)).groupName;
  } catch {
    // グループ名が取れなくても記録自体は続行する
  }

  await db
    .insert(lineGroups)
    .values({ lineGroupId: groupId, name, active: true })
    .onConflictDoUpdate({
      target: lineGroups.lineGroupId,
      set: {
        active: true,
        joinedAt: new Date(),
        ...(name !== null ? { name } : {}),
      },
    });
}

async function handleLeave(db: Db, event: webhook.LeaveEvent): Promise<void> {
  const source = event.source;
  if (source?.type !== "group") return;
  await db
    .update(lineGroups)
    .set({ active: false })
    .where(eq(lineGroups.lineGroupId, source.groupId));
}

/** 参加ボタン/取消ボタンのタップを attendances に反映する */
async function handlePostback(
  db: Db,
  event: webhook.PostbackEvent,
): Promise<void> {
  const data = parsePostbackData(event.postback.data);
  if (!data) return;

  const source = event.source;
  const userId = source?.userId;
  if (!userId) return;

  // 削除済みイベントのボタンが押された場合などは黙って無視する
  const sessionRows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, data.sessionId));
  if (sessionRows.length === 0) return;

  const memberId = await upsertMember(db, userId, source);

  await db
    .insert(attendances)
    .values({
      sessionId: data.sessionId,
      memberId,
      status: data.action === "attend" ? "attending" : "cancelled",
      source: "postback",
      respondedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [attendances.sessionId, attendances.memberId],
      set: {
        status: data.action === "attend" ? "attending" : "cancelled",
        source: "postback",
        respondedAt: new Date(),
      },
    });
}

async function upsertMember(
  db: Db,
  userId: string,
  source: webhook.Source | undefined,
): Promise<string> {
  let profile: { displayName: string; pictureUrl?: string } | null = null;
  try {
    profile =
      source?.type === "group"
        ? await getLineClient().getGroupMemberProfile(source.groupId, userId)
        : await getLineClient().getProfile(userId);
  } catch {
    // 取得失敗時は既存の表示名を保持したいので上書きしない
  }

  if (profile) {
    const [m] = await db
      .insert(members)
      .values({
        lineUserId: userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl ?? null,
      })
      .onConflictDoUpdate({
        target: members.lineUserId,
        set: {
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl ?? null,
        },
      })
      .returning({ id: members.id });
    return m.id;
  }

  // プロフィール未取得: 既存レコードを保持しつつ行を確実に得る(no-op update)
  const [m] = await db
    .insert(members)
    .values({ lineUserId: userId, displayName: "(名前未取得)" })
    .onConflictDoUpdate({
      target: members.lineUserId,
      set: { lineUserId: userId },
    })
    .returning({ id: members.id });
  return m.id;
}
