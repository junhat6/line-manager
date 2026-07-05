/**
 * 日程の編集フォーム保存時に、自動送信(前日・当日・アンケート)の新しい予約時刻を決める。
 *
 * フォームには保存時の予約時刻が datetime-local として表示されているため、
 * 「フォーム値がDBの現在値と一致するか」で "ユーザーが触ったか" を判別できる:
 * - 空欄(送信済みでdisabledなど) → 変更しない
 * - ユーザーが明示的に変更した値 → そのまま尊重する
 * - 触っていない値 → 開催日時の変更量(shiftMs)だけずらして追従させる。
 *   開催日を1週間ずらしたら案内も1週間ずれる、というカレンダー的な直感に合わせ、
 *   カスタマイズ済みの時刻(例: 前日18:00)も相対位置を保ったまま追従する
 *
 * この関数を挟まず「フォーム値をそのまま保存」にすると、開催日だけ変えた保存で
 * 案内が旧開催日基準のまま残り、気づかないうちに的外れな日に自動送信される。
 */
export function resolveScheduledAt(
  formValue: Date | null,
  currentValue: Date | null,
  shiftMs: number,
): Date | null {
  if (!formValue) return null;
  if (currentValue && formValue.getTime() === currentValue.getTime()) {
    return new Date(formValue.getTime() + shiftMs);
  }
  return formValue;
}
