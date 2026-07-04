import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /p/docs/[token] が実行時にfsで読む原稿をサーバーレスバンドルに同梱する
  // (force-dynamicなページのfs読み取りは静的解析でトレースされないため明示する)
  outputFileTracingIncludes: {
    "/p/docs/*": ["docs/manual.md"],
  },
  async headers() {
    return [
      {
        // トークンURL配下は検索エンジンに載せない(各ページのmetaタグと二重の保険)
        source: "/p/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
