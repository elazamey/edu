// Minimal Server-Sent Events helpers for the execution endpoint.

export function initSSE(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();
}

/** Write one SSE event. Returns false when the socket is already gone. */
export function sendSSE(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

export function closeSSE(res) {
  if (!res.writableEnded) res.end();
}

/** Periodic comment frame to keep proxies from dropping idle streams. */
export function startHeartbeat(res, intervalMs = 15_000) {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    res.write(': keep-alive\n\n');
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopHeartbeat(timer) {
  if (timer) clearInterval(timer);
}
