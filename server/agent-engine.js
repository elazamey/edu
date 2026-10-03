export function executeAgentTask(agent, task) {
  const agentName = agent?.name || 'Nexus Agent';
  const role = agent?.role || 'وكيل ذكي';
  const title = task.title;
  const details = task.description ? ` (${task.description})` : '';

  if (agent?.id === 'agent-researcher') {
    return `[${agentName} — ${role}] اكتمل التحليل المعرفي للمهمة "${title}"${details}: تم جمع النقاط الأساسية وتحديد مسار التنفيذ الموصى به بنجاح.`;
  }
  if (agent?.id === 'agent-architect') {
    return `[${agentName} — ${role}] اكتملت المراجعة الهندسية للمهمة "${title}"${details}: تم التحقق من توافق البنية المعمارية وتجهيز خطوات التطبيق.`;
  }
  if (agent?.id === 'agent-guardian') {
    return `[${agentName} — ${role}] اكتمل التدقيق الأمني وفحص الجودة للمهمة "${title}"${details}: الضوابط الأمنية والاختبارات الآلية مستوفاة.`;
  }

  return `[${agentName} — ${role}] تم تنفيذ المهمة "${title}"${details} بنجاح وتحديث سجل المخرجات.`;
}

export function generateAgentReply(agent, prompt, user) {
  const agentName = agent?.name || 'Nexus Agent';
  const role = agent?.role || 'وكيل ذكي';
  const specialty = agent?.specialty || 'معالجة المهام الذكية';
  const operator = user?.displayName || user?.username || 'المشغل';
  const cleanPrompt = String(prompt || '').trim();

  return `مرحبًا ${operator}، أنا ${agentName} (${role}). بخصوص رسالتك: "${cleanPrompt}" — بناءً على تخصصي في (${specialty})، قمت بتسجيل الطلب وتحليله، ويمكنك تحويله إلى مهمة تنفيذية أو متابعة النقاش مباشرة.`;
}
