import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionRoutes } from './routes/sessions.js';
import { createRunRoutes } from './routes/runs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express app. All collaborators are injected so tests can wire in
 * in-memory databases and scripted adapters.
 *
 * @param {object} deps
 * @param {{ llm: object, errors: string[] }} deps.config
 * @param {object} deps.sessionRepository
 * @param {object} deps.runRepository
 * @param {object} deps.executionService
 * @param {boolean} [deps.rateLimit] Disable per-IP rate limiting in tests.
 * @param {string} [deps.publicDir]
 */
export function createApp({
  config,
  sessionRepository,
  runRepository,
  executionService,
  rateLimit: enableRateLimit = true,
  publicDir = path.join(__dirname, '..', 'public'),
} = {}) {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDir));

  if (enableRateLimit) {
    app.use(
      '/api',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 100,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many requests. Please try again later.' },
      }),
    );
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Nexus Agent Platform' });
  });

  // Placeholder only: no OAuth flow or user authentication is implemented yet.
  app.get('/api/auth/github', (req, res) => {
    res.json({ message: 'GitHub Auth endpoint active' });
  });

  app.use('/api/sessions', createSessionRoutes({ sessionRepository, runRepository }));
  app.use('/api', createRunRoutes({ sessionRepository, runRepository, executionService, config }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message });
  });

  return app;
}
