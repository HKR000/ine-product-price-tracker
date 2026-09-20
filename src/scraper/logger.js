/**
 * Structured Logging Subsystem for Production & Render Deployment.
 * 
 * DESIGN PRINCIPLES:
 * 1. Dual Format Support: Human-readable colorized output for local/headed CLI,
 *    and structured JSON logs for cloud log collectors (Render/Datadog).
 * 2. Correlation Tracking: Every scrape run has a unique correlationId across all attempts.
 * 3. Log Levels: INFO, WARN, ERROR, DEBUG.
 * 4. Audit Transparency: Every state transition and failure reason is logged with full context.
 */

class StructuredLogger {
  /**
   * @param {object} [options]
   * @param {boolean} [options.jsonMode=false] - Whether to emit JSON strings.
   * @param {string} [options.minLevel='INFO'] - Minimum log level to emit.
   */
  constructor(options = {}) {
    this.jsonMode = options.jsonMode ?? (process.env.NODE_ENV === 'production');
    this.minLevel = options.minLevel ?? 'INFO';
    this.levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    this.inMemoryLogs = [];
  }

  _shouldLog(level) {
    return (this.levels[level] ?? 1) >= (this.levels[this.minLevel] ?? 1);
  }

  /**
   * Formats and emits a structured log event.
   * 
   * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
   * @param {string} event - Canonical event name (e.g. 'SCRAPE_STARTED', 'FETCH_SUCCESS').
   * @param {object} context - Contextual metadata (correlationId, productId, attempt, state, etc.)
   * @param {string} [message]
   */
  log(level, event, context = {}, message = '') {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message: message || event,
      ...context
    };

    this.inMemoryLogs.push(entry);

    if (!this._shouldLog(level)) return;

    if (this.jsonMode) {
      console.log(JSON.stringify(entry));
    } else {
      const pId = context.productId ? `[Product ${context.productId}]` : '';
      const attempt = context.attemptNumber ? `(Attempt ${context.attemptNumber})` : '';
      const state = context.state ? `[${context.state}]` : '';
      const duration = context.durationMs !== undefined ? `${context.durationMs}ms` : '';
      const prefix = `${entry.timestamp} [${level}] ${state} ${pId} ${attempt}`.replace(/\s+/g, ' ').trim();
      const meta = Object.keys(context).length > 0 && !this._isEmptyContext(context) 
        ? `| ${JSON.stringify(this._sanitizeContext(context))}` 
        : '';

      const logLine = `${prefix} -> ${event}: ${message || ''} ${duration} ${meta}`.trim();

      if (level === 'ERROR') {
        console.error(logLine);
      } else if (level === 'WARN') {
        console.warn(logLine);
      } else {
        console.log(logLine);
      }
    }
  }

  _isEmptyContext(ctx) {
    const ignored = ['productId', 'attemptNumber', 'state', 'correlationId', 'durationMs'];
    const keys = Object.keys(ctx).filter(k => !ignored.includes(k));
    return keys.length === 0;
  }

  _sanitizeContext(ctx) {
    const copy = { ...ctx };
    delete copy.productId;
    delete copy.attemptNumber;
    delete copy.state;
    delete copy.correlationId;
    delete copy.durationMs;
    return copy;
  }

  info(event, context, message) { this.log('INFO', event, context, message); }
  warn(event, context, message) { this.log('WARN', event, context, message); }
  error(event, context, message) { this.log('ERROR', event, context, message); }
  debug(event, context, message) { this.log('DEBUG', event, context, message); }

  clear() {
    this.inMemoryLogs = [];
  }
}

module.exports = {
  StructuredLogger,
  defaultLogger: new StructuredLogger()
};
