/**
 * Page Navigation and Environment Hardening.
 * 
 * DESIGN PRINCIPLES:
 * 1. Proactive Trap Neutralization: Injects CSS rules before scripts execute to ensure
 *    adversarial cookie popups never obscure buttons or intercept mouse pointer events.
 * 2. Strict HTTP Status Interception: Catches 404/5xx responses immediately rather than
 *    waiting 15 seconds for selectors to fail.
 * 3. Explicit Timeouts: Enforces strict navigation timeouts so slow connections fail fast.
 */

const { NavigationTimeoutError, UpstreamHttpError } = require('./errors');

class Navigator {
  /**
   * @param {object} [options]
   * @param {number} [options.navigationTimeoutMs=15000]
   */
  constructor(options = {}) {
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 15000;
  }

  /**
   * Navigates to the product page, neutralizes traps, and confirms base DOM readiness.
   * 
   * @param {import('playwright').Page} page
   * @param {string} targetUrl - Full URL to product detail page.
   * @returns {Promise<{ httpStatusCode: number }>}
   */
  async navigateToProduct(page, targetUrl) {
    let mainResponseStatus = 200;

    // Track main document response
    page.on('response', res => {
      if (res.url() === targetUrl || res.url().startsWith(targetUrl)) {
        mainResponseStatus = res.status();
      }
    });

    try {
      // 1. Navigate with explicit timeout
      const response = await page.goto(targetUrl, {
        timeout: this.navigationTimeoutMs,
        waitUntil: 'domcontentloaded'
      });

      if (response) {
        mainResponseStatus = response.status();
      }

      // 2. Immediate check for HTTP failures
      if (mainResponseStatus === 404) {
        throw new UpstreamHttpError(404, `Product page not found (404) at: ${targetUrl}`);
      }
      if (mainResponseStatus >= 500) {
        throw new UpstreamHttpError(mainResponseStatus, `Upstream server error (${mainResponseStatus}) at: ${targetUrl}`);
      }

      // 3. Trap Neutralization: Suppress cookie overlays from popping up and intercepting pointer clicks
      await page.addStyleTag({
        content: `
          .cookie-overlay, [aria-label="Cookie consent"] {
            display: none !important;
            pointer-events: none !important;
          }
          body {
            overflow: auto !important;
          }
        `
      }).catch(() => {});

      // 4. Ensure basic DOM root and price block are present
      await page.waitForSelector('.price-block, #root', {
        timeout: 5000,
        state: 'attached'
      });

      return { httpStatusCode: mainResponseStatus };
    } catch (err) {
      if (err instanceof UpstreamHttpError) {
        throw err;
      }
      if (err.name === 'TimeoutError' || /timeout/i.test(err.message)) {
        throw new NavigationTimeoutError(`Timed out navigating to ${targetUrl} after ${this.navigationTimeoutMs}ms`, { targetUrl });
      }
      throw err;
    }
  }
}

module.exports = {
  Navigator
};
