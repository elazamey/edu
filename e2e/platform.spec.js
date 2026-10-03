import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/index.js';
import { NexusStore, StoreCorruptionError } from '../server/store.js';

function listenAsync(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(res => server.close(res)),
      });
    });
    server.on('error', reject);
  });
}

test.describe('Stage 4, 4.1 & 5: Hardened Auth, Multi-User Isolation, Durability, Free-Only AI Gateway, and UI', () => {
  test('Database status and seeded agents endpoints respond correctly', async ({ request }) => {
    const dbRes = await request.get('/api/db/status');
    expect(dbRes.ok()).toBeTruthy();
    const dbData = await dbRes.json();
    expect(dbData.status).toBe('connected');
    expect(dbData.engine).toBe('json-file');
    expect(dbData.counts.agents).toBeGreaterThanOrEqual(3);

    const agentsRes = await request.get('/api/agents');
    expect(agentsRes.ok()).toBeTruthy();
    const { agents } = await agentsRes.json();
    expect(agents.length).toBeGreaterThanOrEqual(3);
    expect(agents.some(a => a.id === 'agent-researcher')).toBe(true);
  });

  test('Protected GET and mutation endpoints reject unauthenticated requests with 401', async ({ request }) => {
    const getTasksRes = await request.get('/api/tasks');
    expect(getTasksRes.status()).toBe(401);

    const getChatRes = await request.get('/api/chat');
    expect(getChatRes.status()).toBe(401);

    const postTaskRes = await request.post('/api/tasks', {
      data: { title: 'Unauthorized task', agentId: 'agent-researcher' },
    });
    expect(postTaskRes.status()).toBe(401);

    const postChatRes = await request.post('/api/chat', {
      data: { agentId: 'agent-researcher', content: 'Hello' },
    });
    expect(postChatRes.status()).toBe(401);

    const postAgentRes = await request.post('/api/agents', {
      data: { name: 'Bot', role: 'Role', specialty: 'Spec' },
    });
    expect(postAgentRes.status()).toBe(401);
  });

  test('Multi-user isolation: User B cannot view, approve, run, modify, or delete User A tasks or chats', async ({ playwright, baseURL }) => {
    const contextA = await playwright.request.newContext({ baseURL });
    const contextB = await playwright.request.newContext({ baseURL });

    const userA = `user_a_${Date.now()}`;
    const userB = `user_b_${Date.now()}`;

    const regA = await contextA.post('/api/auth/register', {
      data: { username: userA, displayName: 'Operator A', password: 'PasswordA123!' },
    });
    expect(regA.status()).toBe(201);

    const regB = await contextB.post('/api/auth/register', {
      data: { username: userB, displayName: 'Operator B', password: 'PasswordB123!' },
    });
    expect(regB.status()).toBe(201);

    // User A creates a private task and chat message
    const createTaskA = await contextA.post('/api/tasks', {
      data: {
        title: `Secret Task of ${userA}`,
        description: 'Confidential operation',
        agentId: 'agent-guardian',
        priority: 'high',
      },
    });
    expect(createTaskA.status()).toBe(201);
    const { task: taskA } = await createTaskA.json();

    const chatA = await contextA.post('/api/chat', {
      data: {
        agentId: 'agent-guardian',
        content: `Private prompt from ${userA}`,
      },
    });
    expect(chatA.status()).toBe(201);

    // User B lists tasks and chats: should NOT see User A's data
    const listTasksB = await contextB.get('/api/tasks');
    expect(listTasksB.ok()).toBeTruthy();
    const { tasks: tasksVisibleToB } = await listTasksB.json();
    expect(tasksVisibleToB.some(t => t.id === taskA.id)).toBe(false);

    const listChatB = await contextB.get('/api/chat');
    expect(listChatB.ok()).toBeTruthy();
    const { messages: chatsVisibleToB } = await listChatB.json();
    expect(chatsVisibleToB.some(m => m.content.includes(userA))).toBe(false);

    // User B tries to approve, run, patch, or delete User A's task -> 403 Forbidden
    const approveByB = await contextB.post(`/api/tasks/${taskA.id}/approve`);
    expect(approveByB.status()).toBe(403);

    const runByB = await contextB.post(`/api/tasks/${taskA.id}/run`);
    expect(runByB.status()).toBe(403);

    const patchByB = await contextB.patch(`/api/tasks/${taskA.id}`, {
      data: { title: 'Hijacked title' },
    });
    expect(patchByB.status()).toBe(403);

    const deleteByB = await contextB.delete(`/api/tasks/${taskA.id}`);
    expect(deleteByB.status()).toBe(403);

    // User A approves, runs, and deletes their own task
    const approveByA = await contextA.post(`/api/tasks/${taskA.id}/approve`);
    expect(approveByA.ok()).toBeTruthy();

    const runByA = await contextA.post(`/api/tasks/${taskA.id}/run`);
    expect(runByA.ok()).toBeTruthy();
    const { task: completedA } = await runByA.json();
    expect(completedA.status).toBe('completed');

    const deleteByA = await contextA.delete(`/api/tasks/${taskA.id}`);
    expect(deleteByA.ok()).toBeTruthy();

    await contextA.dispose();
    await contextB.dispose();
  });

  test('Production hardening: fail-closed on missing secret and demo auth disabled in production', async ({ playwright }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prod-test-'));
    const dbPath = path.join(tmpDir, 'prod-db.json');
    const tempStore = new NexusStore(dbPath);

    // 1. Missing secret in production must throw immediately (fail-closed)
    expect(() =>
      createApp({
        storeInstance: tempStore,
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(/FATAL: SESSION_SECRET or JWT_SECRET/);

    // 2. Weak/short secret in production must also throw
    expect(() =>
      createApp({
        storeInstance: tempStore,
        env: { NODE_ENV: 'production', SESSION_SECRET: 'too-short' },
      }),
    ).toThrow(/FATAL: SESSION_SECRET or JWT_SECRET/);

    // 3. Valid secret in production starts cleanly and disables demo auth
    const prodApp = createApp({
      storeInstance: tempStore,
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: 'prod-secret-with-at-least-32-bytes-of-entropy-123456',
        ENABLE_DEMO_AUTH: 'true',
      },
    });

    const instance = await listenAsync(prodApp);
    const prodClient = await playwright.request.newContext({ baseURL: instance.url });

    try {
      const demoRes = await prodClient.post('/api/auth/github/demo');
      expect(demoRes.status()).toBe(403);

      const sessionRes = await prodClient.get('/api/auth/session');
      expect(sessionRes.ok()).toBeTruthy();
      const sessionData = await sessionRes.json();
      expect(sessionData.demoEnabled).toBe(false);
    } finally {
      await prodClient.dispose();
      await instance.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Durability across server restarts and fail-closed on JSON corruption with quarantine backup', async ({ playwright }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-durability-'));
    const dbPath = path.join(tmpDir, 'durable-db.json');
    const testEnv = {
      NODE_ENV: 'test',
      SESSION_SECRET: 'durable-test-secret-with-more-than-32-characters-ok',
    };

    try {
      // Phase 1: Start Server 1, write user, agent, task, and chat message
      const store1 = new NexusStore(dbPath);
      const server1 = await listenAsync(createApp({ storeInstance: store1, env: testEnv }));
      const client1 = await playwright.request.newContext({ baseURL: server1.url });

      const regRes = await client1.post('/api/auth/register', {
        data: { username: 'durable_user', displayName: 'Durable User', password: 'Password123!' },
      });
      expect(regRes.status()).toBe(201);
      const setCookieHeader = regRes.headers()['set-cookie'];
      expect(setCookieHeader).toBeTruthy();
      const sessionCookie = setCookieHeader.split(';')[0];

      const agentRes = await client1.post('/api/agents', {
        data: { name: 'Persistent Agent', role: 'Archivist', specialty: 'Disk durability' },
      });
      expect(agentRes.status()).toBe(201);
      const { agent } = await agentRes.json();

      const taskRes = await client1.post('/api/tasks', {
        data: { title: 'Survive Restart Task', description: 'Must persist on disk', agentId: agent.id },
      });
      expect(taskRes.status()).toBe(201);
      const { task } = await taskRes.json();

      const chatRes = await client1.post('/api/chat', {
        data: { agentId: agent.id, content: 'Remember this across restarts' },
      });
      expect(chatRes.status()).toBe(201);

      await client1.dispose();
      await server1.close();

      // Phase 2: Instantiate a brand-new NexusStore and Server 2 from the same file on disk
      const store2 = new NexusStore(dbPath);
      const server2 = await listenAsync(createApp({ storeInstance: store2, env: testEnv }));
      const client2 = await playwright.request.newContext({
        baseURL: server2.url,
        extraHTTPHeaders: { Cookie: sessionCookie },
      });

      const sessAfterRestart = await client2.get('/api/auth/session');
      expect(sessAfterRestart.ok()).toBeTruthy();
      const sessData = await sessAfterRestart.json();
      expect(sessData.authenticated).toBe(true);
      expect(sessData.user.username).toBe('durable_user');

      const tasksAfterRestart = await client2.get('/api/tasks');
      const { tasks } = await tasksAfterRestart.json();
      expect(tasks.some(t => t.id === task.id && t.title === 'Survive Restart Task')).toBe(true);

      const chatAfterRestart = await client2.get('/api/chat');
      const { messages } = await chatAfterRestart.json();
      expect(messages.some(m => m.content === 'Remember this across restarts')).toBe(true);

      await client2.dispose();
      await server2.close();

      // Phase 3: Corrupt the JSON file and verify fail-closed + quarantine backup
      const corruptPath = path.join(tmpDir, 'corrupt-db.json');
      const brokenPayload = '{"meta": {"version": 1}, "users": [BROKEN_JSON';
      fs.writeFileSync(corruptPath, brokenPayload, 'utf8');

      let caughtError = null;
      try {
        new NexusStore(corruptPath);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(StoreCorruptionError);
      expect(fs.readFileSync(corruptPath, 'utf8')).toBe(brokenPayload);
      expect(caughtError.quarantinePath).toBeTruthy();
      expect(fs.existsSync(caughtError.quarantinePath)).toBe(true);
      expect(fs.readFileSync(caughtError.quarantinePath, 'utf8')).toBe(brokenPayload);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Stage 5: Free-Only Policy, 5-Gate Provider Lock, Approval Gate, and Evidence Proof', async ({ playwright }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-stage5-'));
    const dbPath = path.join(tmpDir, 'stage5-db.json');
    const tempStore = new NexusStore(dbPath);

    // 1. Fail-closed zero-spend policy assertions at startup
    expect(() =>
      createApp({ storeInstance: tempStore, env: { AI_ACCESS_MODE: 'PAID' } }),
    ).toThrow(/AI_ACCESS_MODE must be 'FREE_ONLY'/);

    expect(() =>
      createApp({ storeInstance: tempStore, env: { MAX_SPEND_USD: '10' } }),
    ).toThrow(/MAX_SPEND_USD must be strictly 0/);

    expect(() =>
      createApp({ storeInstance: tempStore, env: { BILLING_ALLOWED: 'true' } }),
    ).toThrow(/BILLING_ALLOWED must be strictly false/);

    // 2. Start a local test HTTP server simulating an OpenRouter free endpoint
    const mockUpstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `Verified Free Provider Output for model ${parsed.model}`,
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise(resolve => mockUpstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = mockUpstream.address().port;
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;

    const appInstance = createApp({
      storeInstance: tempStore,
      env: {
        NODE_ENV: 'test',
        AI_ACCESS_MODE: 'FREE_ONLY',
        MAX_SPEND_USD: '0',
        BILLING_ALLOWED: 'false',
        OPENROUTER_API_KEY: 'test-free-key',
        OPENROUTER_BASE_URL: upstreamUrl,
        OPENROUTER_MODEL: 'meta-llama/llama-3.3-70b-instruct:free',
      },
      quotaLimits: { openrouter: 2 },
    });

    const srv = await listenAsync(appInstance);
    const client = await playwright.request.newContext({ baseURL: srv.url });

    try {
      // Check AI Gateway Status: all providers start disabled until 5 gates are verified
      const statusRes = await client.get('/api/ai/status');
      expect(statusRes.ok()).toBeTruthy();
      const statusData = await statusRes.json();
      expect(statusData.policy.AI_ACCESS_MODE).toBe('FREE_ONLY');
      expect(statusData.policy.MAX_SPEND_USD).toBe(0);
      expect(statusData.policy.BILLING_ALLOWED).toBe(false);
      expect(statusData.policy.tierRules).toEqual({
        FREE_FOREVER: 'ALLOWED',
        FREE_QUOTA: 'ALLOWED',
        LOCAL: 'ALLOWED',
        TRIAL: 'BLOCKED',
        PAID: 'BLOCKED',
        UNKNOWN: 'BLOCKED',
      });

      const openrouterInfo = statusData.providers.find(p => p.id === 'openrouter');
      expect(openrouterInfo.configured).toBe(true);
      expect(openrouterInfo.allGatesVerified).toBe(false);
      expect(openrouterInfo.enabled).toBe(false);
      expect(openrouterInfo.missingGates).toEqual(['card', 'region', 'limits', 'storage', 'quota']);

      const nvidiaInfo = statusData.providers.find(p => p.id === 'nvidia');
      expect(nvidiaInfo.pricingTier).toBe('TRIAL');
      expect(nvidiaInfo.policyDecision).toBe('BLOCKED');

      // Register operator
      const regRes = await client.post('/api/auth/register', {
        data: { username: 'gov_operator', password: 'Password123!' },
      });
      expect(regRes.status()).toBe(201);

      // Evaluate blocked tiers & non-:free OpenRouter model
      const evalPaid = await client.post('/api/ai/evaluate', {
        data: { providerId: 'custom', pricingTier: 'PAID', model: 'gpt-4' },
      });
      expect(evalPaid.status()).toBe(403);

      const evalTrial = await client.post('/api/ai/evaluate', {
        data: { providerId: 'nvidia', pricingTier: 'TRIAL', model: 'llama-3' },
      });
      expect(evalTrial.status()).toBe(403);

      const evalNonFreeModel = await client.post('/api/ai/evaluate', {
        data: { providerId: 'openrouter', pricingTier: 'FREE_QUOTA', model: 'openai/gpt-4o' },
      });
      expect(evalNonFreeModel.status()).toBe(403);

      // Create task and verify 4-layer separation:
      // Layer 1: Proposal is advisory only; running without approval MUST fail with 409
      const createTaskRes = await client.post('/api/tasks', {
        data: {
          title: 'Governed AI Task',
          description: 'Test approval and 5-gate provider lock',
          agentId: 'agent-architect',
        },
      });
      const { task } = await createTaskRes.json();

      // Attempt to run before approval -> 409 Conflict
      const runUnapproved = await client.post(`/api/tasks/${task.id}/run`);
      expect(runUnapproved.status()).toBe(409);

      // Generate AI Proposal -> status becomes 'proposed', still cannot run without human approval!
      const proposeRes = await client.post(`/api/tasks/${task.id}/propose`);
      expect(proposeRes.ok()).toBeTruthy();
      const { proposal } = await proposeRes.json();
      expect(proposal.advisoryOnly).toBe(true);
      expect(proposal.hasExecutionAuthority).toBe(false);

      const runAfterProposalOnly = await client.post(`/api/tasks/${task.id}/run`);
      expect(runAfterProposalOnly.status()).toBe(409);

      // Grant Human Approval (Layer 3: Execution Authority)
      const approveRes = await client.post(`/api/tasks/${task.id}/approve`);
      expect(approveRes.ok()).toBeTruthy();
      const { approval } = await approveRes.json();
      expect(approval.approved).toBe(true);

      // Attempt to run explicitly on 'openrouter' while 5 gates are NOT verified -> 403 Blocked
      await client.post('/api/ai/providers/openrouter/gates', {
        data: { card: true, region: true, limits: true, storage: true, quota: false },
      });
      const runMissingGate = await client.post(`/api/tasks/${task.id}/run`, {
        data: { providerId: 'openrouter' },
      });
      expect(runMissingGate.status()).toBe(403);
      const missingGateBody = await runMissingGate.json();
      expect(missingGateBody.details.missingGates).toEqual(['quota']);

      // Verify all 5 gates for openrouter -> provider becomes enabled
      const gateRes = await client.post('/api/ai/providers/openrouter/gates', {
        data: { card: true, region: true, limits: true, storage: true, quota: true },
      });
      const { provider: unlockedProvider } = await gateRes.json();
      expect(unlockedProvider.enabled).toBe(true);

      // Now run the approved task through the unlocked free provider -> 200 OK + Evidence Proof
      const runApproved = await client.post(`/api/tasks/${task.id}/run`, {
        data: { providerId: 'openrouter' },
      });
      expect(runApproved.ok()).toBeTruthy();
      const { task: executedTask, evidence } = await runApproved.json();
      expect(executedTask.status).toBe('completed');
      expect(executedTask.output).toContain('Verified Free Provider Output');
      expect(evidence.sourceType).toBe('live-provider-http');
      expect(evidence.providerId).toBe('openrouter');
      expect(evidence.pricingTier).toBe('FREE_QUOTA');
      expect(evidence.costUsd).toBe(0);
      expect(evidence.productionVerified).toBe(false);
      expect(evidence.approvalId).toBe(approval.approvalId);
    } finally {
      await client.dispose();
      await srv.close();
      await new Promise(res => mockUpstream.close(res));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Full UI workflow: register, create agent, approve and run task, chat, and logout', async ({ page }) => {
    const uniqueUsername = `user_${Date.now()}`;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nexus Agent Platform' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Service: ok');
    await expect(page.locator('#db-status')).toContainText('Database: connected');
    await expect(page.locator('#ai-status')).toContainText('AI Policy: FREE_ONLY ($0)');

    // Unauthenticated state shows sign-in prompt for tasks
    await expect(page.locator('#tasks-list')).toContainText('يرجى تسجيل الدخول');

    // Register new account
    await page.fill('#auth-username', uniqueUsername);
    await page.fill('#auth-displayname', 'قائد المنصة');
    await page.fill('#auth-password', 'SecretPass123!');
    await page.click('#register-btn');

    await expect(page.locator('#current-user-info')).toContainText(uniqueUsername);

    // Create custom agent
    const customAgentName = `Nexus Tester ${Date.now()}`;
    await page.fill('#agent-name', customAgentName);
    await page.fill('#agent-role', 'مهندس اختبارات');
    await page.fill('#agent-specialty', 'التحقق الآلي من جودة المنصة');
    await page.click('#add-agent-btn');

    await expect(page.locator('#agents-list')).toContainText(customAgentName);

    // Create, approve, and run a task
    const taskTitle = `مهمة اختبار ${Date.now()}`;
    await page.fill('#task-title', taskTitle);
    await page.fill('#task-desc', 'تشغيل فحص شامل للمنصة');
    await page.click('#add-task-btn');

    const taskCard = page.locator('.item-card', { hasText: taskTitle });
    await expect(taskCard).toBeVisible();
    await expect(taskCard.locator('.tag')).toHaveText('pending');

    // Approve first (Approval Gate), then Run
    await taskCard.locator('button[data-action="approve-task"]').click();
    await expect(taskCard.locator('.tag')).toHaveText('approved');

    await taskCard.locator('button[data-action="run-task"]').click();
    await expect(taskCard.locator('.tag')).toHaveText('completed');
    await expect(taskCard.locator('.task-output')).toContainText('اكتمل');
    await expect(taskCard.locator('.task-evidence')).toContainText('productionVerified=false');

    // Send a chat message to an agent
    const promptText = 'ما هي خطة فحص الأمان الحالية؟';
    await page.fill('#chat-input', promptText);
    await page.click('#chat-send-btn');

    await expect(page.locator('#chat-messages')).toContainText(promptText);
    await expect(page.locator('#chat-messages')).toContainText('مرحبًا');

    // Logout
    await page.click('#logout-btn');
    await expect(page.locator('#auth-logged-out')).toBeVisible();
    await expect(page.locator('#tasks-list')).toContainText('يرجى تسجيل الدخول');
  });
});
