/**
 * Custom Error Hierarchy for the Scraping Subsystem.
 * 
 * Every error classifies:
 * 1. errorCode: Machine-readable uppercase identifier (e.g. 'TIMEOUT_NAVIGATION', 'VALIDATION_FAILED').
 * 2. isRetryable: Boolean flag determining whether the RetryPolicy should attempt another run.
 * 3. httpStatusCode: Optional HTTP response code if error was caused by a network response.
 * 4. details: Optional contextual debugging object.
 */

class ScraperBaseError extends Error {
  /**
   * @param {string} message - Human-readable error description.
   * @param {string} errorCode - Structured machine-readable code.
   * @param {boolean} isRetryable - Whether this failure can be recovered by retrying.
   * @param {number|null} [httpStatusCode=null] - Upstream HTTP status code.
   * @param {object|null} [details=null] - Additional contextual diagnostic data.
   */
  constructor(message, errorCode = 'SCRAPER_ERROR', isRetryable = false, httpStatusCode = null, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.isRetryable = isRetryable;
    this.httpStatusCode = httpStatusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Thrown when page navigation or network response exceeds the configured timeout threshold.
 * Retryable: Transient network congestion or Render cold-start latency.
 */
class NavigationTimeoutError extends ScraperBaseError {
  constructor(message, details = null) {
    super(message || 'Page navigation timed out', 'TIMEOUT_NAVIGATION', true, 408, details);
  }
}

/**
 * Thrown when an upstream HTTP request returns an error status code.
 * 5xx errors and 429 are retryable; 404 is non-retryable (product does not exist).
 */
class UpstreamHttpError extends ScraperBaseError {
  constructor(statusCode, message, details = null) {
    const isRetryable = statusCode >= 500 || statusCode === 429 || statusCode === 408;
    const defaultMsg = `Upstream server responded with HTTP ${statusCode}`;
    const code = statusCode === 429 ? 'RATE_LIMITED' : statusCode === 404 ? 'NOT_FOUND' : 'UPSTREAM_HTTP_ERROR';
    super(message || defaultMsg, code, isRetryable, statusCode, details);
  }
}

/**
 * Thrown when rate-limiting is encountered (HTTP 429).
 * Retryable with delay respect.
 */
class RateLimitedError extends ScraperBaseError {
  constructor(retryAfterSeconds = 2, message = null) {
    super(
      message || `Rate limit exceeded. Retry after ${retryAfterSeconds}s`,
      'RATE_LIMITED',
      true,
      429,
      { retryAfterSeconds }
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown when simulated mouse interactions or reveal button clicks time out or fail to alter page state.
 * Retryable: Can occur due to artificial click-dropping (Xn) or timing drift.
 */
class InteractionTimeoutError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Timed out waiting for interaction state transition (price reveal)',
      'TIMEOUT_INTERACTION',
      true,
      null,
      details
    );
  }
}

/**
 * Thrown when an overlay (e.g. random cookie banner) intercepts clicks and cannot be automatically dismissed.
 * Retryable: Retrying with immediate DOM suppression neutralizes it.
 */
class TrapInterferenceError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Interaction intercepted by adversarial modal overlay',
      'TRAP_INTERFERENCE',
      true,
      null,
      details
    );
  }
}

/**
 * Thrown when the price element is missing from the resolved DOM or cannot be extracted.
 * Retryable only if page failed to reach success state.
 */
class MissingPriceError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Price element was not found in the resolved DOM',
      'MISSING_PRICE',
      false,
      null,
      details
    );
  }
}

/**
 * Thrown when stock badge/text is completely absent or unparseable.
 */
class MissingStockError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Stock availability element was not found in the resolved DOM',
      'MISSING_STOCK',
      false,
      null,
      details
    );
  }
}

/**
 * Thrown when extracted data fails strict business validation rules (e.g. price <= 0, NaN, fake status).
 * NON-RETRYABLE: Prevents garbage data from ever reaching the database.
 */
class ValidationError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Extracted data failed strict validation rules',
      'VALIDATION_FAILED',
      false,
      null,
      details
    );
  }
}

/**
 * Thrown when the DOM structure is radically corrupt or unrecognizable (e.g. store layout rewrite).
 */
class CorruptDomError extends ScraperBaseError {
  constructor(message, details = null) {
    super(
      message || 'Store DOM structure is unrecognizable or corrupt',
      'CORRUPT_DOM',
      false,
      null,
      details
    );
  }
}

module.exports = {
  ScraperBaseError,
  NavigationTimeoutError,
  UpstreamHttpError,
  RateLimitedError,
  InteractionTimeoutError,
  TrapInterferenceError,
  MissingPriceError,
  MissingStockError,
  ValidationError,
  CorruptDomError
};
