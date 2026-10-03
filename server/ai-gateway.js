import {
  PolicyViolationError,
  QuotaGuard,
  assertZeroSpendPolicy,
  evaluateEndpointPolicy,
  getActivePolicy,
} from './ai-policy.js';
import { createProviderRegistry } from './ai-providers.js';
import { executeAgentTask, generateAgentReply } from './agent-engine.js';

export class ApprovalRequiredError extends Error {
  constructor(message = 'Execution blocked: explicit operator approval is required before running a task.') {
    super(message);
    this.name = 'ApprovalRequiredError';
    this.code = 'APPROVAL_REQUIRED';
    this.statusCode = 409;
  }
}

export function createAIGateway({ env = process.env, quotaLimits = {}, initialGates = {} } = {}) {
  // Fail-closed at initialization if zero-spend policy is violated
  assertZeroSpendPolicy(env);

  const registry = createProviderRegistry(env, initialGates);
  const quotaGuard = new QuotaGuard(quotaLimits);

  function inspectProvider(provider) {
    let policyAllowed = false;
    let policyReason = null;
    try {
      evaluateEndpointPolicy({
        providerId: provider.id,
        pricingTier: provider.pricingTier,
        model: provider.defaultModel,
        costUsd: provider.costUsd,
        requiresFreeModelSuffix: provider.requiresFreeModelSuffix,
        verificationGates: provider.verificationGates,
        requireVerifiedGates: false,
        env,
      });
      policyAllowed = true;
    } catch (err) {
      policyAllowed = false;
      policyReason = err.message;
    }

    const quota = quotaGuard.getQuotaStatus(provider.id);
    const readyForExecution = Boolean(
      policyAllowed && provider.configured && provider.allGatesVerified && !quota.exhausted,
    );

    return {
      id: provider.id,
      name: provider.name,
      pricingTier: provider.pricingTier,
      costUsd: provider.costUsd,
      defaultModel: provider.defaultModel,
      configured: provider.configured,
      policyAllowed,
      policyDecision: policyAllowed ? 'ALLOWED' : 'BLOCKED',
      policyReason,
      verificationGates: provider.verificationGates,
      allGatesVerified: provider.allGatesVerified,
      missingGates: provider.missingGates,
      enabled: readyForExecution,
      quota,
    };
  }

  function getStatus() {
    const policy = getActivePolicy(env);
    const providers = registry.list().map(inspectProvider);
    const activeProviders = providers.filter(p => p.enabled);
    return {
      policy,
      runtimeMode: activeProviders.length > 0 ? 'live-provider-http' : 'local-deterministic-mock',
      realAiActive: activeProviders.length > 0,
      activeProviders: activeProviders.map(p => p.id),
      providers,
    };
  }

  function setProviderGates(providerId, gatesPatch) {
    const updated = registry.setGates(providerId, gatesPatch);
    if (!updated) return null;
    return inspectProvider(updated);
  }

  function evaluateCandidate({
    providerId,
    model,
    pricingTier,
    costUsd = 0,
    requireVerifiedGates = false,
  }) {
    const provider = providerId ? registry.get(providerId) : null;
    const effectiveTier = pricingTier ?? provider?.pricingTier ?? 'UNKNOWN';
    const effectiveModel = model ?? provider?.defaultModel ?? '';
    const effectiveCost = costUsd ?? provider?.costUsd ?? 0;

    return evaluateEndpointPolicy({
      providerId: provider?.id || providerId || 'custom',
      pricingTier: effectiveTier,
      model: effectiveModel,
      costUsd: effectiveCost,
      requiresFreeModelSuffix: Boolean(provider?.requiresFreeModelSuffix),
      verificationGates: provider?.verificationGates || null,
      requireVerifiedGates,
      env,
    });
  }

  function proposeTask({ agent, task, providerId, model }) {
    assertZeroSpendPolicy(env);

    let policyDecision;
    if (providerId) {
      policyDecision = evaluateCandidate({
        providerId,
        model,
        requireVerifiedGates: false,
      });
    } else {
      policyDecision = {
        allowed: true,
        decision: 'ALLOWED',
        providerId: 'auto-free-gateway',
        pricingTier: 'FREE_ONLY',
        costUsd: 0,
      };
    }

    const agentName = agent?.name || 'Nexus Agent';
    const role = agent?.role || 'وكيل ذكي';
    const proposal = {
      summary: `مقترح استشاري من ${agentName} (${role}) لتنفيذ المهمة "${task.title}"`,
      steps: [
        '1. التحقق من مطابقة السياسة المجانية (FREE_ONLY / $0 Spend).',
        '2. انتظار اعتماد المشغل البشري (Approval Gate) لمنح سلطة التنفيذ.',
        '3. تنفيذ المهمة وتسجيل إثبات الدليل (Evidence Proof).',
      ],
      advisoryOnly: true,
      hasExecutionAuthority: false,
      proposedAt: new Date().toISOString(),
    };

    return { proposal, policyDecision };
  }

  async function runThroughGateway({
    agent,
    systemPrompt,
    userPrompt,
    fallbackFn,
    providerId,
    model,
    approval = null,
  }) {
    assertZeroSpendPolicy(env);

    // If a specific provider is requested, strictly enforce Policy + 5-Gate Lock + Quota
    if (providerId) {
      const provider = registry.get(providerId);
      if (!provider) {
        throw new PolicyViolationError(
          `Unknown provider '${providerId}' is blocked under FREE_ONLY policy.`,
          { providerId, decision: 'BLOCKED' },
        );
      }

      const targetModel = model || provider.defaultModel;
      const policyDecision = evaluateEndpointPolicy({
        providerId: provider.id,
        pricingTier: provider.pricingTier,
        model: targetModel,
        costUsd: provider.costUsd,
        requiresFreeModelSuffix: provider.requiresFreeModelSuffix,
        verificationGates: provider.verificationGates,
        requireVerifiedGates: true,
        env,
      });

      if (!provider.configured) {
        throw new PolicyViolationError(
          `Provider '${provider.id}' credentials/endpoint are not configured.`,
          { providerId: provider.id, decision: 'BLOCKED' },
        );
      }

      quotaGuard.assertWithinQuota(provider.id);
      const output = await provider.invoke({
        model: targetModel,
        systemPrompt,
        userPrompt,
      });
      const quotaAfter = quotaGuard.recordUsage(provider.id);

      return {
        output,
        policyDecision,
        evidence: {
          sourceType: 'live-provider-http',
          aiReal: true,
          productionVerified: false,
          providerId: provider.id,
          model: targetModel,
          pricingTier: provider.pricingTier,
          costUsd: 0,
          verificationGates: provider.verificationGates,
          quotaAfter,
          approvalId: approval?.approvalId || null,
          approvedBy: approval?.approvedBy || null,
          executedAt: new Date().toISOString(),
        },
      };
    }

    // Auto-select first enabled & policy-allowed & quota-available provider
    for (const provider of registry.list()) {
      const inspected = inspectProvider(provider);
      if (!inspected.enabled) continue;

      const targetModel = model || provider.defaultModel;
      const policyDecision = evaluateEndpointPolicy({
        providerId: provider.id,
        pricingTier: provider.pricingTier,
        model: targetModel,
        costUsd: provider.costUsd,
        requiresFreeModelSuffix: provider.requiresFreeModelSuffix,
        verificationGates: provider.verificationGates,
        requireVerifiedGates: true,
        env,
      });

      const output = await provider.invoke({
        model: targetModel,
        systemPrompt,
        userPrompt,
      });
      const quotaAfter = quotaGuard.recordUsage(provider.id);

      return {
        output,
        policyDecision,
        evidence: {
          sourceType: 'live-provider-http',
          aiReal: true,
          productionVerified: false,
          providerId: provider.id,
          model: targetModel,
          pricingTier: provider.pricingTier,
          costUsd: 0,
          verificationGates: provider.verificationGates,
          quotaAfter,
          approvalId: approval?.approvalId || null,
          approvedBy: approval?.approvedBy || null,
          executedAt: new Date().toISOString(),
        },
      };
    }

    // Honest deterministic mock fallback when no external provider has all 5 gates verified & configured
    const mockOutput = fallbackFn();
    const policyDecision = {
      allowed: true,
      decision: 'ALLOWED',
      providerId: 'local-mock',
      pricingTier: 'LOCAL',
      model: 'deterministic-v1',
      costUsd: 0,
    };

    return {
      output: mockOutput,
      policyDecision,
      evidence: {
        sourceType: 'local-deterministic-mock',
        aiReal: false,
        productionVerified: false,
        providerId: 'local-mock',
        model: 'deterministic-v1',
        pricingTier: 'LOCAL',
        costUsd: 0,
        policyDecision,
        approvalId: approval?.approvalId || null,
        approvedBy: approval?.approvedBy || null,
        executedAt: new Date().toISOString(),
      },
    };
  }

  async function executeApprovedTask({ agent, task, approval, providerId, model }) {
    if (!approval || approval.approved !== true) {
      throw new ApprovalRequiredError();
    }

    const systemPrompt = `You are ${agent?.name || 'Nexus Agent'} (${agent?.role || 'Agent'}). Specialty: ${agent?.specialty || 'General'}.`;
    const userPrompt = `Execute approved task "${task.title}": ${task.description || 'No extra description.'}`;

    return runThroughGateway({
      agent,
      systemPrompt,
      userPrompt,
      fallbackFn: () => executeAgentTask(agent, task),
      providerId,
      model,
      approval,
    });
  }

  async function chat({ agent, prompt, user, providerId, model }) {
    const systemPrompt = `You are ${agent?.name || 'Nexus Agent'} (${agent?.role || 'Agent'}). Specialty: ${agent?.specialty || 'General'}.`;
    return runThroughGateway({
      agent,
      systemPrompt,
      userPrompt: prompt,
      fallbackFn: () => generateAgentReply(agent, prompt, user),
      providerId,
      model,
      approval: null,
    });
  }

  return {
    getStatus,
    setProviderGates,
    evaluateCandidate,
    proposeTask,
    executeApprovedTask,
    chat,
  };
}
