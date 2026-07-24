import type { messagingApi } from "@line/bot-sdk";
import { describe, expect, it } from "vitest";
import {
  buildDayBeforeMessages,
  buildDayOfMessages,
  buildGroupInviteMessages,
  buildLeaveSurveyMessages,
  buildPollUrlMessages,
  buildSlideRequestMessages,
  buildSurveyMessages,
  defaultPollMessageBody,
} from "./templates";

function textOf(messages: messagingApi.Message[]): string {
  const m = messages[0];
  if (m.type !== "text") throw new Error("text message expected");
  return (m as messagingApi.TextMessage).text;
}

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

  it("キャンセル理由ヒアリングは日程とフォームURLを含み、責める文面にしない", () => {
    const text = textOf(
      buildLeaveSurveyMessages({
        dateLabel: "7/22(水)",
        formUrl: "https://docs.google.com/forms/d/leave/viewform",
      }),
    );
    expect(text).toContain("7/22(水)");
    expect(text).toContain("https://docs.google.com/forms/d/leave/viewform");
    expect(text).toContain("よろしければ");
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

describe("poll url", () => {
  it("編集済みの本文の末尾にURLを付加する", () => {
    const text = textOf(
      buildPollUrlMessages({
        body: "8月の日程調整です!毎回19:00開始です",
        url: "https://chouseisan.com/s?h=xxxx",
      }),
    );
    expect(text).toBe(
      "8月の日程調整です!毎回19:00開始です\nhttps://chouseisan.com/s?h=xxxx",
    );
  });

  it("既定本文は対象月を含む(フォームのプリフィルと既存行のフォールバックで共用)", () => {
    const body = defaultPollMessageBody(8);
    expect(body).toContain("8月交流会の日程調整");
    const text = textOf(
      buildPollUrlMessages({ body, url: "https://chouseisan.com/s?h=xxxx" }),
    );
    expect(text.endsWith("https://chouseisan.com/s?h=xxxx")).toBe(true);
  });
});
