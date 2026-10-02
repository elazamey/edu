function write(level, message, metadata = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  })}\n`);
}

export const logger = {
  info: (message, metadata) => write('info', message, metadata),
  error: (message, metadata) => write('error', message, metadata),
};
