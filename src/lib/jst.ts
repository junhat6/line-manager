// JSTはDSTがないため固定オフセットで安全に計算できる。
// ライブラリを入れずにepoch演算+UTCゲッターで完結させる。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

export type JstParts = {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0=日
  hour: number;
  minute: number;
};

export function toJstParts(date: Date): JstParts {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: j.getUTCFullYear(),
    month: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    weekday: j.getUTCDay(),
    hour: j.getUTCHours(),
    minute: j.getUTCMinutes(),
  };
}

export function jstToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS);
}

/** 例: "7/18(土)" */
export function formatJstDateLabel(date: Date): string {
  const p = toJstParts(date);
  return `${p.month}/${p.day}(${WEEKDAYS_JA[p.weekday]})`;
}

/** 例: "19:00" */
export function formatJstTime(date: Date): string {
  const p = toJstParts(date);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

/** 例: "7/18(土) 19:00" */
export function formatJstDateTimeLabel(date: Date): string {
  return `${formatJstDateLabel(date)} ${formatJstTime(date)}`;
}

/** 開催日の前日15:00 JST */
export function dayBeforeAt15(startAt: Date): Date {
  const p = toJstParts(startAt);
  return new Date(jstToUtc(p.year, p.month, p.day, 15, 0).getTime() - DAY_MS);
}

/** 開催日当日の9:00 JST */
export function dayOfAt9(startAt: Date): Date {
  const p = toJstParts(startAt);
  return jstToUtc(p.year, p.month, p.day, 9, 0);
}

/** アンケート送信のデフォルト: 開催日当日の21:00 JST */
export function defaultSurveyAt(startAt: Date): Date {
  const p = toJstParts(startAt);
  return jstToUtc(p.year, p.month, p.day, 21, 0);
}

/** <input type="datetime-local"> 用の値(JST表記)。例: "2026-07-18T19:00" */
export function formatJstForInput(date: Date): string {
  const p = toJstParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** <input type="datetime-local"> の値(JSTとして解釈)をDateに変換 */
export function parseJstFromInput(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`日時の形式が不正です: ${value}`);
  return jstToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
}
