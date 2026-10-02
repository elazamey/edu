import { LLMAbortError, LLMTimeoutError } from '../llm/errors.js';

/**
 * Orchestrates agent runs: persists the run row, streams adapter events as
 * normalized execution events, and owns the abort registry.
 *
 * Event contract (consumed by the SSE route):
 *   { event: 'run.started',   data: { run } }
 *   { event: 'run.delta',     data: { content } }
 *   { event: 'run.completed', data: { run } }
 *   { event: 'run.failed',    data: { run } }   // run.error holds the message
 *   { event: 'run.aborted',   data: { run } }
 *   { event: 'run.timeout',   data: { run } }
 *
 * Every path finalizes the run row exactly once before the generator ends.
 */
export class ExecutionService {
  /**
   * @param {object} deps
   * @param {import('../repositories/runRepository.js').RunRepository} deps.runRepository
   * @param {() => { streamChat: Function }} deps.createAdapter
   * @param {object} [deps.llmConfig] Recorded on runs (provider/model).
   */
  constructor({ runRepository, createAdapter, llmConfig = null }) {
    if (!runRepository) throw new TypeError('runRepository is required');
    if (typeof createAdapter !== 'function') throw new TypeError('createAdapter is required');
    this.runRepository = runRepository;
    this.createAdapter = createAdapter;
    this.llmConfig = llmConfig;
    /** @type {Map<string, AbortController>} */
    this.controllers = new Map();
  }

  /**
   * Start a run. Returns immediately with the persisted run plus an async
   * iterator of execution events.
   */
  start({ session, prompt }) {
    const run = this.runRepository.create({
      sessionId: session.id,
      prompt,
      provider: this.llmConfig?.provider ?? null,
      model: this.llmConfig?.model ?? null,
    });
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    return {
      run,
      controller,
      events: this.#execute(run, controller, prompt),
    };
  }

  /**
   * Abort an active run. Returns false when the run is unknown or already
   * finished.
   */
  abort(runId) {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  isActive(runId) {
    return this.controllers.has(runId);
  }

  async *#execute(run, controller, prompt) {
    yield { event: 'run.started', data: { run } };

    let output = '';
    let usage = null;
    try {
      const adapter = this.createAdapter();
      const messages = [{ role: 'user', content: prompt }];
      for await (const event of adapter.streamChat({
        messages,
        temperature: this.llmConfig?.temperature,
        maxTokens: this.llmConfig?.maxTokens,
        signal: controller.signal,
      })) {
        if (event.type === 'delta') {
          output += event.content;
          yield { event: 'run.delta', data: { content: event.content } };
        } else if (event.type === 'done') {
          usage = event.usage ?? null;
        }
      }
      const finished = this.#finish(run.id, { status: 'completed', output, usage });
      yield { event: 'run.completed', data: { run: finished } };
    } catch (error) {
      const { status, event } = classifyError(error);
      const finished = this.#finish(run.id, {
        status,
        output: output || null,
        error: status === 'completed' ? null : (error?.message ?? 'Unknown error'),
      });
      yield { event, data: { run: finished } };
    } finally {
      this.controllers.delete(run.id);
    }
  }

  #finish(runId, fields) {
    // `finish()` returns null when the row is already terminal (e.g. a race
    // between abort and completion); fall back to the stored row.
    return this.runRepository.finish(runId, fields) ?? this.runRepository.findById(runId);
  }
}

function classifyError(error) {
  if (error instanceof LLMTimeoutError) return { status: 'timeout', event: 'run.timeout' };
  if (error instanceof LLMAbortError) return { status: 'aborted', event: 'run.aborted' };
  return { status: 'failed', event: 'run.failed' };
}
