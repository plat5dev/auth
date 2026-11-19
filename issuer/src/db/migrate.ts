import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "./pool.ts";
import { SCHEMA } from "./pool.ts";

// Fixed advisory lock key (int4 pair) serializing concurrent startup migrations.
const MIGRATION_LOCK_NS = 0x706c6174; // "plat"
const MIGRATION_LOCK_ID = 0x61757468; // "auth"

export async function migrate(sql: Sql): Promise<void> {
  const dir = join(import.meta.dir, "migrations");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    files.map(async (name) => ({
      version: name.replace(/\.sql$/, ""),
      body: await Bun.file(join(dir, name)).text(),
    })),
  );

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NS}, ${MIGRATION_LOCK_ID})`;
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await tx.unsafe(`SET LOCAL search_path TO ${SCHEMA}`);

    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    for (const { version, body } of migrations) {
      const existing = await tx`
        SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1
      `;
      if (existing.length > 0) {
        continue;
      }

      await tx.unsafe(body);
      await tx`
        INSERT INTO schema_migrations (version) VALUES (${version})
      `;
    }
  });
}
