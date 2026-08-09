CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    identifier   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, identifier)
);

CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON user_identities (user_id);
