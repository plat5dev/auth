CREATE TABLE IF NOT EXISTS openauth_kv (
    key_path   TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    expires_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS openauth_kv_prefix_idx
    ON openauth_kv (key_path text_pattern_ops);

CREATE INDEX IF NOT EXISTS openauth_kv_expires_idx
    ON openauth_kv (expires_at)
    WHERE expires_at IS NOT NULL;
