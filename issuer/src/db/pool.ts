import postgres from "postgres";

export const SCHEMA = "users";

const schemaNameRe = /^[a-z][a-z0-9_]*$/;

export type Sql = ReturnType<typeof postgres>;

export function connect(): Sql {
  if (!schemaNameRe.test(SCHEMA)) {
    throw new Error(`invalid schema name ${SCHEMA}`);
  }

  const url =
    process.env.DATABASE_URL ??
    "postgres://auth:auth@localhost:5432/auth?sslmode=disable";

  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      search_path: SCHEMA,
    },
  });
}
