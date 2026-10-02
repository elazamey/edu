-- Agent runs: one execution of the LLM inside a session. Lifecycle states:
-- running -> completed | failed | aborted | timeout.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'aborted', 'timeout')),
  prompt TEXT NOT NULL,
  output TEXT,
  error TEXT,
  provider TEXT,
  model TEXT,
  usage_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs (session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);
