import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, createSession, fetchRun } from '../helpers/app.js';
import { collectUntil, sseEvents, waitFor } from '../helpers/sse.js';
import { createFakeAdapterFactory } from '../helpers/fakeAdapter.js';
import { OpenAICompatibleAdapter } from '../../server/llm/openAiCompatibleAdapter.js';
import { LLMError } from '../../server/llm/errors.js';

const OWNER = 'run-owner-key';
const INTRUDER = 'run-intruder-key';
const TERMINAL_EVENTS = ['run.completed', 'run.failed', 'run.aborted', 'run.timeout'];

async function postRun(baseUrl, apiKey, sessionId, prompt) {
  return fetch(`${baseUrl}/api/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

describe('SSE execution endpoint', () => {
  let app;
  let sessionId;

  before(async () => {
    app = await startTestApp({ steps: [{ delta: 'Hello ' }, { delta: 'world' }] });
    const { session } = await (await createSession(app.baseUrl, OWNER)).json();
    sessionId = session.id;
  });

  after(async () => {
    await app.close();
  });

  test('guards authentication, ownership, and payload shape', async () => {
    const noKey = await fetch(`${app.baseUrl}/api/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    assert.equal(noKey.status, 401);

    const unknownSession = await postRun(app.baseUrl, OWNER, 'missing-id', 'hi');
    assert.equal(unknownSession.status, 404);

    const foreignSession = await postRun(app.baseUrl, INTRUDER, sessionId, 'hi');
    assert.equal(foreignSession.status, 403);

    for (const prompt of [undefined, '', '   ', 123]) {
      const response = await postRun(app.baseUrl, OWNER, sessionId, prompt);
      assert.equal(response.status, 400, `prompt=${JSON.stringify(prompt)}`);
    }

    const tooLong = await postRun(app.baseUrl, OWNER, sessionId, 'x'.repeat(20_001));
    assert.equal(tooLong.status, 400);
  });

  test('streams started → deltas → completed and persists the run', async () => {
    const response = await postRun(app.baseUrl, OWNER, sessionId, 'Say hello');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);

    const { events, terminal } = await collectUntil(response, TERMINAL_EVENTS);
    assert.equal(events[0].event, 'run.started');
    assert.equal(events[0].data.run.status, 'running');

    const deltas = events.filter((e) => e.event === 'run.delta').map((e) => e.data.content);
    assert.deepEqual(deltas, ['Hello ', 'world']);

    assert.equal(terminal.event, 'run.completed');
    const run = terminal.data.run;
    assert.equal(run.status, 'completed');
    assert.equal(run.output, 'Hello world');
    assert.equal(run.prompt, 'Say hello');
    assert.ok(run.usage);
    assert.equal(typeof run.durationMs, 'number');

    // Persisted and visible to the owner only.
    const owned = await fetchRun(app.baseUrl, OWNER, run.id);
    assert.equal(owned.status, 200);
    assert.equal((await owned.json()).run.status, 'completed');

    const foreign = await fetchRun(app.baseUrl, INTRUDER, run.id);
    assert.equal(foreign.status, 403);

    const missing = await fetchRun(app.baseUrl, OWNER, 'no-such-run');
    assert.equal(missing.status, 404);
  });

  test('persists failures from the adapter as failed runs', async () => {
    const failing = await startTestApp({
      steps: [{ delta: 'par' }, { throw: new LLMError('provider exploded', { status: 500 }) }],
    });
    try {
      const { session } = await (await createSession(failing.baseUrl, OWNER)).json();
      const response = await postRun(failing.baseUrl, OWNER, session.id, 'boom');
      const { terminal } = await collectUntil(response, TERMINAL_EVENTS);
      assert.equal(terminal.event, 'run.failed');
      assert.equal(terminal.data.run.status, 'failed');
      assert.match(terminal.data.run.error, /provider exploded/);

      const stored = await (await fetchRun(failing.baseUrl, OWNER, terminal.data.run.id)).json();
      assert.equal(stored.run.status, 'failed');
    } finally {
      await failing.close();
    }
  });

  test('returns 503 with validation details when the LLM is not configured', async () => {
    const unconfigured = await startTestApp({ llmEnv: { LLM_PROVIDER: 'openai' } });
    try {
      assert.equal(unconfigured.config.llm.available, false);
      const { session } = await (await createSession(unconfigured.baseUrl, OWNER)).json();
      const response = await postRun(unconfigured.baseUrl, OWNER, session.id, 'hello');
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /not configured/);
      assert.ok(body.details.some((d) => d.includes('LLM_API_KEY')));
    } finally {
      await unconfigured.close();
    }
  });
});

describe('abort handling', () => {
  let app;
  let sessionId;

  before(async () => {
    app = await startTestApp({ steps: [{ delta: 'start ' }, { hang: true }] });
    const { session } = await (await createSession(app.baseUrl, OWNER)).json();
    sessionId = session.id;
  });

  after(async () => {
    await app.close();
  });

  test('POST /api/runs/:id/abort stops an active run and marks it aborted', async () => {
    const response = await postRun(app.baseUrl, OWNER, sessionId, 'long task');
    const iterator = sseEvents(response)[Symbol.asyncIterator]();

    const started = await iterator.next();
    assert.equal(started.value.event, 'run.started');
    const runId = started.value.data.run.id;

    const delta = await iterator.next();
    assert.equal(delta.value.event, 'run.delta');

    const abortResponse = await fetch(`${app.baseUrl}/api/runs/${runId}/abort`, {
      method: 'POST',
      headers: { 'x-api-key': OWNER },
    });
    assert.equal(abortResponse.status, 200);

    // The stream must terminate with run.aborted.
    let terminal = null;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) break;
      if (TERMINAL_EVENTS.includes(value.event)) {
        terminal = value;
        break;
      }
    }
    assert.equal(terminal.event, 'run.aborted');
    assert.equal(terminal.data.run.status, 'aborted');

    const stored = await (await fetchRun(app.baseUrl, OWNER, runId)).json();
    assert.equal(stored.run.status, 'aborted');
    assert.equal(app.executionService.isActive(runId), false);
  });

  test('abort endpoint enforces ownership and run state', async () => {
    const response = await postRun(app.baseUrl, OWNER, sessionId, 'another long task');
    const iterator = sseEvents(response)[Symbol.asyncIterator]();
    const started = await iterator.next();
    const runId = started.value.data.run.id;

    const foreign = await fetch(`${app.baseUrl}/api/runs/${runId}/abort`, {
      method: 'POST',
      headers: { 'x-api-key': INTRUDER },
    });
    assert.equal(foreign.status, 403);

    const missing = await fetch(`${app.baseUrl}/api/runs/no-such-run/abort`, {
      method: 'POST',
      headers: { 'x-api-key': OWNER },
    });
    assert.equal(missing.status, 404);

    const noKey = await fetch(`${app.baseUrl}/api/runs/${runId}/abort`, { method: 'POST' });
    assert.equal(noKey.status, 401);

    // Clean up: owner aborts, then aborting again reports 409.
    await fetch(`${app.baseUrl}/api/runs/${runId}/abort`, {
      method: 'POST',
      headers: { 'x-api-key': OWNER },
    });
    await waitFor(() => app.runRepository.findById(runId).status === 'aborted', {
      label: 'run marked aborted',
    });
    const again = await fetch(`${app.baseUrl}/api/runs/${runId}/abort`, {
      method: 'POST',
      headers: { 'x-api-key': OWNER },
    });
    assert.equal(again.status, 409);
  });

  test('client disconnect aborts the run', async () => {
    // Simulate a client dropping the connection mid-stream by aborting fetch.
    const client = new AbortController();
    const response = await fetch(`${app.baseUrl}/api/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { 'x-api-key': OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'disconnect me' }),
      signal: client.signal,
    });
    const iterator = sseEvents(response)[Symbol.asyncIterator]();
    const started = await iterator.next();
    const runId = started.value.data.run.id;

    client.abort();
    await iterator.return?.().catch(() => {});

    const stored = await waitFor(
      async () => {
        const body = await (await fetchRun(app.baseUrl, OWNER, runId)).json();
        return body.run.status === 'aborted' ? body.run : null;
      },
      { label: 'run aborted after disconnect' },
    );
    assert.equal(stored.status, 'aborted');
  });
});

describe('timeout handling', () => {
  test('stalled providers time out via the real adapter timeout', async () => {
    // Real adapter + mocked fetch that never responds: the adapter's own
    // AbortSignal.timeout must trip and mark the run as timeout.
    const hangingFetch = (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    const timedOut = await startTestApp({
      timeoutMs: 150,
      adapterFactory: () => ({
        provider: 'openai',
        streamChat: (params) =>
          new OpenAICompatibleAdapter({
            providerName: 'openai',
            apiKey: 'k',
            model: 'm',
            baseUrl: 'https://api.openai.com/v1',
            timeoutMs: 150,
            fetch: hangingFetch,
          }).streamChat(params),
      }),
    });

    try {
      const { session } = await (await createSession(timedOut.baseUrl, OWNER)).json();
      const response = await postRun(timedOut.baseUrl, OWNER, session.id, 'slow provider');
      assert.equal(response.status, 200);
      const { terminal } = await collectUntil(response, TERMINAL_EVENTS);
      assert.equal(terminal.event, 'run.timeout');
      assert.equal(terminal.data.run.status, 'timeout');
      assert.match(terminal.data.run.error, /timed out/i);

      const stored = await (await fetchRun(timedOut.baseUrl, OWNER, terminal.data.run.id)).json();
      assert.equal(stored.run.status, 'timeout');
    } finally {
      await timedOut.close();
    }
  });
});
