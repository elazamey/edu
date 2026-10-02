import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAuthRoutes } from './auth.js';
import { config } from './config.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.join(__dirname, '..', 'public');

app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDirectory));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Nexus Agent Platform' });
});

const authRouter = express.Router();
registerAuthRoutes(authRouter);
app.use('/api/auth', authRouter);

app.use((error, req, res, next) => {
  logger.error('Unhandled request error', { method: req.method, path: req.path, error: error.message });
  if (res.headersSent) return next(error);
  res.status(error.statusCode || 500).json({ error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, '0.0.0.0', () => {
    logger.info('Nexus server started', { port: config.port, environment: process.env.NODE_ENV || 'development' });
  });
}

export default app;
