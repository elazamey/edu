import { test, expect } from '@playwright/test';

test.describe('Stage 4: Nexus Auth, Database, Agents, Tasks, and Chat', () => {
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

  test('Protected endpoints reject unauthenticated mutation requests', async ({ request }) => {
    const taskRes = await request.post('/api/tasks', {
      data: { title: 'Unauthorized task', agentId: 'agent-researcher' },
    });
    expect(taskRes.status()).toBe(401);

    const chatRes = await request.post('/api/chat', {
      data: { agentId: 'agent-researcher', content: 'Hello' },
    });
    expect(chatRes.status()).toBe(401);
  });

  test('Complete API lifecycle: auth, agents, tasks execution, chat, and persistence', async ({ request }) => {
    const username = `api_op_${Date.now()}`;
    const password = 'StrongPassword123!';

    // 1. Register a new operator
    const regRes = await request.post('/api/auth/register', {
      data: { username, displayName: 'API Operator', password },
    });
    expect(regRes.status()).toBe(201);
    const regBody = await regRes.json();
    expect(regBody.authenticated).toBe(true);
    expect(regBody.user.username).toBe(username);

    // 2. Verify active session
    const sessRes = await request.get('/api/auth/session');
    expect(sessRes.ok()).toBeTruthy();
    const sessBody = await sessRes.json();
    expect(sessBody.authenticated).toBe(true);
    expect(sessBody.user.username).toBe(username);

    // 3. Create a custom agent
    const agentRes = await request.post('/api/agents', {
      data: {
        name: 'Nexus Optimizer',
        role: 'محلل أداء',
        specialty: 'تحسين الأداء وزمن الاستجابة',
      },
    });
    expect(agentRes.status()).toBe(201);
    const { agent } = await agentRes.json();
    expect(agent.id).toBeTruthy();

    // 4. Create, run, and delete a task
    const createTaskRes = await request.post('/api/tasks', {
      data: {
        title: 'فحص سرعة الاستجابة',
        description: 'قياس زمن استجابة مسارات API',
        agentId: agent.id,
        priority: 'high',
      },
    });
    expect(createTaskRes.status()).toBe(201);
    const { task } = await createTaskRes.json();
    expect(task.status).toBe('pending');

    const runTaskRes = await request.post(`/api/tasks/${task.id}/run`);
    expect(runTaskRes.ok()).toBeTruthy();
    const { task: completedTask } = await runTaskRes.json();
    expect(completedTask.status).toBe('completed');
    expect(completedTask.output).toContain('Nexus Optimizer');

    // 5. Chat with the agent
    const chatRes = await request.post('/api/chat', {
      data: {
        agentId: agent.id,
        content: 'أرسل تقرير الأداء المختصر',
      },
    });
    expect(chatRes.status()).toBe(201);
    const chatData = await chatRes.json();
    expect(chatData.userMessage.content).toBe('أرسل تقرير الأداء المختصر');
    expect(chatData.agentMessage.content).toContain('Nexus Optimizer');

    // 6. Delete task and logout
    const delRes = await request.delete(`/api/tasks/${task.id}`);
    expect(delRes.ok()).toBeTruthy();

    const logoutRes = await request.post('/api/auth/logout');
    expect(logoutRes.ok()).toBeTruthy();
    const afterLogout = await request.get('/api/auth/session');
    expect((await afterLogout.json()).authenticated).toBe(false);

    // 7. Re-login with credentials
    const loginRes = await request.post('/api/auth/login', {
      data: { username, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    expect((await loginRes.json()).authenticated).toBe(true);
  });

  test('Full UI workflow: register, create agent, run task, chat, and logout', async ({ page }) => {
    const uniqueUsername = `user_${Date.now()}`;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nexus Agent Platform' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Service: ok');
    await expect(page.locator('#db-status')).toContainText('Database: connected');

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

    // Create and run a task
    const taskTitle = `مهمة اختبار ${Date.now()}`;
    await page.fill('#task-title', taskTitle);
    await page.fill('#task-desc', 'تشغيل فحص شامل للمنصة');
    await page.click('#add-task-btn');

    const taskCard = page.locator('.item-card', { hasText: taskTitle });
    await expect(taskCard).toBeVisible();
    await expect(taskCard.locator('.tag')).toHaveText('pending');

    await taskCard.locator('button[data-action="run-task"]').click();
    await expect(taskCard.locator('.tag')).toHaveText('completed');
    await expect(taskCard.locator('.task-output')).toContainText('اكتمل');

    // Send a chat message to an agent
    const promptText = 'ما هي خطة فحص الأمان الحالية؟';
    await page.fill('#chat-input', promptText);
    await page.click('#chat-send-btn');

    await expect(page.locator('#chat-messages')).toContainText(promptText);
    await expect(page.locator('#chat-messages')).toContainText('مرحبًا');

    // Logout
    await page.click('#logout-btn');
    await expect(page.locator('#auth-logged-out')).toBeVisible();
  });
});
