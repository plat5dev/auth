import { readdir } from "fs/promises";
import { join } from "path";
import type { Sql } from "./pool.ts";
import { SCHEMA } from "./pool.ts";

export async function migrate(sql: Sql): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await sql.unsafe(`SET search_path TO ${SCHEMA}`);

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const dir = join(import.meta.dir, "migrations");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const name of files) {
    const version = name.replace(/\.sql$/, "");
    const existing = await sql`
      SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1
    `;
    if (existing.length > 0) {
      continue;
    }

    const body = await Bun.file(join(dir, name)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      await tx.unsafe(body);
      await tx`
        INSERT INTO schema_migrations (version) VALUES (${version})
      `;
    });
  }
}
