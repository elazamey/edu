import { createHash, randomUUID } from 'node:crypto';

/** Sessions are owned by the holder of an API key; we store only its hash. */
export function hashApiKey(apiKey) {
  return createHash('sha256').update(String(apiKey)).digest('hex');
}

export class SessionRepository {
  constructor(db) {
    this.db = db;
    this.statements = {
      insert: db.prepare(
        'INSERT INTO sessions (id, api_key_hash, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ),
      byId: db.prepare('SELECT * FROM sessions WHERE id = ?'),
      listForOwner: db.prepare(
        'SELECT * FROM sessions WHERE api_key_hash = ? ORDER BY updated_at DESC LIMIT ?',
      ),
      touch: db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?'),
    };
  }

  create({ apiKeyHash, title = 'New session' }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.statements.insert.run(id, apiKeyHash, title, now, now);
    return this.findById(id);
  }

  findById(id) {
    return this.statements.byId.get(id) ?? null;
  }

  /** Find a session only when it belongs to the given owner hash. */
  findByIdForOwner(id, apiKeyHash) {
    const session = this.findById(id);
    if (!session || session.api_key_hash !== apiKeyHash) return null;
    return session;
  }

  listForOwner(apiKeyHash, { limit = 50 } = {}) {
    return this.statements.listForOwner.all(apiKeyHash, limit);
  }

  touch(id) {
    this.statements.touch.run(new Date().toISOString(), id);
  }

  /** True when the session exists AND belongs to the given owner hash. */
  isOwnedBy(id, apiKeyHash) {
    const session = this.findById(id);
    return session !== null && session.api_key_hash === apiKeyHash;
  }

  exists(id) {
    return this.findById(id) !== null;
  }
}
