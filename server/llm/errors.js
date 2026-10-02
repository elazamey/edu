// Error hierarchy for LLM adapters. All adapter failures surface as one of
// these so callers (execution service, routes) can map them to run statuses
// without string matching.

export class LLMError extends Error {
  constructor(message, { status, code = 'llm_error', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LLMError';
    this.code = code;
    this.status = status ?? null;
  }
}

export class LLMConfigurationError extends LLMError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'LLMConfigurationError';
    this.code = options.code ?? 'llm_configuration_error';
  }
}

/** The request was aborted by the caller (user abort or client disconnect). */
export class LLMAbortError extends LLMError {
  constructor(message = 'LLM request aborted', options = {}) {
    super(message, options);
    this.name = 'LLMAbortError';
    this.code = 'aborted';
  }
}

/** The request exceeded the configured adapter timeout. */
export class LLMTimeoutError extends LLMError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'LLMTimeoutError';
    this.code = 'timeout';
  }
}

/** True when the thrown value represents a user/caller-initiated abort. */
export function isAbortError(error) {
  return (
    error instanceof LLMAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
