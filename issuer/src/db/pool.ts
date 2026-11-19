import postgres from "postgres";

import { logger } from "../logger.ts";

export const SCHEMA = "users";

const schemaNameRe = /^[a-z][a-z0-9_]*$/;

export type Sql = ReturnType<typeof postgres>;

export function connect(env: Record<string, string | undefined> = process.env): Sql {
  if (!schemaNameRe.test(SCHEMA)) {
    throw new Error(`invalid schema name ${SCHEMA}`);
  }

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL must be set");
  }

  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      search_path: SCHEMA,
    },
    // A server notice (e.g. "schema already exists, skipping") is a debug line.
    onnotice: (notice) => {
      logger.debug("postgres notice", { notice: String(notice.message) });
    },
  });
}
