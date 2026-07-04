import { createEvent } from "@/app/actions";

export default function NewEventPage() {
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold">新しいイベント</h1>
      <p className="text-sm text-slate-600">
        LINE日程調整の結果から選んだ開催日程(最大2つ)を登録します。
        作成すると、前日15:00・当日9:00・アンケートの自動送信が予約されます。
      </p>

      <form
        action={createEvent}
        className="space-y-5 rounded-lg border border-slate-200 bg-white p-6"
      >
        <label className="block">
          <span className="text-sm font-medium">イベント名</span>
          <input
            type="text"
            name="title"
            required
            placeholder="例: 7月交流会"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">日程1(必須)</legend>
          <div className="flex gap-2">
            <input
              type="date"
              name="date1"
              required
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="time"
              name="time1"
              required
              defaultValue="19:00"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">日程2(任意)</legend>
          <div className="flex gap-2">
            <input
              type="date"
              name="date2"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="time"
              name="time2"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </fieldset>

        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          作成する
        </button>
      </form>
    </div>
  );
}
