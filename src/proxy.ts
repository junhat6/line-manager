import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * 管理画面全体をログインセッション(署名付きcookie、src/lib/session.ts)で
 * 保護する(Next.js 16のproxy規約)。未ログインのブラウザ閲覧は /login へ誘導する。
 * 以前はBasic認証だったが、ブラウザ標準の認証ダイアログは文言を変えられず
 * スマホでの入力体験も悪いため、通常のログインページに移行した。
 * LINE webhookは署名検証、cron tickはCRON_SECRETという専用の認証を持つため除外する。
 */
export const config = {
  matcher: [
    "/((?!api/line/webhook|api/cron/tick|_next/static|_next/image|favicon.ico).*)",
  ],
};

export function proxy(req: NextRequest): Response | undefined {
  const { pathname, search } = req.nextUrl;
  const isRead = req.method === "GET" || req.method === "HEAD";

  // 限定公開ページ(/p/docs/[token] の運営マニュアル)はGET閲覧のみ認証免除 —
  // 推測不能なトークンURL自体が認可を兼ねる(リンクを知っていれば誰でも開ける)。
  // matcherで丸ごと除外しない: Server ActionのPOSTはactionIdでグローバルに
  // ディスパッチされるため、除外パスへの未認証POSTが管理系アクションの実行口になる。
  if (isRead && pathname.startsWith("/p/")) {
    return undefined;
  }

  // 認証情報が未設定のまま公開されるのを防ぐ(fail closed)
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
    return new Response("ADMIN_USER / ADMIN_PASSWORD is not configured", {
      status: 500,
    });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = token !== undefined && verifySessionToken(token);

  // ログイン画面(GET)とログインPOSTだけは未認証で通す。
  // /p/ と同じ理由で「ページのGET/HEAD + 専用Route HandlerへのPOST」に限定する
  // (ページへのPOSTを免除するとServer Actionの実行口になる)。
  if (pathname === "/login" && isRead) {
    // ログイン済みならログイン画面を見せずトップへ
    return authenticated
      ? NextResponse.redirect(new URL("/", req.url))
      : undefined;
  }
  if (pathname === "/api/auth/login" && req.method === "POST") {
    return undefined;
  }

  if (authenticated) {
    return undefined;
  }

  // ブラウザの画面遷移はログイン画面へ誘導し、元のURLを ?from= で引き継ぐ。
  // それ以外(fetch等)は素直に401を返す
  if (isRead) {
    const loginUrl = new URL("/login", req.url);
    const from = `${pathname}${search}`;
    if (from !== "/") {
      loginUrl.searchParams.set("from", from);
    }
    return NextResponse.redirect(loginUrl);
  }
  return new Response("Authentication required", { status: 401 });
}
