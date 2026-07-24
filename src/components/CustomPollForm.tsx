"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { ja } from "react-day-picker/locale";
import { startCustomSchedulePoll } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ToastForm } from "@/components/ToastForm";
import { Calendar } from "@/components/ui/calendar";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WEEKDAYS_JA } from "@/lib/jst";
import {
  DEFAULT_POLL_TIME,
  HALF_HOUR_TIME_ITEMS,
} from "@/lib/poll-time-options";

type Props = {
  /** メッセージ欄のプリフィル(既定文面はサーバ側の知識なのでpropsで受ける) */
  defaultMessage: string;
  /** 締切欄のプリフィル("datetime-local"形式。候補選択に応じた動的再計算はしない) */
  defaultDeadline: string;
  /** カレンダーの初期表示月(来月)。Dateはシリアライズ境界を避けて数値で受ける */
  initialYear: number;
  /** 1-12 */
  initialMonth: number;
};

/**
 * カレンダーのDate(ブラウザのローカル0:00)を "YYYY-MM-DD" にする。
 * カレンダーに表示されている日付をそのまま文字列化するので、ブラウザのタイムゾーンに
 * 依らず「クリックした日」がサーバに届く(サーバ側でJSTとして解釈する)。
 */
function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 例: "8/1(土)"。ローカルDate用(jst.tsのformatJstDateLabelはUTC instant用なので使えない) */
function formatLocalDayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS_JA[d.getDay()]})`;
}

function TimeSelect({
  value,
  onValueChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  "aria-label": string;
}) {
  return (
    <Select
      value={value}
      // base-uiはクリア操作でnullを渡しうるが、時刻は未選択を許さないので無視する
      onValueChange={(v) => v !== null && onValueChange(v)}
      items={HALF_HOUR_TIME_ITEMS}
    >
      <SelectTrigger size="sm" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {HALF_HOUR_TIME_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * カスタム日程調整の作成フォーム。
 * カレンダーで候補日を選び、開始時刻は共通値+日付ごとの上書きで決める。
 * 確定した候補はhidden inputのJSONでServer Actionに渡す(フォーム送信の枠組みは
 * かんたん作成と同じToastForm+ConfirmButtonに揃える)。
 */
export function CustomPollForm({
  defaultMessage,
  defaultDeadline,
  initialYear,
  initialMonth,
}: Props) {
  const [selected, setSelected] = useState<Date[]>([]);
  const [commonTime, setCommonTime] = useState(DEFAULT_POLL_TIME);
  // 個別に時刻を変えた日だけ持つ。無い日は共通時刻に追従する
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const sorted = [...selected].sort((a, b) => a.getTime() - b.getTime());
  const candidates = sorted.map((d) => {
    const key = toDateKey(d);
    return { date: key, time: overrides[key] ?? commonTime };
  });

  return (
    <ToastForm action={startCustomSchedulePoll}>
      <input
        type="hidden"
        name="candidates"
        value={JSON.stringify(candidates)}
      />
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>候補日</FieldLabel>
          {/* Fieldの *:w-full を直接受けると日セルが横に伸びるためdivで受ける */}
          <div>
            <Calendar
              mode="multiple"
              selected={selected}
              onSelect={(dates) => setSelected(dates ?? [])}
              locale={ja}
              defaultMonth={new Date(initialYear, initialMonth - 1, 1)}
              disabled={{ before: new Date() }}
              className="rounded-lg border [--cell-size:--spacing(9)]"
            />
          </div>
          <FieldDescription className="text-xs">
            クリックで候補日を選びます。月をまたいでも選べます
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>開始時刻(共通)</FieldLabel>
          <TimeSelect
            value={commonTime}
            onValueChange={setCommonTime}
            aria-label="全候補共通の開始時刻"
          />
          <FieldDescription className="text-xs">
            日付ごとに変えたい場合は、下の候補一覧で個別に変更できます
          </FieldDescription>
        </Field>
        {sorted.length > 0 && (
          <Field>
            <FieldLabel>選択中の候補({sorted.length}件)</FieldLabel>
            <ul className="flex flex-col gap-2">
              {sorted.map((d) => {
                const key = toDateKey(d);
                const label = formatLocalDayLabel(d);
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span className="w-24 text-sm tabular-nums">{label}</span>
                    <TimeSelect
                      value={overrides[key] ?? commonTime}
                      onValueChange={(time) =>
                        setOverrides((o) => ({ ...o, [key]: time }))
                      }
                      aria-label={`${label} の開始時刻`}
                    />
                  </li>
                );
              })}
            </ul>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="custom-poll-deadline">回答の締切日時</FieldLabel>
          <Input
            id="custom-poll-deadline"
            type="datetime-local"
            name="deadline"
            autoComplete="off"
            required
            defaultValue={defaultDeadline}
          />
          <FieldDescription className="text-xs">
            締切当日にLINEでリマインドし、締切後に結果を自動で取り込みます
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="custom-poll-message">
            グループに投稿するメッセージ
          </FieldLabel>
          <Textarea
            id="custom-poll-message"
            name="message"
            autoComplete="off"
            rows={3}
            required
            defaultValue={defaultMessage}
          />
          <FieldDescription className="text-xs">
            調整さんのURLは末尾に自動で付きます
          </FieldDescription>
        </Field>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            カレンダーから候補日を選ぶと作成できます
          </p>
        ) : (
          // Fieldの中に置くと *:w-full で全幅に伸ばされるためFieldGroup直下に置く
          <ConfirmButton
            confirmMessage={`調整さんに${sorted.length}件の候補で日程調整を作成し、上のメッセージをメイングループにLINE送信します。よろしいですか?(グループ人数分のメッセージ数を消費します)`}
            actionLabel="開始する"
            variant="default"
            size="default"
            className="w-fit"
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            {sorted.length}件の候補で作成
          </ConfirmButton>
        )}
      </FieldGroup>
    </ToastForm>
  );
}
