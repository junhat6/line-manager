/**
 * 管理画面全体をBasic認証で保護する(Next.js 16のproxy規約)。
 * LINE webhookは署名検証、cron tickはCRON_SECRETという専用の認証を持つため除外する。
 */
export const config = {
  matcher: [
    "/((?!api/line/webhook|api/cron/tick|_next/static|_next/image|favicon.ico).*)",
  ],
};

export function proxy(req: Request): Response | undefined {
  // 参加者向けの参加状況ページ(/p/[token])はGET閲覧のみ認証免除 —
  // 推測不能なトークンURL自体が認可を兼ねる(LINEのボタンから誰でも開けるようにする)。
  // matcherで丸ごと除外しない: Server ActionのPOSTはactionIdでグローバルに
  // ディスパッチされるため、除外パスへの未認証POSTが管理系アクションの実行口になる。
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    new URL(req.url).pathname.startsWith("/p/")
  ) {
    return undefined;
  }

  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  // 認証情報が未設定のまま公開されるのを防ぐ(fail closed)
  if (!user || !password) {
    return new Response("ADMIN_USER / ADMIN_PASSWORD is not configured", {
      status: 500,
    });
  }

  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  if (req.headers.get("authorization") !== expected) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="line-manager"' },
    });
  }

  return undefined;
}
