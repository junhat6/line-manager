import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/session";

/**
 * ログインフォーム(/login)の送信先。
 * このパスへのPOSTだけが src/proxy.ts の認証免除を受ける。
 * Server Actionにしない理由は src/app/login/page.tsx のコメント参照。
 */

// ハッシュ化してから比較する — 長さ比較すら挟まず、
// 応答時間の差から資格情報の情報が漏れないようにする
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * ログイン後の戻り先はサイト内パスのみ許可する(オープンリダイレクト防止)。
 * 文字列の前方一致ではなくURLとして解決してオリジン一致で判定する —
 * WHATWGパーサは "/\evil.com" の \ を / に正規化するため、
 * 「// 始まりを弾く」だけの文字列検査では外部オリジンを取りこぼす。
 */
function sanitizeFrom(from: FormDataEntryValue | null, base: URL): string {
  if (typeof from !== "string") return "/";
  let url: URL;
  try {
    url = new URL(from, base);
  } catch {
    return "/";
  }
  return url.origin === base.origin ? `${url.pathname}${url.search}` : "/";
}

export async function POST(req: NextRequest) {
  // フォームは同一オリジンのページからしか送られない。Origin不一致は
  // 他サイトからのログインCSRFとみなして拒否する
  // (Route HandlerにはServer Actionのような自動Origin検査がない)
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.nextUrl.host) {
    return new Response("forbidden", { status: 403 });
  }

  const expectedUser = process.env.ADMIN_USER;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    return new Response("ADMIN_USER / ADMIN_PASSWORD is not configured", {
      status: 500,
    });
  }

  const form = await req.formData();
  const user = form.get("user");
  const password = form.get("password");
  const from = sanitizeFrom(form.get("from"), req.nextUrl);

  const ok =
    typeof user === "string" &&
    typeof password === "string" &&
    safeEqual(user, expectedUser) &&
    safeEqual(password, expectedPassword);

  if (!ok) {
    // 総当たりを遅くする最低限の措置(サーバーレスではインメモリの
    // レート制限がインスタンスをまたいで効かないため、定数遅延に留める)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const retryUrl = new URL("/login", req.url);
    retryUrl.searchParams.set("error", "1");
    if (from !== "/") {
      retryUrl.searchParams.set("from", from);
    }
    return NextResponse.redirect(retryUrl, 303);
  }

  const token = createSessionToken();
  if (!token) {
    // envは上で検査済みなので到達しない(型の上のnullを潰すだけ)
    return new Response("failed to create session", { status: 500 });
  }
  const res = NextResponse.redirect(new URL(from, req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, // XSSが起きてもcookieは読ませない
    secure: process.env.NODE_ENV === "production", // 開発はhttpなので外す
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
