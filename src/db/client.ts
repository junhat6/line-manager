import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * 実装をドライバに縛らないための型。
 * 本番は postgres-js、テストは PGlite を同じ型で受けられる。
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  // dev のHMRで接続が増殖しないよう globalThis にキャッシュする
  if (!globalForDb.__db) {
    // Supabase の Transaction pooler (pgbouncer) は prepared statements 非対応
    const client = postgres(getEnv().DATABASE_URL, { prepare: false });
    globalForDb.__db = drizzle(client, { schema });
  }
  return globalForDb.__db;
}
