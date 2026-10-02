import { LLM_PROVIDERS, PROVIDER_DEFAULT_BASE_URLS } from '../config.js';
import { LLMConfigurationError } from './errors.js';
import { OpenAICompatibleAdapter, XAIAdapter } from './openAiCompatibleAdapter.js';

export { BaseLLMAdapter } from './baseAdapter.js';
export { OpenAICompatibleAdapter, XAIAdapter } from './openAiCompatibleAdapter.js';
export * from './errors.js';

/**
 * Build an adapter from a validated LLM config (`loadConfig().llm`).
 *
 * @param {object} llmConfig
 * @param {{ fetch?: typeof fetch }} [deps] Injectable fetch for tests.
 */
export function createAdapter(llmConfig, deps = {}) {
  if (!llmConfig || !llmConfig.available) {
    throw new LLMConfigurationError('LLM configuration is incomplete or invalid');
  }
  const common = {
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS[llmConfig.provider],
    timeoutMs: llmConfig.timeoutMs,
    fetch: deps.fetch,
  };
  switch (llmConfig.provider) {
    case 'openai':
      return new OpenAICompatibleAdapter({ providerName: 'openai', ...common });
    case 'xai':
      return new XAIAdapter(common);
    case 'openai-compatible':
      return new OpenAICompatibleAdapter({ providerName: 'openai-compatible', ...common });
    default:
      throw new LLMConfigurationError(
        `Unsupported LLM provider: ${llmConfig.provider}. Expected one of: ${LLM_PROVIDERS.join(', ')}`,
      );
  }
}
