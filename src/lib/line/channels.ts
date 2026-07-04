/**
 * 複数LINEチャネル(=複数ボットアカウント)の資格情報解決。
 *
 * 無料枠(月200通)をグループ分散でしのぐため、メイングループ用と日程別グループ用で
 * 別チャネルを使えるようにする。チャネル1は既存の環境変数名のまま(後方互換)、
 * 2以降は連番付きの環境変数で追加する:
 *   チャネル1: LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET
 *   チャネルN: LINE_CHANNEL_N_ACCESS_TOKEN / LINE_CHANNEL_N_SECRET (N >= 2)
 */

export type LineChannel = {
  channel: number;
  accessToken: string;
  secret: string;
};

function envKeys(channel: number): { tokenKey: string; secretKey: string } {
  return channel === 1
    ? { tokenKey: "LINE_CHANNEL_ACCESS_TOKEN", secretKey: "LINE_CHANNEL_SECRET" }
    : {
        tokenKey: `LINE_CHANNEL_${channel}_ACCESS_TOKEN`,
        secretKey: `LINE_CHANNEL_${channel}_SECRET`,
      };
}

/**
 * env からチャネル一覧を解決する純粋関数。
 * token/secret の片方だけが設定されている場合は、欠けている変数名を含むエラーを投げる —
 * 片肺のまま黙って動くと、署名検証だけ失敗する等の分かりにくい壊れ方をするため。
 */
export function parseLineChannels(
  env: Record<string, string | undefined>,
): Map<number, LineChannel> {
  const channels = new Map<number, LineChannel>();

  const add = (channel: number) => {
    const { tokenKey, secretKey } = envKeys(channel);
    const accessToken = env[tokenKey];
    const secret = env[secretKey];
    if (!accessToken && !secret) return;
    if (!accessToken) {
      throw new Error(`${secretKey} だけが設定されています(${tokenKey} が未設定)`);
    }
    if (!secret) {
      throw new Error(`${tokenKey} だけが設定されています(${secretKey} が未設定)`);
    }
    channels.set(channel, { channel, accessToken, secret });
  };

  add(1);

  const numbered = new Set<number>();
  for (const key of Object.keys(env)) {
    const m = /^LINE_CHANNEL_(\d+)_(?:ACCESS_TOKEN|SECRET)$/.exec(key);
    if (m) numbered.add(Number(m[1]));
  }
  for (const n of [...numbered].sort((a, b) => a - b)) {
    if (n < 2) {
      throw new Error(
        `チャネル1の資格情報は LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET を使ってください(LINE_CHANNEL_${n}_* は不可)`,
      );
    }
    add(n);
  }

  return channels;
}

let cached: Map<number, LineChannel> | undefined;

// getEnv() と同じく初回アクセス時に解決する(`next build` を env なしで通すため)
export function getLineChannels(): Map<number, LineChannel> {
  cached ??= parseLineChannels(process.env);
  return cached;
}

/**
 * 指定チャネルの資格情報を返す。未設定なら変数名入りで throw —
 * 送信経路では failed の理由欄に載り、運用ミス(チャネル2未設定のままボットB招待など)に
 * 気づけるようにする。
 */
export function getLineChannel(channel: number): LineChannel {
  const found = getLineChannels().get(channel);
  if (!found) {
    const { tokenKey, secretKey } = envKeys(channel);
    throw new Error(`チャネル ${channel} の環境変数(${tokenKey} / ${secretKey})が未設定です`);
  }
  return found;
}
