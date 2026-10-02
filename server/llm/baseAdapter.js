import { LLMAbortError, LLMTimeoutError } from './errors.js';

const DECODER = new TextDecoder();

/**
 * Base class for LLM provider adapters.
 *
 * Responsibilities shared by every adapter:
 *  - configuration storage (api key, model, base URL, timeout);
 *  - a single streaming entry point, `streamChat()`, yielding normalized
 *    events: `{ type: 'delta', content }` followed by a final
 *    `{ type: 'done', finishReason, usage }`;
 *  - a convenience non-streaming `chat()` built on top of `streamChat()`;
 *  - timeout + external-signal composition (`_buildSignal`);
 *  - generic SSE frame parsing (`_readSseEvents`) reused by HTTP providers.
 *
 * Concrete providers implement `streamChat()`.
 */
export class BaseLLMAdapter {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} options.model
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetch] Injectable for tests.
   */
  constructor({ apiKey, model, baseUrl = '', timeoutMs = 60_000, fetch: fetchImpl } = {}) {
    if (!apiKey) throw new TypeError('apiKey is required');
    if (!model) throw new TypeError('model is required');
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required');
    }
  }

  /** Provider identifier recorded on runs, e.g. "openai". */
  get provider() {
    return 'base';
  }

  /**
   * Stream a chat completion.
   *
   * @param {object} params
   * @param {Array<{role: string, content: string}>} params.messages
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @param {AbortSignal} [params.signal] External abort (user abort).
   * @yields {{type: 'delta', content: string} | {type: 'done', finishReason: string|null, usage: object|null}}
   */
  // eslint-disable-next-line require-yield
  async *streamChat() {
    throw new Error('streamChat() must be implemented by a concrete adapter');
  }

  /**
   * Non-streaming convenience wrapper: collects the whole completion.
   *
   * @returns {Promise<{content: string, finishReason: string|null, usage: object|null}>}
   */
  async chat(params = {}) {
    let content = '';
    let finishReason = null;
    let usage = null;
    for await (const event of this.streamChat(params)) {
      if (event.type === 'delta') content += event.content;
      else if (event.type === 'done') {
        finishReason = event.finishReason ?? null;
        usage = event.usage ?? null;
      }
    }
    return { content, finishReason, usage };
  }

  /**
   * Combine the external caller signal with the adapter timeout. The
   * returned signal aborts on whichever happens first; `.timedOut` tells the
   * two apart after the fact.
   */
  _buildSignal(externalSignal) {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    if (!externalSignal) return timeoutSignal;
    if (externalSignal.aborted) return externalSignal;
    return AbortSignal.any([externalSignal, timeoutSignal]);
  }

  /**
   * Translate an abort into the right typed error. `AbortSignal.timedOut` is
   * unreliable across runtimes (and always falsy on `AbortSignal.any()`),
   * so the timeout is detected through the abort reason.
   */
  _abortToError(signal, cause) {
    const timedOut = signal?.timedOut === true || signal?.reason?.name === 'TimeoutError';
    if (timedOut) {
      return new LLMTimeoutError(
        `LLM request timed out after ${this.timeoutMs}ms`,
        { cause },
      );
    }
    return new LLMAbortError('LLM request aborted', { cause });
  }

  /**
   * Parse an SSE response body into `data:` payloads.
   *
   * Yields raw data strings; the sentinel `[DONE]` terminates the stream.
   * Handles frames split across chunk boundaries and multi-line data fields.
   *
   * @param {Response} response
   * @yields {string}
   */
  async *_readSseEvents(response) {
    if (!response.body) return;
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += typeof chunk === 'string' ? chunk : DECODER.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractSseData(frame);
        if (data === null) continue; // comment or non-data frame
        if (data === '[DONE]') return;
        yield data;
      }
    }
    const trailing = buffer.trim();
    if (trailing) {
      const data = extractSseData(trailing);
      if (data !== null && data !== '[DONE]') yield data;
    }
  }
}

function extractSseData(frame) {
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // SSE comment (keep-alive)
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}
