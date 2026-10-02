import { randomUUID } from 'node:crypto';

export const RUN_STATUSES = Object.freeze([
  'running',
  'completed',
  'failed',
  'aborted',
  'timeout',
]);

export const TERMINAL_RUN_STATUSES = Object.freeze([
  'completed',
  'failed',
  'aborted',
  'timeout',
]);

function toRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    prompt: row.prompt,
    output: row.output,
    error: row.error,
    provider: row.provider,
    model: row.model,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };
}

export class RunRepository {
  constructor(db) {
    this.db = db;
    this.statements = {
      insert: db.prepare(
        `INSERT INTO agent_runs (id, session_id, status, prompt, provider, model, started_at)
         VALUES (?, ?, 'running', ?, ?, ?, ?)`,
      ),
      byId: db.prepare('SELECT * FROM agent_runs WHERE id = ?'),
      byIdForOwner: db.prepare(
        `SELECT agent_runs.* FROM agent_runs
         JOIN sessions ON sessions.id = agent_runs.session_id
         WHERE agent_runs.id = ? AND sessions.api_key_hash = ?`,
      ),
      listForSession: db.prepare(
        'SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT ?',
      ),
      finish: db.prepare(
        `UPDATE agent_runs
         SET status = ?, output = ?, error = ?, usage_json = ?, finished_at = ?, duration_ms = ?
         WHERE id = ?`,
      ),
    };
  }

  /** Insert a new run in the `running` state. */
  create({ sessionId, prompt, provider = null, model = null }) {
    const id = randomUUID();
    this.statements.insert.run(
      id,
      sessionId,
      prompt,
      provider,
      model,
      new Date().toISOString(),
    );
    return this.findById(id);
  }

  findById(id) {
    return toRun(this.statements.byId.get(id));
  }

  /** Ownership-scoped lookup; returns null for foreign or unknown runs. */
  findByIdForOwner(id, apiKeyHash) {
    return toRun(this.statements.byIdForOwner.get(id, apiKeyHash));
  }

  listForSession(sessionId, { limit = 50 } = {}) {
    return this.statements.listForSession.all(sessionId, limit).map(toRun);
  }

  /**
   * Move a run into a terminal state. Rejects invalid statuses and silently
   * ignores attempts to overwrite an already-finished run.
   *
   * @returns {object|null} the updated run, or null when nothing changed
   */
  finish(id, { status, output = null, error = null, usage = null }) {
    if (!TERMINAL_RUN_STATUSES.includes(status)) {
      throw new Error(`Invalid terminal run status: ${status}`);
    }
    const current = this.statements.byId.get(id);
    if (!current || current.status !== 'running') return null;
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(current.started_at);
    this.statements.finish.run(
      status,
      output,
      error,
      usage ? JSON.stringify(usage) : null,
      finishedAt,
      durationMs,
      id,
    );
    return this.findById(id);
  }
}
