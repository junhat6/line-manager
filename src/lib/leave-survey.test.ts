import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { messagingApi } from "@line/bot-sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  events,
  lineGroupMembers,
  lineGroups,
  sessions,
  settings,
} from "@/db/schema";
import {
  buildMemberLeftSlackText,
  pickCancelledSession,
  processMemberLeft,
} from "./leave-survey";

describe("pickCancelledSession", () => {
  const at = (iso: string) => new Date(iso);

  it("開催前の退会は直近の日程を返す", () => {
    const rows = [
      { startAt: at("2026-07-29T19:00:00+09:00") },
      { startAt: at("2026-07-22T19:00:00+09:00") },
    ];
    expect(
      pickCancelledSession(rows, at("2026-07-20T10:00:00+09:00")),
    ).toEqual({ startAt: at("2026-07-22T19:00:00+09:00") });
  });

  it("全日程の開催後の退会はnull(自然な離脱として扱う)", () => {
    const rows = [{ startAt: at("2026-07-22T19:00:00+09:00") }];
    expect(
      pickCancelledSession(rows, at("2026-07-23T10:00:00+09:00")),
    ).toBeNull();
  });

  it("開始時刻ちょうどの退会はキャンセル扱いしない", () => {
    const start = at("2026-07-22T19:00:00+09:00");
    expect(pickCancelledSession([{ startAt: start }], start)).toBeNull();
  });

  it("日程が紐づかないグループ(空配列)はnull", () => {
    expect(
      pickCancelledSession([], at("2026-07-20T10:00:00+09:00")),
    ).toBeNull();
  });
});

describe("buildMemberLeftSlackText", () => {
  it("記録済みの表示名・日程・失敗理由を含む", () => {
    const text = buildMemberLeftSlackText({
      displayName: "山田太郎",
      lineUserId: "U1234",
      groupName: "7/22グループ",
      eventTitle: "7月交流会",
      sessionLabel: "7/22(水) 19:00",
      dmFailure: "HTTP 400 friend required",
    });
    expect(text).toContain("山田太郎 (U1234)");
    expect(text).toContain("7月交流会 7/22(水) 19:00");
    expect(text).toContain("7/22グループ");
    expect(text).toContain("HTTP 400 friend required");
  });

  it("表示名の記録がなければuserIdだけでもその旨がわかる", () => {
    const text = buildMemberLeftSlackText({
      displayName: null,
      lineUserId: "U1234",
      groupName: null,
      eventTitle: "7月交流会",
      sessionLabel: "7/22(水) 19:00",
      dmFailure: "x",
    });
    expect(text).toContain("表示名の記録なし (U1234)");
  });
});

// tick.test.tsと同じ理由でPGliteを使う(本物のPostgres方言でクエリを検証する)
async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const migrationsDir = join(__dirname, "../../drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Db;
}

const START_AT = new Date("2026-07-22T19:00:00+09:00");
const FORM_URL = "https://docs.google.com/forms/d/leave/viewform";

async function seed(db: Db, opts: { formUrl?: string } = {}) {
  const [event] = await db
    .insert(events)
    .values({ title: "7月交流会" })
    .returning();
  await db.insert(lineGroups).values({
    lineGroupId: "G-session",
    name: "7/22グループ",
    kind: "session",
    channel: 2,
  });
  await db.insert(sessions).values({
    eventId: event.id,
    startAt: START_AT,
    lineGroupId: "G-session",
  });
  await db.insert(lineGroupMembers).values({
    lineGroupId: "G-session",
    lineUserId: "U-yamada",
    displayName: "山田太郎",
  });
  if (opts.formUrl !== undefined) {
    await db
      .insert(settings)
      .values({ key: "leave_survey_url", value: opts.formUrl });
  }
}

describe("processMemberLeft", () => {
  let db: Db;
  let sent: { to: string; messages: messagingApi.Message[]; channel: number }[];
  let slack: string[];
  let sendError: Error | null;

  const deps = {
    send: async (
      to: string,
      messages: messagingApi.Message[],
      channel: number,
    ) => {
      if (sendError) throw sendError;
      sent.push({ to, messages, channel });
    },
    notifySlack: async (text: string) => {
      slack.push(text);
    },
  };

  beforeEach(async () => {
    db = await createTestDb();
    sent = [];
    slack = [];
    sendError = null;
  });

  const leaveInput = (leftAt: Date) => ({
    lineGroupId: "G-session",
    userIds: ["U-yamada"],
    leftAt,
    channel: 2,
  });

  it("開催前の退会: フォームURL付きDMを送り、Slack通知はしない", async () => {
    await seed(db, { formUrl: FORM_URL });
    await processMemberLeft(
      db,
      leaveInput(new Date("2026-07-20T10:00:00+09:00")),
      deps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("U-yamada");
    expect(sent[0].channel).toBe(2);
    const msg = sent[0].messages[0];
    if (msg.type !== "text") throw new Error("text message expected");
    expect(msg.text).toContain("7/22(水)");
    expect(msg.text).toContain(FORM_URL);
    expect(slack).toHaveLength(0);

    const [member] = await db
      .select()
      .from(lineGroupMembers)
      .where(eq(lineGroupMembers.lineUserId, "U-yamada"));
    expect(member.leftAt).not.toBeNull();
  });

  it("DM送信失敗(友だち未追加など)はSlackに名前と理由を通知する", async () => {
    await seed(db, { formUrl: FORM_URL });
    sendError = new Error("friend required");
    await processMemberLeft(
      db,
      leaveInput(new Date("2026-07-20T10:00:00+09:00")),
      deps,
    );

    expect(slack).toHaveLength(1);
    expect(slack[0]).toContain("山田太郎 (U-yamada)");
    expect(slack[0]).toContain("friend required");
    expect(slack[0]).toContain("7月交流会 7/22(水) 19:00");
  });

  it("フォームURL未設定ならDMを試みず、Slackにその旨を通知する", async () => {
    await seed(db);
    await processMemberLeft(
      db,
      leaveInput(new Date("2026-07-20T10:00:00+09:00")),
      deps,
    );

    expect(sent).toHaveLength(0);
    expect(slack).toHaveLength(1);
    expect(slack[0]).toContain("未設定");
  });

  it("開催後の退会は何も送らないが、退会の記録だけは残す", async () => {
    await seed(db, { formUrl: FORM_URL });
    await processMemberLeft(
      db,
      leaveInput(new Date("2026-07-23T10:00:00+09:00")),
      deps,
    );

    expect(sent).toHaveLength(0);
    expect(slack).toHaveLength(0);
    const [member] = await db
      .select()
      .from(lineGroupMembers)
      .where(eq(lineGroupMembers.lineUserId, "U-yamada"));
    expect(member.leftAt).not.toBeNull();
  });

  it("日程に紐づかないグループ(メイングループ等)の退会は何もしない", async () => {
    await seed(db, { formUrl: FORM_URL });
    await processMemberLeft(
      db,
      {
        lineGroupId: "G-main",
        userIds: ["U-yamada"],
        leftAt: new Date("2026-07-20T10:00:00+09:00"),
        channel: 1,
      },
      deps,
    );

    expect(sent).toHaveLength(0);
    expect(slack).toHaveLength(0);
  });
});
