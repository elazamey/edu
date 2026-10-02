import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleAdapter, XAIAdapter } from '../../server/llm/openAiCompatibleAdapter.js';
import { BaseLLMAdapter } from '../../server/llm/baseAdapter.js';
import { createAdapter } from '../../server/llm/index.js';
import { loadConfig } from '../../server/config.js';
import {
  LLMError,
  LLMAbortError,
  LLMTimeoutError,
  LLMConfigurationError,
} from '../../server/llm/errors.js';

const ENCODER = new TextEncoder();

/** Build a streaming Response whose body is the given SSE chunks. */
function sseResponse(chunks, { status = 200 } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(ENCODER.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function frame(delta, extra = {}) {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null, ...extra }] })}\n\n`;
}

function makeAdapter(fetchImpl, options = {}) {
  return new OpenAICompatibleAdapter({
    providerName: 'openai',
    apiKey: 'sk-test',
    model: 'test-model',
    baseUrl: 'https://api.openai.com/v1',
    timeoutMs: 5_000,
    fetch: fetchImpl,
    ...options,
  });
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

/**
 * AbortSignal.timeout() uses an unref'd timer, so a test that waits on it
 * alone leaves the event loop empty and gets force-ended by the runner. A
 * ref'd timer keeps the loop alive until the timeout signal fires.
 */
function keepEventLoopAlive(ms = 2_000) {
  const timer = setTimeout(() => {}, ms);
  return () => clearTimeout(timer);
}

describe('OpenAICompatibleAdapter (fetch mocked)', () => {
  test('sends the documented request and yields normalized deltas + done', async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return sseResponse([
        frame({ role: 'assistant', content: '' }),
        frame({ content: 'Hello ' }),
        frame({ content: 'world' }),
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ]);
    };

    const adapter = makeAdapter(fetchImpl);
    const events = await collect(
      adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] }),
    );

    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.authorization, 'Bearer sk-test');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
    assert.ok(captured.init.signal instanceof AbortSignal);

    assert.deepEqual(
      events.filter((e) => e.type === 'delta').map((e) => e.content),
      ['Hello ', 'world'],
    );
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.finishReason, 'stop');
    assert.deepEqual(done.usage, { prompt_tokens: 3, completion_tokens: 2 });
  });

  test('passes temperature and max_tokens only when provided', async () => {
    let body;
    const fetchImpl = async (url, init) => {
      body = JSON.parse(init.body);
      return sseResponse(['data: [DONE]\n\n']);
    };
    const adapter = makeAdapter(fetchImpl);

    await collect(adapter.streamChat({ messages: [{ role: 'user', content: 'x' }] }));
    assert.equal(body.temperature, undefined);
    assert.equal(body.max_tokens, undefined);

    await collect(
      adapter.streamChat({ messages: [{ role: 'user', content: 'x' }], temperature: 0.2, maxTokens: 64 }),
    );
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 64);
  });

  test('re-assembles SSE frames split across network chunks', async () => {
    const full =
      frame({ content: 'split' }) +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    const pieces = [full.slice(0, 7), full.slice(7, 33), full.slice(33)];
    const adapter = makeAdapter(async () => sseResponse(pieces));

    const events = await collect(
      adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    assert.deepEqual(
      events.filter((e) => e.type === 'delta').map((e) => e.content),
      ['split'],
    );
    assert.equal(events.at(-1).finishReason, 'stop');
  });

  test('ignores SSE comment frames and malformed JSON payloads', async () => {
    const adapter = makeAdapter(async () =>
      sseResponse([
        ': keep-alive\n\n',
        'data: {not json}\n\n',
        frame({ content: 'ok' }),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await collect(
      adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    assert.deepEqual(
      events.filter((e) => e.type === 'delta').map((e) => e.content),
      ['ok'],
    );
  });

  test('maps non-2xx responses to LLMError with status and provider message', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const adapter = makeAdapter(fetchImpl);

    await assert.rejects(
      collect(adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] })),
      (error) => {
        assert.ok(error instanceof LLMError);
        assert.equal(error.status, 401);
        assert.match(error.message, /Invalid API key/);
        return true;
      },
    );
  });

  test('maps network failures to LLMError', async () => {
    const adapter = makeAdapter(async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(
      collect(adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] })),
      (error) => {
        assert.ok(error instanceof LLMError);
        assert.match(error.message, /fetch failed/);
        return true;
      },
    );
  });

  test('raises LLMAbortError when the caller aborts mid-stream', async () => {
    const controller = new AbortController();
    const fetchImpl = async (url, { signal }) => {
      const body = new ReadableStream({
        start(streamController) {
          streamController.enqueue(ENCODER.encode(frame({ content: 'partial' })));
          signal.addEventListener('abort', () => {
            streamController.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const adapter = makeAdapter(fetchImpl);

    const iterator = adapter.streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    });
    const first = await iterator.next();
    assert.deepEqual(first.value, { type: 'delta', content: 'partial' });

    controller.abort();
    await assert.rejects(iterator.next(), LLMAbortError);
  });

  test('raises LLMTimeoutError when the provider stalls past timeoutMs', async () => {
    const fetchImpl = async (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    const adapter = makeAdapter(fetchImpl, { timeoutMs: 50 });
    const releaseLoop = keepEventLoopAlive();

    try {
      await assert.rejects(
        collect(adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] })),
        (error) => {
          assert.ok(error instanceof LLMTimeoutError);
          assert.match(error.message, /50ms/);
          return true;
        },
      );
    } finally {
      releaseLoop();
    }
  });

  test('raises LLMTimeoutError when the stream stalls after starting', async () => {
    const fetchImpl = async (url, { signal }) => {
      const body = new ReadableStream({
        start(streamController) {
          streamController.enqueue(ENCODER.encode(frame({ content: 'first' })));
          signal.addEventListener('abort', () => {
            streamController.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const adapter = makeAdapter(fetchImpl, { timeoutMs: 50 });
    const releaseLoop = keepEventLoopAlive();

    try {
      await assert.rejects(
        collect(adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] })),
        LLMTimeoutError,
      );
    } finally {
      releaseLoop();
    }
  });

  test('an already-aborted external signal fails fast', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = async (url, { signal }) => {
      signal.throwIfAborted();
      throw new Error('unreachable');
    };
    const adapter = makeAdapter(fetchImpl);
    await assert.rejects(
      collect(adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })),
      LLMAbortError,
    );
  });

  test('rejects empty message lists', async () => {
    const adapter = makeAdapter(async () => sseResponse([]));
    await assert.rejects(collect(adapter.streamChat({ messages: [] })), TypeError);
  });

  test('chat() collects the full completion', async () => {
    const adapter = makeAdapter(async () =>
      sseResponse([frame({ content: 'one ' }), frame({ content: 'two' }), 'data: [DONE]\n\n']),
    );
    const result = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.content, 'one two');
    assert.equal(result.finishReason, null);
  });
});

describe('BaseLLMAdapter contract', () => {
  test('requires apiKey and model', () => {
    assert.throws(() => new BaseLLMAdapter({ model: 'm' }), /apiKey/);
    assert.throws(() => new BaseLLMAdapter({ apiKey: 'k' }), /model/);
  });

  test('streamChat() is abstract', async () => {
    class TestAdapter extends BaseLLMAdapter {}
    const adapter = new TestAdapter({ apiKey: 'k', model: 'm', fetch: async () => {} });
    await assert.rejects(async () => {
      for await (const event of adapter.streamChat()) {
        throw new Error(`unexpected event: ${event}`);
      }
    }, /must be implemented/);
  });
});

describe('createAdapter factory', () => {
  const fetchImpl = async () => sseResponse(['data: [DONE]\n\n']);

  test('builds provider-specific adapters from valid config', () => {
    for (const provider of ['openai', 'xai', 'openai-compatible']) {
      const config = loadConfig({
        LLM_PROVIDER: provider,
        LLM_API_KEY: 'k',
        LLM_MODEL: 'm',
        ...(provider === 'openai-compatible' ? { LLM_BASE_URL: 'https://gw.example.com/v1' } : {}),
      });
      const adapter = createAdapter(config.llm, { fetch: fetchImpl });
      assert.equal(adapter.provider, provider);
      assert.ok(adapter instanceof OpenAICompatibleAdapter);
    }
  });

  test('XAIAdapter defaults to the xAI base URL', () => {
    const adapter = new XAIAdapter({ apiKey: 'k', model: 'grok-4', fetch: fetchImpl });
    assert.equal(adapter.completionsUrl, 'https://api.x.ai/v1/chat/completions');
    assert.equal(adapter.provider, 'xai');
  });

  test('refuses invalid or missing config', () => {
    assert.throws(() => createAdapter(null), LLMConfigurationError);
    const bad = loadConfig({ LLM_PROVIDER: 'openai' });
    assert.throws(() => createAdapter(bad.llm), LLMConfigurationError);
  });
});
