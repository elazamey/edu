import dotenv from 'dotenv';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase, runMigrations, defaultDatabasePath } from './db/database.js';
import { SessionRepository } from './repositories/sessionRepository.js';
import { RunRepository } from './repositories/runRepository.js';
import { ExecutionService } from './services/executionService.js';
import { createAdapter } from './llm/index.js';
import { createApp } from './app.js';

dotenv.config();

const config = loadConfig(process.env);
if (config.llm.available) {
  console.log(`LLM configured: provider=${config.llm.provider} model=${config.llm.model}`);
} else {
  console.warn('LLM is not configured; execution endpoints will return 503 until fixed:');
  for (const problem of config.errors) console.warn(`  - ${problem}`);
}

const databasePath = process.env.DATABASE_PATH || defaultDatabasePath();
if (databasePath !== ':memory:') {
  mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
}
const db = openDatabase(databasePath);
const applied = runMigrations(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(', ')}`);

const sessionRepository = new SessionRepository(db);
const runRepository = new RunRepository(db);
const executionService = new ExecutionService({
  runRepository,
  createAdapter: () => createAdapter(config.llm),
  llmConfig: config.llm.available ? config.llm : null,
});

const app = createApp({
  config,
  sessionRepository,
  runRepository,
  executionService,
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexus server running on port ${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
