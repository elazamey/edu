import { once } from 'node:events';
import { loadConfig } from '../../server/config.js';
import { openDatabase, runMigrations } from '../../server/db/database.js';
import { SessionRepository } from '../../server/repositories/sessionRepository.js';
import { RunRepository } from '../../server/repositories/runRepository.js';
import { ExecutionService } from '../../server/services/executionService.js';
import { createApp } from '../../server/app.js';
import { createFakeAdapterFactory } from './fakeAdapter.js';

export const VALID_LLM_ENV = {
  LLM_PROVIDER: 'openai',
  LLM_API_KEY: 'test-api-key',
  LLM_MODEL: 'test-model',
};

/**
 * Boot the app against an in-memory database with rate limiting disabled.
 * By default a fake adapter streams the provided `steps`; pass
 * `adapterFactory` to inject something else (e.g. a real adapter with a
 * mocked fetch).
 */
export async function startTestApp({ steps, adapterFactory, llmEnv = VALID_LLM_ENV, timeoutMs } = {}) {
  const env = timeoutMs !== undefined ? { ...llmEnv, LLM_TIMEOUT_MS: String(timeoutMs) } : llmEnv;
  const config = loadConfig(env);

  const db = openDatabase(':memory:');
  runMigrations(db);

  const sessionRepository = new SessionRepository(db);
  const runRepository = new RunRepository(db);
  const executionService = new ExecutionService({
    runRepository,
    createAdapter: adapterFactory ?? createFakeAdapterFactory({ steps }),
    llmConfig: config.llm.available ? config.llm : null,
  });

  const app = createApp({
    config,
    sessionRepository,
    runRepository,
    executionService,
    rateLimit: false,
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    config,
    executionService,
    sessionRepository,
    runRepository,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

export async function createSession(baseUrl, apiKey, title = 'Test session') {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return response;
}

export async function fetchRun(baseUrl, apiKey, runId) {
  const response = await fetch(`${baseUrl}/api/runs/${runId}`, {
    headers: { 'x-api-key': apiKey },
  });
  return response;
}
