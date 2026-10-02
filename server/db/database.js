import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Open (or create) a SQLite database. Pass `:memory:` for tests.
 * Foreign keys are enabled so `ON DELETE CASCADE` in migrations applies.
 */
export function openDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/**
 * Apply every pending migration in lexical order. Each migration runs in its
 * own transaction; applied names are recorded in `schema_migrations`, so the
 * runner is idempotent.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string[]} names of migrations applied by this call
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );
  const newlyApplied = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN;');
    try {
      db.exec(sql);
      insertMigration.run(file, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
    newlyApplied.push(file);
  }

  return newlyApplied;
}

/**
 * Default database location for non-test environments: `<repo>/data/nexus.sqlite`.
 */
export function defaultDatabasePath() {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'nexus.sqlite');
}
