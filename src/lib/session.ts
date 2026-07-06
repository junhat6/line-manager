import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 管理画面ログインのセッショントークン(署名付きcookie)。
 * DBを持たないステートレス方式 — proxyが全リクエストで検証するため、
 * リクエストごとのDB参照を避けたい。
 *
 * 署名鍵はADMIN_USER/ADMIN_PASSWORDから導出する。専用のシークレットを
 * 増やさずに済み、「パスワードを変えれば既存セッションも全て無効になる」
 * ため、流出時の失効手段がパスワード変更に一本化される。
 * (独立した鍵だとパスワードを変えても発行済みセッションが生き残る)
 */

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30日

// 資格情報を素のHMAC鍵にすると、トークンは平文の期限+そのHMACなので、
// 流出トークン1つがパスワードのオフライン総当たりの検算材料になる。
// scryptでストレッチして総当たりのコストを桁違いに上げる。
// 導出は重い(数十ms)ためインスタンス内でキャッシュする
let cachedKey: { material: string; key: Buffer } | undefined;

function getKey(): Buffer | null {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) return null;
  const material = `${user}\n${password}`;
  if (cachedKey?.material !== material) {
    cachedKey = {
      material,
      key: scryptSync(material, "line-manager-session", 32),
    };
  }
  return cachedKey.key;
}

function sign(expiresAt: number, key: Buffer): string {
  return createHmac("sha256", key)
    .update(String(expiresAt))
    .digest("base64url");
}

/** 期限付きトークンを発行する。認証情報が未設定ならnull(fail closed) */
export function createSessionToken(): string | null {
  const key = getKey();
  if (!key) return null;
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt, key)}`;
}

export function verifySessionToken(token: string): boolean {
  const key = getKey();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  // 比較の応答時間差から正しい署名を1バイトずつ探られないようにする
  const expected = Buffer.from(sign(expiresAt, key));
  const actual = Buffer.from(token.slice(dot + 1));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
