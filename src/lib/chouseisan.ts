/**
 * 調整さん(chouseisan.com)クライアント。
 *
 * 調整さんに公式APIは無いため、Webフォームと同じリクエストを送る方式で実現している。
 * ページ構造の変更で壊れる可能性があるため、想定と異なる応答に当たったら
 * 具体的なエラーメッセージで throw し、管理画面で気づけるようにする。
 *
 * 現行仕様(2026-07 実機確認):
 * - イベント作成: トップページのスクリプト内 `csrf='"..."'` がCSRFトークン。
 *   `_token`/`name`/`comment`/`kouho`(候補の改行区切り)を /schedule/newEvent/create へ
 *   POST すると `create_complete?h=<hash>` へ302し、このhashがイベントIDになる
 * - 結果取得: /schedule/List/createCsv?h=<hash> がCSVを返す(現在はUTF-8。
 *   旧仕様のShift_JISにもフォールバックで対応)
 */
import type { PollCandidate } from "@/db/schema";
import { formatJstDateTimeLabel, jstToUtc, toJstParts } from "@/lib/jst";

const BASE_URL = "https://chouseisan.com";
// 素のfetchのUAを弾かれても切り分けられるよう、ブラウザ相当のUAを名乗る
const USER_AGENT =
  "Mozilla/5.0 (compatible; line-manager/1.0; +https://github.com/junhat6/line-manager)";

// ---------- 純粋ロジック(テスト対象) ----------

/** now が属する月の翌月1日(JST 0:00)を返す */
export function nextMonthStart(now: Date): Date {
  const p = toJstParts(now);
  const year = p.month === 12 ? p.year + 1 : p.year;
  const month = p.month === 12 ? 1 : p.month + 1;
  return jstToUtc(year, month, 1);
}

/**
 * 対象月の全日程の開始日時(かんたん作成用)。時刻は全日共通。
 * 例: hour=20 → [7/1 20:00, ..., 7/31 20:00](JST)
 */
export function buildMonthCandidateDates(
  targetMonth: Date,
  hour: number,
  minute: number,
): Date[] {
  const p = toJstParts(targetMonth);
  const dates: Date[] = [];
  for (let day = 1; day <= 31; day++) {
    const date = jstToUtc(p.year, p.month, day, hour, minute);
    if (toJstParts(date).month !== p.month) break;
    dates.push(date);
  }
  return dates;
}

/**
 * 開始日時の一覧を調整さんに登録する候補(ラベル+開始日時)に変換する。
 * ラベルは「8/1(土) 20:00」形式。取込時のCSV照合キーになるため、
 * 生成ルールを変えると既存の未取込の日程調整が照合できなくなることに注意。
 */
export function toPollCandidates(dates: Date[]): PollCandidate[] {
  return [...dates]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((date) => ({
      label: formatJstDateTimeLabel(date),
      startAt: date.toISOString(),
    }));
}

export type CandidateResult = {
  label: string;
  /** 開催開始日時。candidates照合ではstartAt、旧ロジック(月+日復元)ではその日の0:00 JST */
  date: Date;
  attend: number; // ○
  maybe: number; // △
  absent: number; // ×
  /** ○=1点 + △=0.5点 (×と未入力は0点) */
  score: number;
  /** 誰が◯/△/×を付けたか(名前)。Slack通知で「誰を招待すべきか」を示すのに使う */
  voters: { attend: string[]; maybe: string[]; absent: string[] };
};

/**
 * 候補行の2列目以降(参加者ごとの回答)を集計する。
 * namesは名前ヘッダー行の2列目以降(列位置で回答と対応)。取得できない/欠けている場合は
 * 「N人目」にフォールバックする(名前ヘッダーが無い変則的なCSVでも集計自体は壊さないため)。
 */
function countMarks(
  row: string[],
  names: string[],
): {
  attend: number;
  maybe: number;
  absent: number;
  score: number;
  voters: { attend: string[]; maybe: string[]; absent: string[] };
} {
  const voters = { attend: [] as string[], maybe: [] as string[], absent: [] as string[] };
  const voterNames = names.slice(1);
  row.slice(1).forEach((cell, i) => {
    const mark = cell.trim();
    const name = (voterNames[i] ?? "").trim() || `${i + 1}人目`;
    if (mark === "○" || mark === "◯") voters.attend.push(name);
    else if (mark === "△") voters.maybe.push(name);
    else if (mark === "×" || mark === "✕") voters.absent.push(name);
    // 未入力・その他は集計対象外
  });
  return {
    attend: voters.attend.length,
    maybe: voters.maybe.length,
    absent: voters.absent.length,
    score: voters.attend.length + voters.maybe.length * 0.5,
    voters,
  };
}

/**
 * 調整さんのCSVを、作成時に保存した候補一覧とのラベル完全一致で集計する。
 * ラベルは登録した文字列がそのままCSVの先頭列に返る前提(照合キー)。
 * 一致しない行(ヘッダ・コメント行など)は無視し、同じラベルは最初の行だけ採用する。
 */
export function tallyChouseisanCsvByLabel(
  csvText: string,
  candidates: PollCandidate[],
): CandidateResult[] {
  const remaining = new Map(candidates.map((c) => [c.label, c]));
  const results: CandidateResult[] = [];
  const rows = parseCsvRows(csvText);
  // 名前ヘッダー行は固定位置(3行目)に頼らず「最初に候補行としてマッチした行の直前行」とする。
  // 候補行の判定自体が位置非依存(ラベル完全一致)なので、この方が一貫性がある
  let names: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = (row[0] ?? "").trim();
    const candidate = remaining.get(label);
    if (!candidate) continue;
    remaining.delete(label);
    if (results.length === 0) names = rows[i - 1] ?? [];
    results.push({
      label,
      date: new Date(candidate.startAt),
      ...countMarks(row, names),
    });
  }
  return results;
}

/**
 * 調整さんのCSV(デコード済みテキスト)をパースして候補日ごとの集計を返す。
 * CSVの構成: 1行目=イベント名 / 2行目=メモ / 3行目=名前ヘッダ / 以降=候補行(+末尾にコメント行)。
 * 行の特定は位置ではなく「先頭列が M/D 形式か」で行う(コメント行などを安全に読み飛ばすため)。
 * 対象月以外の M/D は無視する(候補はこのシステムが生成した対象月の日付だけのはずなので、
 * それ以外はコメント等の誤検出とみなす)。
 */
export function parseChouseisanCsv(
  csvText: string,
  targetMonth: Date,
): CandidateResult[] {
  const target = toJstParts(targetMonth);
  const results: CandidateResult[] = [];
  const rows = parseCsvRows(csvText);
  let names: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = (row[0] ?? "").trim();
    const m = /^(\d{1,2})\/(\d{1,2})/.exec(label);
    if (!m) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month !== target.month) continue;

    if (results.length === 0) names = rows[i - 1] ?? [];
    results.push({
      label,
      date: jstToUtc(target.year, month, day),
      ...countMarks(row, names),
    });
  }
  return results;
}

/** score降順、同点は早い日付順。上位を返す(呼び出し側で slice する) */
export function rankCandidates(results: CandidateResult[]): CandidateResult[] {
  return [...results].sort(
    (a, b) => b.score - a.score || a.date.getTime() - b.date.getTime(),
  );
}

/** ダブルクォート対応の最小CSVパーサ(名前やコメントにカンマ・改行が入っても壊れないように) */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** イベントURL(https://chouseisan.com/s?h=xxxx)からハッシュを取り出す */
export function extractEventHash(eventUrl: string): string {
  const h = new URL(eventUrl).searchParams.get("h");
  // 英数字のみ許可: 後段でURLに連結するため、クエリ注入をここで遮断する
  if (!h || !/^[0-9a-zA-Z]+$/.test(h)) {
    throw new Error(`調整さんのイベントURLからハッシュを取得できません: ${eventUrl}`);
  }
  return h;
}

// ---------- I/O ----------

/**
 * リダイレクトを手動で追いながら Set-Cookie を蓄積して最終ページを取得する。
 * Node の fetch は自動リダイレクト時に途中ホップの Set-Cookie を捨てるため、
 * CSRFトークンと対になるセッションCookieを確実に拾うには手動で追う必要がある。
 */
async function getPageWithCookies(
  url: string,
): Promise<{ html: string; cookie: string }> {
  const cookies = new Map<string, string>();
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, {
      headers: {
        "user-agent": USER_AGENT,
        ...(cookies.size > 0
          ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      redirect: "manual",
    });
    for (const setCookie of res.headers.getSetCookie()) {
      const pair = setCookie.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error("調整さんのリダイレクト先が取得できません");
      }
      const next = new URL(location, current);
      // セッションCookieを外部ホストへ送らないよう、同一オリジン内のみ追う
      if (next.origin !== BASE_URL) {
        throw new Error(`調整さんが外部へリダイレクトしました: ${next.origin}`);
      }
      current = next.toString();
      continue;
    }
    if (!res.ok) {
      throw new Error(`調整さんのページ取得に失敗しました(HTTP ${res.status})`);
    }
    return {
      html: await res.text(),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    };
  }
  throw new Error("調整さんのリダイレクトが多すぎます");
}

/** 調整さんにイベントを作成し、共有用URLを返す(ログイン不要の匿名イベント) */
export async function createChouseisanEvent(input: {
  title: string;
  comment: string;
  candidates: string[];
}): Promise<{ url: string }> {
  const { html, cookie } = await getPageWithCookies(`${BASE_URL}/`);

  const token = /csrf='"([^"']+)"'/.exec(html)?.[1];
  if (!token) {
    throw new Error(
      "調整さんのCSRFトークンが見つかりません。ページ構造が変わった可能性があります",
    );
  }

  const createRes = await fetch(`${BASE_URL}/schedule/newEvent/create`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      // CSRFトークンはセッションCookieと対で検証されるため、GETのCookieを引き継ぐ
      cookie,
    },
    body: new URLSearchParams({
      _token: token,
      name: input.title,
      comment: input.comment,
      kouho: input.candidates.join("\n"),
    }),
    // 成功時は create_complete?h=<hash> へ302する。この Location がほしいので追わない
    redirect: "manual",
  });
  const location = createRes.headers.get("location") ?? "";
  const hash = /[?&]h=([0-9a-zA-Z]+)/.exec(location)?.[1];
  if (createRes.status < 300 || createRes.status >= 400 || !hash) {
    throw new Error(
      `調整さんのイベント作成に失敗しました(HTTP ${createRes.status})。ページ仕様が変わった可能性があります`,
    );
  }
  return { url: `${BASE_URL}/s?h=${hash}` };
}

/** 出欠表CSVを取得してテキストで返す(現行はUTF-8、旧仕様のShift_JISにもフォールバック) */
export async function fetchChouseisanCsv(eventUrl: string): Promise<string> {
  const hash = extractEventHash(eventUrl);
  const res = await fetch(`${BASE_URL}/schedule/List/createCsv?h=${hash}`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`調整さんの出欠表CSV取得に失敗しました(HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("shift_jis").decode(buf);
}
