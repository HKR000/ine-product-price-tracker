const { describe, it } = require('node:test');
const assert = require('node:assert');
const { RetryPolicy } = require('../../src/scraper/retryPolicy');
const {
  NavigationTimeoutError,
  UpstreamHttpError,
  RateLimitedError,
  ValidationError
} = require('../../src/scraper/errors');

describe('RetryPolicy Subsystem', () => {
  const policy = new RetryPolicy({
    maxAttempts: 3,
    baseDelayMs: 1000,
    backoffFactor: 2,
    maxDelayMs: 8000,
    enableJitter: false // deterministic for math testing
  });

  describe('isRetryable', () => {
    it('classifies 503 UpstreamHttpError as retryable', () => {
      const err = new UpstreamHttpError(503, 'Upstream error');
      assert.strictEqual(policy.isRetryable(err), true);
    });

    it('classifies 429 RateLimitedError as retryable', () => {
      const err = new RateLimitedError(3);
      assert.strictEqual(policy.isRetryable(err), true);
    });

    it('classifies NavigationTimeoutError as retryable', () => {
      const err = new NavigationTimeoutError('Timed out');
      assert.strictEqual(policy.isRetryable(err), true);
    });

    it('classifies 404 UpstreamHttpError as NON-RETRYABLE', () => {
      const err = new UpstreamHttpError(404, 'Product not found');
      assert.strictEqual(policy.isRetryable(err), false);
    });

    it('classifies ValidationError as NON-RETRYABLE', () => {
      const err = new ValidationError('Price is zero');
      assert.strictEqual(policy.isRetryable(err), false);
    });

    it('classifies Node.js transient network codes as retryable', () => {
      const err = new Error('Connection reset');
      err.code = 'ECONNRESET';
      assert.strictEqual(policy.isRetryable(err), true);
    });
  });

  describe('calculateDelay', () => {
    it('calculates exponential backoff progression accurately', () => {
      assert.strictEqual(policy.calculateDelay(1), 1000); // 1000 * 2^0
      assert.strictEqual(policy.calculateDelay(2), 2000); // 1000 * 2^1
      assert.strictEqual(policy.calculateDelay(3), 4000); // 1000 * 2^2
      assert.strictEqual(policy.calculateDelay(4), 8000); // capped at maxDelayMs
    });

    it('respects retryAfterSeconds when provided on 429 errors', () => {
      const rateLimitErr = new RateLimitedError(5);
      assert.strictEqual(policy.calculateDelay(1, rateLimitErr), 5000);
    });

    it('applies randomized jitter when enabled', () => {
      const jitterPolicy = new RetryPolicy({
        baseDelayMs: 1000,
        enableJitter: true
      });
      const delay = jitterPolicy.calculateDelay(1);
      // Jitter is between 0.8 and 1.2 of base delay (800 to 1200)
      assert.ok(delay >= 800 && delay <= 1200, `Delay ${delay} within jitter range`);
    });
  });
});
