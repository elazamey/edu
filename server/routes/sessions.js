import { Router } from 'express';
import { hashApiKey } from '../repositories/sessionRepository.js';

const MAX_TITLE_LENGTH = 200;

/** Placeholder identity: any non-empty X-API-Key acts as the owner token. */
export function extractApiKey(req) {
  const key = req.get('x-api-key');
  return key && key.trim() ? key.trim() : null;
}

export function requireApiKey(req, res) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: 'Missing X-API-Key header' });
    return null;
  }
  return apiKey;
}

export function createSessionRoutes({ sessionRepository, runRepository }) {
  const router = Router();

  router.post('/', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const title = req.body?.title;
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH)) {
      res.status(400).json({ error: `title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters` });
      return;
    }
    const session = sessionRepository.create({
      apiKeyHash: hashApiKey(apiKey),
      title: title?.trim() || 'New session',
    });
    res.status(201).json({ session });
  });

  router.get('/', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const sessions = sessionRepository.listForOwner(hashApiKey(apiKey));
    res.json({ sessions });
  });

  router.get('/:sessionId', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { sessionId } = req.params;
    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.api_key_hash !== hashApiKey(apiKey)) {
      res.status(403).json({ error: 'You do not own this session' });
      return;
    }
    const runs = runRepository.listForSession(sessionId);
    res.json({ session, runs });
  });

  return router;
}
