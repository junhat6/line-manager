/**
 * 日程調整の開始時刻セレクトの選択肢。
 * 運用上30分刻みしか使わないため00分/30分のみ(contracts/forms.ts の halfHourTime と対)。
 * サーバコンポーネントとクライアントコンポーネントの両方から使うため "use client" を付けない。
 */
export const HALF_HOUR_TIME_ITEMS = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, "0");
  const minute = i % 2 === 0 ? "00" : "30";
  const value = `${hour}:${minute}`;
  return { value, label: value };
});

/** 開始時刻の既定値(交流会の通常開催時刻) */
export const DEFAULT_POLL_TIME = "20:00";
