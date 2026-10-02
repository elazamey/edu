import { BaseLLMAdapter } from './baseAdapter.js';
import { LLMError } from './errors.js';

/**
 * Adapter for any provider implementing the OpenAI Chat Completions API with
 * SSE streaming — OpenAI itself, xAI (https://api.x.ai/v1), and compatible
 * gateways. Providers only differ by base URL, so one implementation covers
 * all of them.
 */
export class OpenAICompatibleAdapter extends BaseLLMAdapter {
  /**
   * @param {object} options
   * @param {'openai' | 'xai' | 'openai-compatible'} [options.providerName]
   */
  constructor({ providerName = 'openai-compatible', ...options } = {}) {
    super(options);
    if (!this.baseUrl) {
      throw new TypeError('baseUrl is required for OpenAI-compatible adapters');
    }
    this.providerName = providerName;
  }

  get provider() {
    return this.providerName;
  }

  get completionsUrl() {
    return `${this.baseUrl}/chat/completions`;
  }

  buildRequestBody({ messages, temperature, maxTokens }) {
    const body = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    return body;
  }

  async *streamChat({ messages, temperature, maxTokens, signal } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError('messages must be a non-empty array');
    }
    const combined = this._buildSignal(signal);

    let response;
    try {
      response = await this.fetchImpl(this.completionsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          accept: 'text/event-stream',
        },
        body: JSON.stringify(this.buildRequestBody({ messages, temperature, maxTokens })),
        signal: combined,
      });
    } catch (cause) {
      if (combined.aborted) throw this._abortToError(combined, cause);
      throw new LLMError(`Failed to reach LLM provider: ${cause.message}`, { cause });
    }

    if (!response.ok) {
      throw await this._httpError(response);
    }

    let finishReason = null;
    let usage = null;
    try {
      for await (const data of this._readSseEvents(response)) {
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue; // tolerate malformed keep-alive frames
        }
        if (payload.usage) usage = payload.usage;
        for (const choice of payload.choices ?? []) {
          const content = choice?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield { type: 'delta', content };
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
      }
    } catch (cause) {
      if (combined.aborted) throw this._abortToError(combined, cause);
      throw new LLMError(`LLM stream interrupted: ${cause.message}`, { cause });
    }

    yield { type: 'done', finishReason, usage };
  }

  async _httpError(response) {
    let detail = '';
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        detail = json?.error?.message ?? json?.message ?? text;
      } catch {
        detail = text;
      }
    } catch {
      detail = response.statusText;
    }
    return new LLMError(
      `LLM provider returned HTTP ${response.status}: ${detail}`.trim(),
      { status: response.status, code: 'http_error' },
    );
  }
}

/** xAI's API is OpenAI-compatible; the alias documents intent. */
export class XAIAdapter extends OpenAICompatibleAdapter {
  constructor(options = {}) {
    super({ providerName: 'xai', baseUrl: options.baseUrl ?? 'https://api.x.ai/v1', ...options });
  }
}
