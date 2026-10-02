import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createSession } from '../helpers/app.js';

const KEY_A = 'owner-key-a';
const KEY_B = 'owner-key-b';

describe('session ownership API', () => {
  let app;

  before(async () => {
    app = await startTestApp({ steps: [] });
  });

  after(async () => {
    await app.close();
  });

  test('POST /api/sessions requires an API key', async () => {
    const response = await fetch(`${app.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.match(body.error, /X-API-Key/);
  });

  test('creates a session for the caller', async () => {
    const response = await createSession(app.baseUrl, KEY_A, 'My session');
    assert.equal(response.status, 201);
    const { session } = await response.json();
    assert.ok(session.id);
    assert.equal(session.title, 'My session');
    assert.ok(session.created_at);
    assert.ok(session.api_key_hash, 'hash is stored');
    assert.notEqual(session.api_key_hash, KEY_A, 'raw key never stored');
  });

  test('rejects invalid titles', async () => {
    for (const title of ['', '   ', 'x'.repeat(201), 42]) {
      const response = await fetch(`${app.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'x-api-key': KEY_A, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      assert.equal(response.status, 400, `title=${JSON.stringify(title)}`);
    }
  });

  test('owner can read their session; others get 403', async () => {
    const created = await (await createSession(app.baseUrl, KEY_A)).json();

    const owned = await fetch(`${app.baseUrl}/api/sessions/${created.session.id}`, {
      headers: { 'x-api-key': KEY_A },
    });
    assert.equal(owned.status, 200);
    const ownedBody = await owned.json();
    assert.equal(ownedBody.session.id, created.session.id);
    assert.ok(Array.isArray(ownedBody.runs));

    const foreign = await fetch(`${app.baseUrl}/api/sessions/${created.session.id}`, {
      headers: { 'x-api-key': KEY_B },
    });
    assert.equal(foreign.status, 403);
  });

  test('unknown session ids return 404 regardless of key', async () => {
    const response = await fetch(`${app.baseUrl}/api/sessions/00000000-0000-4000-8000-000000000000`, {
      headers: { 'x-api-key': KEY_A },
    });
    assert.equal(response.status, 404);
  });

  test('GET /api/sessions lists only the caller sessions', async () => {
    const responseA = await fetch(`${app.baseUrl}/api/sessions`, {
      headers: { 'x-api-key': KEY_A },
    });
    const { sessions: sessionsA } = await responseA.json();
    assert.ok(sessionsA.length >= 2);

    const responseB = await fetch(`${app.baseUrl}/api/sessions`, {
      headers: { 'x-api-key': KEY_B },
    });
    const { sessions: sessionsB } = await responseB.json();
    assert.equal(sessionsB.length, 0);

    const idsA = new Set(sessionsA.map((s) => s.id));
    for (const session of sessionsB) {
      assert.equal(idsA.has(session.id), false);
    }
  });
});
