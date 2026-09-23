-- One row per redeemed OAuth authorization code, so a code cannot be spent twice.
-- Tiny and self-cleaning: rows are only needed until the code would have expired anyway.
CREATE TABLE IF NOT EXISTS oauth_used_codes (
  jti        TEXT PRIMARY KEY,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_used_codes_expiry ON oauth_used_codes(expires_at);
