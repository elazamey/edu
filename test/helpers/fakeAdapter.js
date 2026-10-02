import { LLMAbortError } from '../../server/llm/errors.js';

/**
 * Scripted adapter for API tests. Steps:
 *   { delta: 'text' }  – emit a delta
 *   { waitMs: 50 }     – sleep (abort-aware)
 *   { hang: true }     – block forever until aborted
 *   { throw: error }   – raise an error
 *
 * Like the real adapter, aborting the signal surfaces as LLMAbortError.
 */
export function createFakeAdapterFactory({ steps = [], usage = null, recordCalls } = {}) {
  return function createAdapter() {
    return {
      provider: 'fake',
      async *streamChat({ signal } = {}) {
        recordCalls?.push({ signal });
        for (const step of steps) {
          assertNotAborted(signal);
          if ('delta' in step) {
            yield { type: 'delta', content: step.delta };
          } else if (step.waitMs) {
            await sleep(step.waitMs, signal);
          } else if (step.hang) {
            await hangUntilAbort(signal);
          } else if (step.throw) {
            throw step.throw;
          }
        }
        yield {
          type: 'done',
          finishReason: 'stop',
          usage: usage ?? { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        };
      },
    };
  };
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new LLMAbortError();
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LLMAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function hangUntilAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LLMAbortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(new LLMAbortError()), { once: true });
  });
}
