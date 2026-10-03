export const PRICING_TIERS = Object.freeze({
  FREE_FOREVER: 'FREE_FOREVER',
  FREE_QUOTA: 'FREE_QUOTA',
  LOCAL: 'LOCAL',
  TRIAL: 'TRIAL',
  PAID: 'PAID',
  UNKNOWN: 'UNKNOWN',
});

export const TIER_DECISIONS = Object.freeze({
  FREE_FOREVER: 'ALLOWED',
  FREE_QUOTA: 'ALLOWED',
  LOCAL: 'ALLOWED',
  TRIAL: 'BLOCKED',
  PAID: 'BLOCKED',
  UNKNOWN: 'BLOCKED',
});

export const ALLOWED_TIERS = new Set([
  PRICING_TIERS.FREE_FOREVER,
  PRICING_TIERS.FREE_QUOTA,
  PRICING_TIERS.LOCAL,
]);

export const VERIFICATION_GATES = Object.freeze([
  'card',
  'region',
  'limits',
  'storage',
  'quota',
]);

export class PolicyViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PolicyViolationError';
    this.code = 'POLICY_VIOLATION';
    this.statusCode = 403;
    this.details = details;
  }
}

export class QuotaExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QuotaExceededError';
    this.code = 'QUOTA_EXCEEDED';
    this.statusCode = 429;
    this.details = details;
  }
}

export function getActivePolicy(env = process.env) {
  const accessMode = String(env.AI_ACCESS_MODE || 'FREE_ONLY').trim();
  const maxSpendUsd = env.MAX_SPEND_USD !== undefined ? Number(env.MAX_SPEND_USD) : 0;
  const billingAllowed = env.BILLING_ALLOWED !== undefined
    ? String(env.BILLING_ALLOWED).toLowerCase() === 'true'
    : false;

  return {
    AI_ACCESS_MODE: accessMode,
    MAX_SPEND_USD: maxSpendUsd,
    BILLING_ALLOWED: billingAllowed,
    tierRules: { ...TIER_DECISIONS },
    requiredVerificationGates: [...VERIFICATION_GATES],
  };
}

export function assertZeroSpendPolicy(env = process.env) {
  const policy = getActivePolicy(env);
  if (policy.AI_ACCESS_MODE !== 'FREE_ONLY') {
    throw new PolicyViolationError(
      `FATAL: AI_ACCESS_MODE must be 'FREE_ONLY' (received '${policy.AI_ACCESS_MODE}'). Paid or unrestricted AI modes are prohibited.`,
      { field: 'AI_ACCESS_MODE', value: policy.AI_ACCESS_MODE },
    );
  }
  if (!Number.isFinite(policy.MAX_SPEND_USD) || policy.MAX_SPEND_USD !== 0) {
    throw new PolicyViolationError(
      `FATAL: MAX_SPEND_USD must be strictly 0 (received '${env.MAX_SPEND_USD}').`,
      { field: 'MAX_SPEND_USD', value: policy.MAX_SPEND_USD },
    );
  }
  if (policy.BILLING_ALLOWED !== false) {
    throw new PolicyViolationError(
      'FATAL: BILLING_ALLOWED must be strictly false.',
      { field: 'BILLING_ALLOWED', value: policy.BILLING_ALLOWED },
    );
  }
  return policy;
}

export function evaluateVerificationGates(gates = {}) {
  const gateStatus = {};
  const missingGates = [];
  for (const gate of VERIFICATION_GATES) {
    const passed = Boolean(gates?.[gate] === true);
    gateStatus[gate] = passed;
    if (!passed) {
      missingGates.push(gate);
    }
  }
  return {
    allVerified: missingGates.length === 0,
    gates: gateStatus,
    missingGates,
  };
}

export function evaluateEndpointPolicy({
  providerId,
  pricingTier,
  model,
  costUsd = 0,
  requiresFreeModelSuffix = false,
  verificationGates = null,
  requireVerifiedGates = false,
  env = process.env,
}) {
  assertZeroSpendPolicy(env);

  const normalizedTier = String(pricingTier || PRICING_TIERS.UNKNOWN).toUpperCase();
  const decision = TIER_DECISIONS[normalizedTier] || 'BLOCKED';

  if (!ALLOWED_TIERS.has(normalizedTier) || decision !== 'ALLOWED') {
    throw new PolicyViolationError(
      `Endpoint blocked by FREE_ONLY policy: provider '${providerId || 'unknown'}' has pricing tier '${normalizedTier}' (${decision}). Only FREE_FOREVER, FREE_QUOTA, and LOCAL are allowed.`,
      { providerId, pricingTier: normalizedTier, decision: 'BLOCKED' },
    );
  }

  const numericCost = Number(costUsd);
  if (!Number.isFinite(numericCost) || numericCost > 0) {
    throw new PolicyViolationError(
      `Endpoint blocked by zero-spend guard: non-zero cost (${costUsd} USD) is prohibited.`,
      { providerId, costUsd, decision: 'BLOCKED' },
    );
  }

  if (requiresFreeModelSuffix || providerId === 'openrouter') {
    const modelStr = String(model || '').trim();
    if (!modelStr.endsWith(':free')) {
      throw new PolicyViolationError(
        `Endpoint blocked by FREE_ONLY policy: OpenRouter model '${modelStr}' does not end with ':free'. Model presence in an arena does not make its API free.`,
        { providerId: 'openrouter', model: modelStr, decision: 'BLOCKED' },
      );
    }
  }

  const gateCheck = verificationGates ? evaluateVerificationGates(verificationGates) : null;
  if (requireVerifiedGates && (!gateCheck || !gateCheck.allVerified)) {
    throw new PolicyViolationError(
      `Provider '${providerId}' remains disabled until all 5 verification gates pass (missing: ${(gateCheck?.missingGates || VERIFICATION_GATES).join(', ')}).`,
      {
        providerId,
        decision: 'BLOCKED',
        missingGates: gateCheck?.missingGates || [...VERIFICATION_GATES],
      },
    );
  }

  return {
    allowed: true,
    decision: 'ALLOWED',
    providerId,
    pricingTier: normalizedTier,
    model,
    costUsd: 0,
    verificationGates: gateCheck,
  };
}

export class QuotaGuard {
  constructor(customLimits = {}) {
    this.limits = {
      openrouter: Number(customLimits.openrouter ?? 50),
      huggingface: Number(customLimits.huggingface ?? 100),
      gemini: Number(customLimits.gemini ?? 100),
      nvidia: Number(customLimits.nvidia ?? 50),
      ollama: Number.POSITIVE_INFINITY,
    };
    this.usage = new Map();
  }

  getQuotaStatus(providerId) {
    const used = this.usage.get(providerId) || 0;
    const limit = this.limits[providerId] ?? 50;
    return {
      used,
      limit: Number.isFinite(limit) ? limit : 'unlimited',
      remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : 'unlimited',
      exhausted: Number.isFinite(limit) && used >= limit,
    };
  }

  assertWithinQuota(providerId) {
    const status = this.getQuotaStatus(providerId);
    if (status.exhausted) {
      throw new QuotaExceededError(
        `Free quota exhausted for provider '${providerId}' (${status.used}/${status.limit}). Paid overage is blocked by FREE_ONLY policy.`,
        { providerId, ...status },
      );
    }
    return status;
  }

  recordUsage(providerId) {
    const current = this.usage.get(providerId) || 0;
    this.usage.set(providerId, current + 1);
    return this.getQuotaStatus(providerId);
  }
}
