import type { messagingApi } from "@line/bot-sdk";
import { describe, expect, it } from "vitest";
import { parsePostbackData } from "@/contracts/postback";
import {
  buildAnnounceMessages,
  buildDayBeforeMessages,
  buildDayOfMessages,
  buildGroupInviteMessages,
  buildSlideRequestMessages,
  buildSurveyMessages,
} from "./templates";

const SESSION_ID = "0d4ee5c2-7c3a-4c4c-9a5e-4f8a0d9b6c1a";

function textOf(messages: messagingApi.Message[]): string {
  const m = messages[0];
  if (m.type !== "text") throw new Error("text message expected");
  return (m as messagingApi.TextMessage).text;
}

describe("announce", () => {
  it("日程ごとに参加ボタンと取消ボタンを持つFlexを組み立てる", () => {
    const [message] = buildAnnounceMessages({
      eventTitle: "7月交流会",
      sessions: [
        { sessionId: SESSION_ID, label: "7/18(土) 19:00" },
        { sessionId: SESSION_ID, label: "7/25(土) 19:00" },
      ],
    });
    expect(message.type).toBe("flex");
    const flex = message as messagingApi.FlexMessage;
    expect(flex.altText).toContain("7月交流会");

    const bubble = flex.contents as messagingApi.FlexBubble;
    const buttons = (bubble.body?.contents ?? []).filter(
      (c): c is messagingApi.FlexButton => c.type === "button",
    );
    // 2日程 × (参加 + 取消)
    expect(buttons).toHaveLength(4);

    const actions = buttons.map(
      (b) => b.action as messagingApi.PostbackAction,
    );
    const attend = actions.filter(
      (a) => parsePostbackData(a.data ?? "")?.action === "attend",
    );
    const cancel = actions.filter(
      (a) => parsePostbackData(a.data ?? "")?.action === "cancel",
    );
    expect(attend).toHaveLength(2);
    expect(cancel).toHaveLength(2);
    // displayText を付けない = タップしてもトークに何も流れない(通知抑制の運用判断)
    expect(attend[0].displayText).toBeUndefined();
    expect(cancel[0].displayText).toBeUndefined();
  });
});

describe("テキストテンプレート", () => {
  it("グループ案内は招待リンクを含む", () => {
    const text = textOf(
      buildGroupInviteMessages({
        dateLabel: "7/18(土)",
        inviteLink: "https://line.me/ti/g/xxxx",
      }),
    );
    expect(text).toContain("7/18(土)");
    expect(text).toContain("https://line.me/ti/g/xxxx");
  });

  it("スライド案内は全体向けの依頼にする(個人メンションなし)", () => {
    const text = textOf(
      buildSlideRequestMessages({
        dateLabel: "7/18(土)",
        slideUrl: "https://example.com/slide",
      }),
    );
    expect(text).toContain("https://example.com/slide");
    expect(text).toContain("まだ書いていない人は");
  });

  it("前日案内は開始時間・スライドURL・記入依頼を含む", () => {
    const text = textOf(
      buildDayBeforeMessages({
        dateLabel: "7/18(土)",
        startTime: "19:00",
        slideUrl: "https://example.com/slide",
      }),
    );
    expect(text).toContain("明日");
    expect(text).toContain("19:00");
    expect(text).toContain("https://example.com/slide");
    expect(text).toContain("記入");
  });

  it("当日案内は参加方法と当日の流れを含む", () => {
    const text = textOf(
      buildDayOfMessages({
        dateLabel: "7/18(土)",
        startTime: "19:00",
        meetingInfo: "Zoom: https://zoom.us/j/123",
        slideUrl: "https://example.com/slide",
        dayFlow: "19:00 乾杯\n19:30 トーク",
      }),
    );
    expect(text).toContain("本日");
    expect(text).toContain("Zoom: https://zoom.us/j/123");
    expect(text).toContain("当日の流れ");
    expect(text).toContain("19:30 トーク");
  });

  it("当日の流れが未設定ならセクションごと省略する", () => {
    const text = textOf(
      buildDayOfMessages({
        dateLabel: "7/18(土)",
        startTime: "19:00",
        meetingInfo: "会場A",
        slideUrl: "https://example.com/slide",
        dayFlow: null,
      }),
    );
    expect(text).not.toContain("当日の流れ");
  });

  it("アンケートは要件の定型文の形式でURL2種を含む", () => {
    const text = textOf(
      buildSurveyMessages({
        firstTimeUrl: "https://example.com/first",
        repeatUrl: "https://example.com/repeat",
      }),
    );
    expect(text).toContain("◯交流会参加者アンケート");
    expect(text).toContain("▽回答が1回目の方用");
    expect(text).toContain("https://example.com/first");
    expect(text).toContain("▽回答が2回目以降の方用");
    expect(text).toContain("https://example.com/repeat");
  });
});
