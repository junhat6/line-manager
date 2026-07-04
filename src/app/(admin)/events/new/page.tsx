import { createEvent } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function NewEventPage() {
  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">新しいイベント</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          LINE日程調整の結果から選んだ開催日程(最大2つ)を登録します。
          作成すると、前日15:00・当日9:00・アンケートの自動送信が予約されます。
        </p>
      </div>

      <Card>
        <CardContent>
          <form action={createEvent}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">イベント名</FieldLabel>
                <Input
                  id="title"
                  type="text"
                  name="title"
                  required
                  autoComplete="off"
                  placeholder="例: 7月交流会"
                />
              </Field>

              <FieldSet>
                <FieldLegend variant="label">日程1(必須)</FieldLegend>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    name="date1"
                    required
                    aria-label="日程1の日付"
                    className="w-fit"
                  />
                  <Input
                    type="time"
                    name="time1"
                    required
                    defaultValue="19:00"
                    aria-label="日程1の開始時刻"
                    className="w-fit"
                  />
                </div>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">日程2(任意)</FieldLegend>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    name="date2"
                    aria-label="日程2の日付"
                    className="w-fit"
                  />
                  <Input
                    type="time"
                    name="time2"
                    aria-label="日程2の開始時刻"
                    className="w-fit"
                  />
                </div>
              </FieldSet>

              <Field>
                <SubmitButton className="w-fit">作成する</SubmitButton>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
