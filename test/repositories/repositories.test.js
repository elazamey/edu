import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runMigrations } from '../../server/db/database.js';
import { SessionRepository, hashApiKey } from '../../server/repositories/sessionRepository.js';
import { RunRepository, TERMINAL_RUN_STATUSES } from '../../server/repositories/runRepository.js';

describe('migrations', () => {
  test('apply in order and are idempotent', () => {
    const db = openDatabase(':memory:');
    const first = runMigrations(db);
    assert.deepEqual(first, ['001_sessions.sql', '002_agent_runs.sql']);

    const second = runMigrations(db);
    assert.deepEqual(second, []);

    const applied = db
      .prepare('SELECT name FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => row.name);
    assert.deepEqual(applied, ['001_sessions.sql', '002_agent_runs.sql']);
    db.close();
  });

  test('agent_runs enforces its status check constraint', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO agent_runs (id, session_id, status, prompt, started_at) VALUES ('r', 's', 'exploded', 'p', 'now')",
        )
        .run(),
    );
    db.close();
  });
});

describe('SessionRepository', () => {
  let db;
  let sessions;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    sessions = new SessionRepository(db);
  });

  test('create + findById roundtrip', () => {
    const session = sessions.create({ apiKeyHash: hashApiKey('key-a'), title: 'Hello' });
    assert.ok(session.id);
    assert.equal(session.title, 'Hello');
    assert.deepEqual(sessions.findById(session.id), session);
  });

  test('ownership helpers scope access to the key hash', () => {
    const session = sessions.create({ apiKeyHash: hashApiKey('owner') });
    assert.ok(sessions.isOwnedBy(session.id, hashApiKey('owner')));
    assert.equal(sessions.isOwnedBy(session.id, hashApiKey('intruder')), false);
    assert.equal(sessions.findByIdForOwner(session.id, hashApiKey('intruder')), null);
    assert.ok(sessions.findByIdForOwner(session.id, hashApiKey('owner')));
  });

  test('listForOwner returns only owned sessions', () => {
    sessions.create({ apiKeyHash: hashApiKey('a') });
    sessions.create({ apiKeyHash: hashApiKey('a') });
    sessions.create({ apiKeyHash: hashApiKey('b') });
    assert.equal(sessions.listForOwner(hashApiKey('a')).length, 2);
    assert.equal(sessions.listForOwner(hashApiKey('b')).length, 1);
    assert.equal(sessions.listForOwner(hashApiKey('nobody')).length, 0);
  });

  test('deleting a session cascades to its agent runs', () => {
    const runs = new RunRepository(db);
    const session = sessions.create({ apiKeyHash: hashApiKey('a') });
    const run = runs.create({ sessionId: session.id, prompt: 'hello' });
    assert.ok(runs.findById(run.id));

    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    assert.equal(runs.findById(run.id), null);
  });
});

describe('RunRepository', () => {
  let db;
  let sessions;
  let runs;
  let session;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    sessions = new SessionRepository(db);
    runs = new RunRepository(db);
    session = sessions.create({ apiKeyHash: hashApiKey('owner-key') });
  });

  test('create inserts a running run with session context', () => {
    const run = runs.create({
      sessionId: session.id,
      prompt: 'say hi',
      provider: 'openai',
      model: 'gpt-test',
    });
    assert.equal(run.status, 'running');
    assert.equal(run.sessionId, session.id);
    assert.equal(run.prompt, 'say hi');
    assert.equal(run.provider, 'openai');
    assert.equal(run.output, null);
    assert.equal(run.finishedAt, null);
  });

  test('finish transitions a running run to a terminal state', () => {
    const run = runs.create({ sessionId: session.id, prompt: 'p' });
    const finished = runs.finish(run.id, {
      status: 'completed',
      output: 'result text',
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
    assert.equal(finished.status, 'completed');
    assert.equal(finished.output, 'result text');
    assert.deepEqual(finished.usage, { prompt_tokens: 1, completion_tokens: 2 });
    assert.ok(finished.finishedAt);
    assert.equal(typeof finished.durationMs, 'number');
  });

  test('finish records error details for failed runs', () => {
    const run = runs.create({ sessionId: session.id, prompt: 'p' });
    const finished = runs.finish(run.id, { status: 'failed', error: 'provider exploded' });
    assert.equal(finished.status, 'failed');
    assert.equal(finished.error, 'provider exploded');
  });

  test('finish refuses non-terminal statuses', () => {
    const run = runs.create({ sessionId: session.id, prompt: 'p' });
    assert.throws(() => runs.finish(run.id, { status: 'running' }), /Invalid terminal/);
  });

  test('finish is a no-op once the run is terminal', () => {
    const run = runs.create({ sessionId: session.id, prompt: 'p' });
    runs.finish(run.id, { status: 'aborted' });
    const again = runs.finish(run.id, { status: 'completed', output: 'late' });
    assert.equal(again, null);
    assert.equal(runs.findById(run.id).status, 'aborted');
  });

  test('findByIdForOwner enforces session ownership', () => {
    const run = runs.create({ sessionId: session.id, prompt: 'p' });
    assert.ok(runs.findByIdForOwner(run.id, hashApiKey('owner-key')));
    assert.equal(runs.findByIdForOwner(run.id, hashApiKey('someone-else')), null);
    assert.equal(runs.findByIdForOwner('no-such-run', hashApiKey('owner-key')), null);
  });

  test('listForSession returns newest first', () => {
    const first = runs.create({ sessionId: session.id, prompt: 'first' });
    const second = runs.create({ sessionId: session.id, prompt: 'second' });
    runs.finish(first.id, { status: 'completed', output: 'a' });
    const list = runs.listForSession(session.id);
    assert.deepEqual(list.map((run) => run.prompt), ['second', 'first']);
    assert.equal(list[1].status, 'completed');
    assert.equal(second.status, 'running');
  });

  test('every terminal status is persistable', () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      const run = runs.create({ sessionId: session.id, prompt: status });
      assert.equal(runs.finish(run.id, { status }).status, status);
    }
  });
});
