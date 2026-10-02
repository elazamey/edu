import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const DEFAULT_AGENTS = [
  {
    id: 'agent-researcher',
    name: 'Nexus Researcher',
    role: 'محلل أبحاث ومعرفة',
    specialty: 'تحليل المتطلبات وتلخيص المصادر وبناء خطط العمل المعرفية.',
    status: 'idle',
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'agent-architect',
    name: 'Nexus Architect',
    role: 'مهندس برمجيات ونظم',
    specialty: 'تصميم المسارات البرمجية، مراجعة الكود، وتحسين البنية المعمارية.',
    status: 'idle',
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'agent-guardian',
    name: 'Nexus Guardian',
    role: 'مدقق أمان وجودة',
    specialty: 'فحص الثغرات، التحقق من الصلاحيات، وضمان جاهزية الاختبارات.',
    status: 'idle',
    createdAt: '2026-10-02T00:00:00.000Z',
  },
];

const DEFAULT_TASKS = [
  {
    id: 'task-welcome-1',
    title: 'فحص جاهزية منصة Nexus',
    description: 'التحقق من حالة الخادم وقاعدة البيانات ومسارات الوكلاء.',
    agentId: 'agent-guardian',
    priority: 'high',
    status: 'completed',
    output: 'تم التحقق من استقرار الخادم، تفعيل طبقة التخزين، وجاهزية الوكلاء الثلاثة للعمل.',
    createdBy: 'system',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
];

function createInitialState() {
  return {
    meta: {
      version: 1,
      engine: 'json-file',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    users: [],
    sessions: [],
    agents: structuredClone(DEFAULT_AGENTS),
    tasks: structuredClone(DEFAULT_TASKS),
    messages: [],
  };
}

export class NexusStore {
  constructor(customFilePath) {
    this.filePath = customFilePath
      ? path.resolve(customFilePath)
      : path.resolve(process.env.DATABASE_PATH || path.join(ROOT_DIR, 'data', 'nexus-db.json'));
    this.state = null;
    this.ensureLoaded();
  }

  ensureLoaded() {
    if (this.state) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          meta: parsed.meta || {
            version: 1,
            engine: 'json-file',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          users: Array.isArray(parsed.users) ? parsed.users : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          agents: Array.isArray(parsed.agents) && parsed.agents.length > 0
            ? parsed.agents
            : structuredClone(DEFAULT_AGENTS),
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : structuredClone(DEFAULT_TASKS),
          messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        };
        return;
      } catch {
        this.state = createInitialState();
        this.persist();
        return;
      }
    }

    this.state = createInitialState();
    this.persist();
  }

  persist() {
    this.state.meta.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempFile = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, this.filePath);
  }

  reset() {
    this.state = createInitialState();
    this.persist();
    return this.getStatus();
  }

  getStatus() {
    this.ensureLoaded();
    this.pruneExpiredSessions();
    return {
      status: 'connected',
      engine: this.state.meta.engine || 'json-file',
      updatedAt: this.state.meta.updatedAt,
      counts: {
        users: this.state.users.length,
        sessions: this.state.sessions.length,
        agents: this.state.agents.length,
        tasks: this.state.tasks.length,
        messages: this.state.messages.length,
      },
    };
  }

  // Users
  findUserByUsername(username) {
    this.ensureLoaded();
    const normalized = String(username || '').trim().toLowerCase();
    return this.state.users.find(u => u.username.toLowerCase() === normalized) || null;
  }

  findUserById(id) {
    this.ensureLoaded();
    return this.state.users.find(u => u.id === id) || null;
  }

  createUser({ username, displayName, passwordHash, salt, provider = 'local', role = 'operator' }) {
    this.ensureLoaded();
    const user = {
      id: `user-${crypto.randomUUID()}`,
      username: String(username).trim().toLowerCase(),
      displayName: String(displayName || username).trim(),
      role,
      provider,
      passwordHash: passwordHash || null,
      salt: salt || null,
      createdAt: new Date().toISOString(),
    };
    this.state.users.push(user);
    this.persist();
    return this.sanitizeUser(user);
  }

  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      provider: user.provider,
      createdAt: user.createdAt,
    };
  }

  // Sessions
  pruneExpiredSessions() {
    this.ensureLoaded();
    const now = Date.now();
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
    if (this.state.sessions.length !== before) {
      this.persist();
    }
  }

  createSession({ tokenHash, userId, expiresAt }) {
    this.ensureLoaded();
    this.pruneExpiredSessions();
    const session = {
      id: `sess-${crypto.randomUUID()}`,
      tokenHash,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt,
    };
    this.state.sessions.push(session);
    this.persist();
    return session;
  }

  findSessionByTokenHash(tokenHash) {
    this.ensureLoaded();
    this.pruneExpiredSessions();
    return this.state.sessions.find(s => s.tokenHash === tokenHash) || null;
  }

  deleteSessionByTokenHash(tokenHash) {
    this.ensureLoaded();
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter(s => s.tokenHash !== tokenHash);
    if (this.state.sessions.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  // Agents
  listAgents() {
    this.ensureLoaded();
    return [...this.state.agents];
  }

  findAgentById(id) {
    this.ensureLoaded();
    return this.state.agents.find(a => a.id === id) || null;
  }

  createAgent({ name, role, specialty }) {
    this.ensureLoaded();
    const agent = {
      id: `agent-${crypto.randomUUID().slice(0, 8)}`,
      name: String(name).trim(),
      role: String(role).trim(),
      specialty: String(specialty).trim(),
      status: 'idle',
      createdAt: new Date().toISOString(),
    };
    this.state.agents.push(agent);
    this.persist();
    return agent;
  }

  // Tasks
  listTasks({ status, agentId } = {}) {
    this.ensureLoaded();
    return this.state.tasks.filter(task => {
      if (status && task.status !== status) return false;
      if (agentId && task.agentId !== agentId) return false;
      return true;
    });
  }

  findTaskById(id) {
    this.ensureLoaded();
    return this.state.tasks.find(t => t.id === id) || null;
  }

  createTask({ title, description, agentId, priority = 'medium', createdBy = 'operator' }) {
    this.ensureLoaded();
    const now = new Date().toISOString();
    const task = {
      id: `task-${crypto.randomUUID().slice(0, 8)}`,
      title: String(title).trim(),
      description: String(description || '').trim(),
      agentId,
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
      status: 'pending',
      output: null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.state.tasks.unshift(task);
    this.persist();
    return task;
  }

  updateTask(id, patch) {
    this.ensureLoaded();
    const task = this.findTaskById(id);
    if (!task) return null;

    if (patch.title !== undefined) task.title = String(patch.title).trim();
    if (patch.description !== undefined) task.description = String(patch.description).trim();
    if (patch.status && ['pending', 'in_progress', 'completed'].includes(patch.status)) {
      task.status = patch.status;
    }
    if (patch.priority && ['low', 'medium', 'high'].includes(patch.priority)) {
      task.priority = patch.priority;
    }
    if (patch.output !== undefined) {
      task.output = patch.output;
    }
    task.updatedAt = new Date().toISOString();
    this.persist();
    return task;
  }

  deleteTask(id) {
    this.ensureLoaded();
    const index = this.state.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;
    this.state.tasks.splice(index, 1);
    this.persist();
    return true;
  }

  // Messages / Conversations
  listMessages({ agentId, limit = 50 } = {}) {
    this.ensureLoaded();
    let list = this.state.messages;
    if (agentId) {
      list = list.filter(m => m.agentId === agentId);
    }
    return list.slice(-Math.max(1, Math.min(limit, 200)));
  }

  createMessage({ agentId, sender, authorName, content, replyTo = null }) {
    this.ensureLoaded();
    const message = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      agentId,
      sender,
      authorName,
      content: String(content).trim(),
      replyTo,
      createdAt: new Date().toISOString(),
    };
    this.state.messages.push(message);
    this.persist();
    return message;
  }
}

export const store = new NexusStore();
