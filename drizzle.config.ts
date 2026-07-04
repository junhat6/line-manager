import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // マイグレーション適用時のみ必要(`npm run db:migrate`)。生成だけなら不要。
    url: process.env.DATABASE_URL ?? "",
  },
});
