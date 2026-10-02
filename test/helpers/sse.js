// Minimal SSE client used by API tests to consume execution streams.

export async function* sseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event) yield event;
    }
  }
}

function parseFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join('\n')) };
}

/**
 * Consume the stream until one of `terminalEvents` is seen (inclusive).
 * Returns all collected events and the terminal one.
 */
export async function collectUntil(response, terminalEvents) {
  const events = [];
  let terminal = null;
  for await (const event of sseEvents(response)) {
    events.push(event);
    if (terminalEvents.includes(event.event)) {
      terminal = event;
      break;
    }
  }
  return { events, terminal };
}

/** Wait until `predicate()` returns truthy, polling every 25ms. */
export async function waitFor(predicate, { timeoutMs = 3_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
