import { Router } from 'express';
import { hashApiKey } from '../repositories/sessionRepository.js';
import { extractApiKey, requireApiKey } from './sessions.js';
import {
  initSSE,
  sendSSE,
  closeSSE,
  startHeartbeat,
  stopHeartbeat,
} from '../sse.js';

const MAX_PROMPT_LENGTH = 20_000;

function sessionOwnershipResponse(res, sessionRepository, sessionId, apiKeyHash) {
  const session = sessionRepository.findById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  if (session.api_key_hash !== apiKeyHash) {
    res.status(403).json({ error: 'You do not own this session' });
    return null;
  }
  return session;
}

function runOwnershipResponse(res, runRepository, runId, apiKeyHash) {
  // Run ids are random UUIDs, so distinguishing 403 from 404 is safe and
  // gives API consumers actionable errors.
  const run = runRepository.findById(runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return null;
  }
  const owned = runRepository.findByIdForOwner(runId, apiKeyHash);
  if (!owned) {
    res.status(403).json({ error: 'You do not own this run' });
    return null;
  }
  return owned;
}

export function createRunRoutes({
  sessionRepository,
  runRepository,
  executionService,
  config,
}) {
  const router = Router();

  // Execute the agent: streams run events over SSE until a terminal state.
  router.post('/sessions/:sessionId/runs', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;

    const session = sessionOwnershipResponse(
      res,
      sessionRepository,
      req.params.sessionId,
      hashApiKey(apiKey),
    );
    if (!session) return;

    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt must be a non-empty string' });
      return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      res.status(400).json({ error: `prompt must be at most ${MAX_PROMPT_LENGTH} characters` });
      return;
    }

    if (!config?.llm?.available) {
      res.status(503).json({
        error: 'LLM provider is not configured',
        details: config?.errors ?? [],
      });
      return;
    }

    const { run, events } = executionService.start({ session, prompt });
    initSSE(res);
    const heartbeat = startHeartbeat(res);
    let finalized = false;

    const onClientDisconnect = () => {
      if (!finalized) executionService.abort(run.id);
    };
    res.on('close', onClientDisconnect);

    (async () => {
      try {
        for await (const { event, data } of events) {
          if (event.startsWith('run.') && event !== 'run.delta' && event !== 'run.started') {
            finalized = true;
          }
          sendSSE(res, event, data);
        }
      } catch {
        // The generator itself never throws today; guard the socket anyway.
        if (!finalized) {
          executionService.abort(run.id);
        }
      } finally {
        finalized = true;
        stopHeartbeat(heartbeat);
        res.removeListener('close', onClientDisconnect);
        closeSSE(res);
      }
    })();
  });

  router.get('/runs/:runId', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const run = runOwnershipResponse(res, runRepository, req.params.runId, hashApiKey(apiKey));
    if (!run) return;
    res.json({ run });
  });

  router.post('/runs/:runId/abort', (req, res) => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Missing X-API-Key header' });
      return;
    }
    const run = runOwnershipResponse(res, runRepository, req.params.runId, hashApiKey(apiKey));
    if (!run) return;
    const aborted = executionService.abort(run.id);
    if (!aborted) {
      res.status(409).json({ error: 'Run is not active', run: runRepository.findById(run.id) });
      return;
    }
    res.json({ message: 'Abort requested', run: runRepository.findById(run.id) });
  });

  return router;
}
