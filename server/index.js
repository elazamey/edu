import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store as defaultStore } from './store.js';
import {
  assertProductionAuthConfig,
  clearSessionCookie,
  createSessionMiddleware,
  hashPassword,
  isDemoAuthEnabled,
  issueSession,
  requireAuth,
  verifyPassword,
} from './auth.js';
import { executeAgentTask, generateAgentReply } from './agent-engine.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.join(__dirname, '..', 'public');

export function createApp({ storeInstance = defaultStore, env = process.env } = {}) {
  // Fail-closed at startup if NODE_ENV=production without a strong SESSION_SECRET/JWT_SECRET
  assertProductionAuthConfig(env);

  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDirectory));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.NODE_ENV === 'production' ? 200 : 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });

  app.use('/api', apiLimiter);
  app.use(createSessionMiddleware(storeInstance, env));

  // Health & Database Readiness
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Nexus Agent Platform' });
  });

  app.get('/api/db/status', (req, res) => {
    res.json(storeInstance.getStatus());
  });

  // Authentication & Sessions
  app.get('/api/auth/session', (req, res) => {
    res.json({
      authenticated: Boolean(req.user),
      user: req.user || null,
      demoEnabled: isDemoAuthEnabled(env),
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || username).trim();

    if (!username || username.length < 3 || username.length > 32 || !/^[a-z0-9_.-]+$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-32 characters (letters, numbers, ., _, -).',
      });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters.',
      });
    }
    if (storeInstance.findUserByUsername(username)) {
      return res.status(409).json({
        error: 'Username is already registered.',
      });
    }

    const { salt, passwordHash } = hashPassword(password);
    const user = storeInstance.createUser({
      username,
      displayName: displayName || username,
      passwordHash,
      salt,
      provider: 'local',
      role: 'operator',
    });

    issueSession(res, storeInstance, user.id, env);
    return res.status(201).json({
      authenticated: true,
      user,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required.',
      });
    }

    const existing = storeInstance.findUserByUsername(username);
    if (!existing || !verifyPassword(password, existing.salt, existing.passwordHash)) {
      return res.status(401).json({
        error: 'Invalid username or password.',
      });
    }

    const user = storeInstance.sanitizeUser(existing);
    issueSession(res, storeInstance, user.id, env);
    return res.json({
      authenticated: true,
      user,
    });
  });

  app.get('/api/auth/github', (req, res) => {
    const clientId = env.GITHUB_CLIENT_ID || '';
    res.json({
      message: 'GitHub Auth endpoint active',
      oauthImplemented: false,
      configured: Boolean(clientId),
      demoEnabled: isDemoAuthEnabled(env),
      demoEndpoint: isDemoAuthEnabled(env) ? '/api/auth/github/demo' : null,
    });
  });

  app.post('/api/auth/github/demo', (req, res) => {
    if (!isDemoAuthEnabled(env)) {
      return res.status(403).json({
        error: 'Demo authentication is disabled in production.',
      });
    }

    const demoUsername = 'github-operator';
    let existing = storeInstance.findUserByUsername(demoUsername);
    if (!existing) {
      existing = storeInstance.createUser({
        username: demoUsername,
        displayName: 'GitHub Demo Operator',
        provider: 'github-demo',
        role: 'operator',
      });
    } else {
      existing = storeInstance.sanitizeUser(existing);
    }

    issueSession(res, storeInstance, existing.id, env);
    return res.json({
      authenticated: true,
      mode: 'github-demo',
      user: existing,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionTokenHash) {
      storeInstance.deleteSessionByTokenHash(req.sessionTokenHash);
    }
    clearSessionCookie(res);
    res.json({ authenticated: false, user: null });
  });

  // Nexus Agents API
  app.get('/api/agents', (req, res) => {
    res.json({ agents: storeInstance.listAgents() });
  });

  app.post('/api/agents', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || '').trim();
    const specialty = String(req.body?.specialty || '').trim();

    if (!name || !role || !specialty) {
      return res.status(400).json({
        error: 'Agent name, role, and specialty are required.',
      });
    }

    const agent = storeInstance.createAgent({
      name,
      role,
      specialty,
      createdBy: req.user.id,
    });
    return res.status(201).json({ agent });
  });

  // Nexus Tasks API (Protected & Owner-Scoped)
  app.get('/api/tasks', requireAuth, (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    res.json({
      tasks: storeInstance.listTasks({
        ownerId: req.user.id,
        status,
        agentId,
      }),
    });
  });

  app.post('/api/tasks', requireAuth, (req, res) => {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const agentId = String(req.body?.agentId || '').trim();
    const priority = String(req.body?.priority || 'medium').trim();

    if (!title) {
      return res.status(400).json({ error: 'Task title is required.' });
    }
    const agent = storeInstance.findAgentById(agentId);
    if (!agent) {
      return res.status(400).json({ error: 'Valid agentId is required.' });
    }

    const task = storeInstance.createTask({
      title,
      description,
      agentId: agent.id,
      priority,
      ownerId: req.user.id,
      createdBy: req.user.username,
    });
    return res.status(201).json({ task });
  });

  app.post('/api/tasks/:id/run', requireAuth, (req, res) => {
    const task = storeInstance.findTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (task.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this task.' });
    }
    const agent = storeInstance.findAgentById(task.agentId);
    const output = executeAgentTask(agent, task);
    const updated = storeInstance.updateTask(task.id, {
      status: 'completed',
      output,
    });
    return res.json({ task: updated });
  });

  app.patch('/api/tasks/:id', requireAuth, (req, res) => {
    const task = storeInstance.findTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (task.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this task.' });
    }
    const updated = storeInstance.updateTask(req.params.id, req.body || {});
    return res.json({ task: updated });
  });

  app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    const task = storeInstance.findTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (task.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this task.' });
    }
    storeInstance.deleteTask(req.params.id);
    return res.json({ deleted: true, id: req.params.id });
  });

  // Nexus Interactive Chat API (Protected & Owner-Scoped)
  app.get('/api/chat', requireAuth, (req, res) => {
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    res.json({
      messages: storeInstance.listMessages({
        ownerId: req.user.id,
        agentId,
      }),
    });
  });

  app.post('/api/chat', requireAuth, (req, res) => {
    const agentId = String(req.body?.agentId || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!content) {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    const agent = storeInstance.findAgentById(agentId);
    if (!agent) {
      return res.status(400).json({ error: 'Valid agentId is required.' });
    }

    const userMessage = storeInstance.createMessage({
      ownerId: req.user.id,
      agentId: agent.id,
      sender: 'user',
      authorName: req.user.displayName || req.user.username,
      content,
    });

    const replyText = generateAgentReply(agent, content, req.user);
    const agentMessage = storeInstance.createMessage({
      ownerId: req.user.id,
      agentId: agent.id,
      sender: 'agent',
      authorName: agent.name,
      content: replyText,
      replyTo: userMessage.id,
    });

    return res.status(201).json({
      userMessage,
      agentMessage,
    });
  });

  return app;
}

const PORT = process.env.PORT || 3000;
const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === __filename);

let defaultApp = null;
if (isMainModule && process.env.NODE_ENV !== 'test') {
  defaultApp = createApp();
  defaultApp.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexus server running on port ${PORT}`);
  });
}

export default defaultApp || createApp();
