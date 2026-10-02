const statusEl = document.querySelector('#status');
const dbStatusEl = document.querySelector('#db-status');
const authLoggedOutEl = document.querySelector('#auth-logged-out');
const authLoggedInEl = document.querySelector('#auth-logged-in');
const currentUserInfoEl = document.querySelector('#current-user-info');
const authFeedbackEl = document.querySelector('#auth-feedback');

const usernameInput = document.querySelector('#auth-username');
const displayNameInput = document.querySelector('#auth-displayname');
const passwordInput = document.querySelector('#auth-password');
const loginBtn = document.querySelector('#login-btn');
const registerBtn = document.querySelector('#register-btn');
const githubDemoBtn = document.querySelector('#github-demo-btn');
const logoutBtn = document.querySelector('#logout-btn');

const createAgentForm = document.querySelector('#create-agent-form');
const agentsListEl = document.querySelector('#agents-list');
const taskAgentSelect = document.querySelector('#task-agent');
const chatAgentSelect = document.querySelector('#chat-agent');

const createTaskForm = document.querySelector('#create-task-form');
const taskFilterStatus = document.querySelector('#task-filter-status');
const tasksListEl = document.querySelector('#tasks-list');

const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const chatMessagesEl = document.querySelector('#chat-messages');

let agentsCache = [];

function showFeedback(message, isError = false) {
  if (!authFeedbackEl) return;
  authFeedbackEl.textContent = message;
  authFeedbackEl.classList.remove('hidden', 'error', 'success');
  authFeedbackEl.classList.add(isError ? 'error' : 'success');
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function refreshHealthAndDb() {
  try {
    const health = await apiRequest('/api/health');
    statusEl.textContent = `Service: ${health.status}`;
    statusEl.classList.add('ok');
  } catch {
    statusEl.textContent = 'Service unavailable';
    statusEl.classList.remove('ok');
  }

  try {
    const db = await apiRequest('/api/db/status');
    dbStatusEl.textContent = `Database: ${db.status} (${db.engine}) | Tasks: ${db.counts.tasks}`;
    dbStatusEl.classList.add('ok');
  } catch {
    dbStatusEl.textContent = 'Database: unavailable';
    dbStatusEl.classList.remove('ok');
  }
}

async function refreshSession() {
  try {
    const data = await apiRequest('/api/auth/session');
    if (data.authenticated && data.user) {
      authLoggedOutEl.classList.add('hidden');
      authLoggedInEl.classList.remove('hidden');
      currentUserInfoEl.textContent = `مسجل الدخول باسم: ${data.user.displayName} (@${data.user.username}) [${data.user.provider}]`;
    } else {
      authLoggedOutEl.classList.remove('hidden');
      authLoggedInEl.classList.add('hidden');
      currentUserInfoEl.textContent = '';
    }
  } catch {
    authLoggedOutEl.classList.remove('hidden');
    authLoggedInEl.classList.add('hidden');
  }
}

function renderAgents(agents) {
  agentsCache = agents;
  agentsListEl.innerHTML = '';

  const prevTaskAgent = taskAgentSelect.value;
  const prevChatAgent = chatAgentSelect.value;
  taskAgentSelect.innerHTML = '';
  chatAgentSelect.innerHTML = '';

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.agentId = agent.id;

    const header = document.createElement('div');
    header.className = 'item-header';

    const title = document.createElement('p');
    title.className = 'item-title';
    title.textContent = `${agent.name} — ${agent.role}`;

    const badge = document.createElement('span');
    badge.className = 'tag';
    badge.textContent = agent.status;

    header.append(title, badge);

    const spec = document.createElement('p');
    spec.style.margin = '0.25rem 0 0';
    spec.style.fontSize = '0.875rem';
    spec.textContent = agent.specialty;

    card.append(header, spec);
    agentsListEl.append(card);

    const opt1 = document.createElement('option');
    opt1.value = agent.id;
    opt1.textContent = `${agent.name} (${agent.role})`;
    taskAgentSelect.append(opt1);

    const opt2 = document.createElement('option');
    opt2.value = agent.id;
    opt2.textContent = `${agent.name} (${agent.role})`;
    chatAgentSelect.append(opt2);
  }

  if (prevTaskAgent && agents.some(a => a.id === prevTaskAgent)) {
    taskAgentSelect.value = prevTaskAgent;
  }
  if (prevChatAgent && agents.some(a => a.id === prevChatAgent)) {
    chatAgentSelect.value = prevChatAgent;
  }
}

async function refreshAgents() {
  const data = await apiRequest('/api/agents');
  renderAgents(data.agents || []);
}

function renderTasks(tasks) {
  tasksListEl.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'لا توجد مهام مطابقة حاليًا.';
    tasksListEl.append(empty);
    return;
  }

  for (const task of tasks) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.taskId = task.id;

    const header = document.createElement('div');
    header.className = 'item-header';

    const title = document.createElement('p');
    title.className = 'item-title';
    title.textContent = task.title;

    const badge = document.createElement('span');
    badge.className = `tag ${task.status}`;
    badge.textContent = task.status;

    header.append(title, badge);
    card.append(header);

    if (task.description) {
      const desc = document.createElement('p');
      desc.style.margin = '0.25rem 0';
      desc.style.fontSize = '0.875rem';
      desc.textContent = task.description;
      card.append(desc);
    }

    const agentObj = agentsCache.find(a => a.id === task.agentId);
    const meta = document.createElement('p');
    meta.style.margin = '0.2rem 0';
    meta.style.fontSize = '0.8rem';
    meta.style.color = '#475569';
    meta.textContent = `الوكيل: ${agentObj ? agentObj.name : task.agentId} | الأولوية: ${task.priority}`;
    card.append(meta);

    if (task.output) {
      const output = document.createElement('div');
      output.className = 'task-output';
      output.textContent = task.output;
      card.append(output);
    }

    const actions = document.createElement('div');
    actions.className = 'btn-row';

    if (task.status !== 'completed') {
      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.textContent = 'تشغيل المهمة';
      runBtn.dataset.action = 'run-task';
      runBtn.dataset.taskId = task.id;
      actions.append(runBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'حذف';
    deleteBtn.dataset.action = 'delete-task';
    deleteBtn.dataset.taskId = task.id;
    actions.append(deleteBtn);

    card.append(actions);
    tasksListEl.append(card);
  }
}

async function refreshTasks() {
  const status = taskFilterStatus.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await apiRequest(`/api/tasks${query}`);
  renderTasks(data.tasks || []);
}

function renderMessages(messages) {
  chatMessagesEl.innerHTML = '';
  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.style.margin = '0';
    empty.style.color = '#475569';
    empty.textContent = 'ابدأ المحادثة مع الوكيل المختار لعرض السجل هنا.';
    chatMessagesEl.append(empty);
    return;
  }

  for (const msg of messages) {
    const item = document.createElement('div');
    item.className = `chat-msg ${msg.sender === 'user' ? 'user' : 'agent'}`;

    const author = document.createElement('div');
    author.className = 'chat-author';
    author.textContent = msg.authorName;

    const body = document.createElement('div');
    body.textContent = msg.content;

    item.append(author, body);
    chatMessagesEl.append(item);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function refreshChat() {
  const agentId = chatAgentSelect.value;
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const data = await apiRequest(`/api/chat${query}`);
  renderMessages(data.messages || []);
}

// Event Listeners
registerBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value,
        displayName: displayNameInput.value,
        password: passwordInput.value,
      }),
    });
    passwordInput.value = '';
    showFeedback('تم إنشاء الحساب وتسجيل الدخول بنجاح.');
    await refreshSession();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

loginBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
      }),
    });
    passwordInput.value = '';
    showFeedback('تم تسجيل الدخول بنجاح.');
    await refreshSession();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

githubDemoBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/auth/github/demo', { method: 'POST' });
    showFeedback('تم تفعيل جلسة مشغل GitHub التجريبية بنجاح.');
    await refreshSession();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    showFeedback('تم تسجيل الخروج بنجاح.');
    await refreshSession();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

createAgentForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.querySelector('#agent-name').value;
  const role = document.querySelector('#agent-role').value;
  const specialty = document.querySelector('#agent-specialty').value;

  try {
    await apiRequest('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name, role, specialty }),
    });
    createAgentForm.reset();
    showFeedback('تمت إضافة الوكيل الجديد بنجاح.');
    await refreshAgents();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

createTaskForm.addEventListener('submit', async event => {
  event.preventDefault();
  const title = document.querySelector('#task-title').value;
  const description = document.querySelector('#task-desc').value;
  const agentId = taskAgentSelect.value;
  const priority = document.querySelector('#task-priority').value;

  try {
    await apiRequest('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, description, agentId, priority }),
    });
    createTaskForm.reset();
    showFeedback('تم إنشاء المهمة بنجاح.');
    await refreshTasks();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

taskFilterStatus.addEventListener('change', () => {
  refreshTasks();
});

tasksListEl.addEventListener('click', async event => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, taskId } = btn.dataset;

  try {
    if (action === 'run-task') {
      await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
      showFeedback('تم تشغيل المهمة بواسطة الوكيل بنجاح.');
    } else if (action === 'delete-task') {
      await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      showFeedback('تم حذف المهمة.');
    }
    await refreshTasks();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

chatAgentSelect.addEventListener('change', () => {
  refreshChat();
});

chatForm.addEventListener('submit', async event => {
  event.preventDefault();
  const agentId = chatAgentSelect.value;
  const content = chatInput.value;

  try {
    await apiRequest('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ agentId, content }),
    });
    chatInput.value = '';
    await refreshChat();
    await refreshHealthAndDb();
  } catch (err) {
    showFeedback(err.message, true);
  }
});

async function initApp() {
  await refreshHealthAndDb();
  await refreshSession();
  await refreshAgents();
  await refreshTasks();
  await refreshChat();
}

initApp();
