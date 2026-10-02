// LLM configuration loading and validation.
//
// `loadConfig(env)` never throws: it returns `{ llm, errors }` where `errors`
// is a list of human-readable validation problems. The server boots even when
// the LLM is not configured (health checks stay green) but execution
// endpoints respond with 503 until the configuration is fixed.

export const LLM_PROVIDERS = Object.freeze(['openai', 'xai', 'openai-compatible']);

export const PROVIDER_DEFAULT_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
});

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 1;
export const MAX_TIMEOUT_MS = 600_000;

export class ConfigError extends Error {
  constructor(errors) {
    super(`Invalid LLM configuration:\n- ${errors.join('\n- ')}`);
    this.name = 'ConfigError';
    this.errors = [...errors];
  }
}

function parsePositiveInteger(raw, { min, max }) {
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function validateBaseUrl(raw, { required }) {
  if (raw === undefined || raw === '') {
    return required
      ? { error: 'LLM_BASE_URL is required when LLM_PROVIDER is "openai-compatible"' }
      : { value: null };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'LLM_BASE_URL must be a valid URL, e.g. https://api.example.com/v1' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'LLM_BASE_URL must use http or https' };
  }
  return { value: url.toString().replace(/\/+$/, '') };
}

/**
 * Parse and validate LLM-related environment variables.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ llm: object, errors: string[] }}
 */
export function loadConfig(env = process.env) {
  const errors = [];

  const provider = env.LLM_PROVIDER === undefined || env.LLM_PROVIDER === ''
    ? 'openai'
    : env.LLM_PROVIDER;
  if (!LLM_PROVIDERS.includes(provider)) {
    errors.push(
      `LLM_PROVIDER must be one of: ${LLM_PROVIDERS.join(', ')} (got "${String(env.LLM_PROVIDER)}")`,
    );
  }

  const apiKey = (env.LLM_API_KEY ?? '').trim();
  if (!apiKey) errors.push('LLM_API_KEY is required');

  const model = (env.LLM_MODEL ?? '').trim();
  if (!model) errors.push('LLM_MODEL is required');

  const baseUrlRequired = provider === 'openai-compatible';
  const baseUrlCheck = validateBaseUrl(env.LLM_BASE_URL, { required: baseUrlRequired });
  if (baseUrlCheck.error) {
    errors.push(baseUrlCheck.error);
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (env.LLM_TIMEOUT_MS !== undefined && env.LLM_TIMEOUT_MS !== '') {
    const parsed = parsePositiveInteger(env.LLM_TIMEOUT_MS, {
      min: MIN_TIMEOUT_MS,
      max: MAX_TIMEOUT_MS,
    });
    if (parsed === null) {
      errors.push(
        `LLM_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds`,
      );
    } else {
      timeoutMs = parsed;
    }
  }

  let temperature;
  if (env.LLM_TEMPERATURE !== undefined && env.LLM_TEMPERATURE !== '') {
    const parsed = Number(env.LLM_TEMPERATURE);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      errors.push('LLM_TEMPERATURE must be a number between 0 and 2');
    } else {
      temperature = parsed;
    }
  }

  let maxTokens;
  if (env.LLM_MAX_TOKENS !== undefined && env.LLM_MAX_TOKENS !== '') {
    const parsed = parsePositiveInteger(env.LLM_MAX_TOKENS, { min: 1, max: 1_000_000 });
    if (parsed === null) {
      errors.push('LLM_MAX_TOKENS must be a positive integer');
    } else {
      maxTokens = parsed;
    }
  }

  const baseUrl = baseUrlCheck.value ?? PROVIDER_DEFAULT_BASE_URLS[provider] ?? null;

  const llm = {
    available: errors.length === 0,
    provider: LLM_PROVIDERS.includes(provider) ? provider : null,
    apiKey: apiKey || null,
    model: model || null,
    baseUrl,
    timeoutMs,
    temperature,
    maxTokens,
  };

  return { llm, errors };
}

/**
 * Strict variant of `loadConfig` for tests and tooling: throws a ConfigError
 * listing every validation problem instead of returning them.
 */
export function loadConfigOrThrow(env = process.env) {
  const config = loadConfig(env);
  if (config.errors.length > 0) throw new ConfigError(config.errors);
  return config;
}
