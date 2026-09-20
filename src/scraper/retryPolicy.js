/**
 * Intelligent Retry Policy with Explicit Error Classification and Exponential Backoff.
 * 
 * CORE RELIABILITY RULES:
 * 1. Retry candidates:
 *    - network timeout
 *    - temporary connection failure
 *    - temporary server error (500, 502, 503, 504)
 *    - rate limiting (429)
 *    - browser navigation timeout
 *    - interaction / click-drop delays
 * 
 * 2. Non-retryable (DO NOT blindly retry everything):
 *    - product not found (404)
 *    - invalid product URL or ID
 *    - required price element genuinely absent
 *    - required stock element genuinely absent
 *    - malformed product data (ValidationError)
 *    - structural page change (CorruptDomError)
 */

const {
  ScraperBaseError,
  ValidationError,
  MissingPriceError,
  MissingStockError,
  CorruptDomError,
  UpstreamHttpError,
  RateLimitedError,
  NavigationTimeoutError,
  InteractionTimeoutError,
  TrapInterferenceError
} = require('./errors');

class RetryPolicy {
  /**
   * @param {object} [options]
   * @param {number} [options.maxAttempts=3] - Maximum execution attempts per scrape cycle.
   * @param {number} [options.baseDelayMs=1500] - Initial backoff duration.
   * @param {number} [options.backoffFactor=2] - Exponential multiplier.
   * @param {number} [options.maxDelayMs=10000] - Ceiling delay.
   * @param {boolean} [options.enableJitter=true] - Applies +/- 20% randomization.
   */
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1500;
    this.backoffFactor = options.backoffFactor ?? 2;
    this.maxDelayMs = options.maxDelayMs ?? 10000;
    this.enableJitter = options.enableJitter ?? true;
  }

  /**
   * Classifies an error into a detailed diagnostic categorization.
   * 
   * @param {Error} error
   * @returns {{ isRetryable: boolean, category: 'RETRY_CANDIDATE'|'NON_RETRYABLE', reason: string }}
   */
  classifyError(error) {
    if (!error) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'No error provided' };
    }

    // --- NON-RETRYABLE CATEGORIES ---

    // 1. Data validation failures (malformed data, price <= 0, NaN)
    if (error instanceof ValidationError) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'Malformed product data or validation constraint violation' };
    }

    // 2. HTTP 404 Not Found
    if (error instanceof UpstreamHttpError && error.httpStatusCode === 404) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'Product does not exist on storefront (404)' };
    }

    // 3. Required price element genuinely absent
    if (error instanceof MissingPriceError || error.name === 'MissingPriceError' || error.errorCode === 'MISSING_PRICE' || /MissingPrice/i.test(error.message) || /No visible, non-decoy selling price/i.test(error.message)) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'Required price element genuinely absent in DOM' };
    }

    // 4. Required stock element genuinely absent
    if (error instanceof MissingStockError || error.name === 'MissingStockError' || error.errorCode === 'MISSING_STOCK' || /MissingStock/i.test(error.message) || /stock-badge element found/i.test(error.message)) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'Required stock element genuinely absent in DOM' };
    }

    // 5. Structural page change
    if (error instanceof CorruptDomError || error.name === 'CorruptDomError' || error.errorCode === 'CORRUPT_DOM' || /CorruptDom/i.test(error.message) || /price-block\.price-success in DOM/i.test(error.message)) {
      return { isRetryable: false, category: 'NON_RETRYABLE', reason: 'Structural page change detected; DOM unrecognizable' };
    }

    // --- RETRY CANDIDATE CATEGORIES ---

    // 6. Navigation timeout
    if (error instanceof NavigationTimeoutError) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: 'Browser navigation timeout' };
    }

    // 7. Temporary server errors (500, 502, 503, 504)
    if (error instanceof UpstreamHttpError && error.httpStatusCode >= 500) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: `Temporary upstream server error (${error.httpStatusCode})` };
    }

    // 8. Rate limiting (429)
    if (error instanceof RateLimitedError || (error instanceof UpstreamHttpError && error.httpStatusCode === 429)) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: 'Rate limited by gateway (429)' };
    }

    // 9. Interaction delay or click-drop
    if (error instanceof InteractionTimeoutError || error instanceof TrapInterferenceError) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: 'Transient interaction delay or click-drop trap' };
    }

    // 10. Node.js low-level socket/connection drops
    const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENOTFOUND'];
    if (transientCodes.includes(error.code)) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: `Temporary connection failure (${error.code})` };
    }

    // 11. Playwright TimeoutError
    if (error.name === 'TimeoutError' || /timeout/i.test(error.message)) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: 'Playwright locator or action timeout' };
    }

    // 12. Browser crash / target closed / unexpected process termination
    if (
      /Target page, context or browser has been closed/i.test(error.message) ||
      /Target closed/i.test(error.message) ||
      /browser has been disconnected/i.test(error.message) ||
      /Browser closed/i.test(error.message) ||
      /Crash/i.test(error.name || '') ||
      /Protocol error/i.test(error.message)
    ) {
      return { isRetryable: true, category: 'RETRY_CANDIDATE', reason: 'Browser process crashed or disconnected' };
    }

    // Default fallback based on ScraperBaseError flag if available
    if (error instanceof ScraperBaseError) {
      return {
        isRetryable: error.isRetryable,
        category: error.isRetryable ? 'RETRY_CANDIDATE' : 'NON_RETRYABLE',
        reason: error.message
      };
    }

    return { isRetryable: false, category: 'NON_RETRYABLE', reason: `Unclassified non-retryable exception: ${error.message}` };
  }

  /**
   * Helper determining retry eligibility.
   * 
   * @param {Error} error
   * @returns {boolean}
   */
  isRetryable(error) {
    return this.classifyError(error).isRetryable;
  }

  /**
   * Calculates the delay in milliseconds before the next attempt.
   * 
   * @param {number} attemptNumber - 1-indexed attempt number that just failed.
   * @param {Error} [error] - Error that caused the failure.
   * @returns {number} Delay in milliseconds.
   */
  calculateDelay(attemptNumber, error = null) {
    if (error?.retryAfterSeconds) {
      return Math.max(1000, error.retryAfterSeconds * 1000);
    }

    const exponent = Math.max(0, attemptNumber - 1);
    let delay = this.baseDelayMs * Math.pow(this.backoffFactor, exponent);
    delay = Math.min(delay, this.maxDelayMs);

    if (this.enableJitter) {
      const jitterFactor = 0.8 + Math.random() * 0.4;
      delay = Math.round(delay * jitterFactor);
    }

    return delay;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  RetryPolicy
};
