-- Chat sessions. A session belongs to the holder of an API key (placeholder
-- identity until real authentication lands) and groups agent runs.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New session',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_api_key_hash ON sessions (api_key_hash);
