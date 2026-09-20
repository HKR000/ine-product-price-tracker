/**
 * Controlled Browser Lifecycle Manager (Browser Pool).
 * 
 * DESIGN PRINCIPLES:
 * 1. Single Shared Browser Instance: Launching Chromium takes 1-2 seconds and 100MB+ RAM.
 *    Re-using a single browser instance avoids spin-up overhead.
 * 2. Isolated Ephemeral Contexts: Each scrape uses an independent `BrowserContext` (like Incognito)
 *    and closes it immediately in `finally` blocks, preventing memory leaks on Render's 512MB RAM.
 * 3. Headed & Headless Flexibility: Fully supports `headed: true` with `slowMo` for observable runs
 *    and video recordings.
 * 4. Render/Container Optimization: Launches with flags critical for constrained environments.
 */

const { chromium } = require('playwright');

class BrowserPool {
  constructor() {
    /** @type {import('playwright').Browser|null} */
    this._browser = null;
    this._isLaunching = false;
    this._launchPromise = null;
    this._isHeaded = null;
  }

  /**
   * Returns the shared browser instance, launching it if not currently running.
   * 
   * @param {object} [options]
   * @param {boolean} [options.headed=false] - If true, runs visible browser window.
   * @param {number} [options.slowMo=0] - Slows down operations by ms for demonstration.
   * @returns {Promise<import('playwright').Browser>}
   */
  async getBrowser(options = {}) {
    const headed = options.headed ?? false;
    const slowMo = options.slowMo ?? (headed ? 400 : 0);

    // If browser disconnected unexpectedly (crash), clear reference
    if (this._browser && !this._browser.isConnected()) {
      this._browser = null;
    }

    // If browser is already open and matches headed requirement, re-use
    if (this._browser && this._browser.isConnected()) {
      if (this._isHeaded === headed) {
        return this._browser;
      }
      await this.closeAll();
    }

    if (this._isLaunching && this._launchPromise) {
      return this._launchPromise;
    }

    this._isLaunching = true;
    this._launchPromise = (async () => {
      try {
        this._isHeaded = headed;
        this._browser = await chromium.launch({
          headless: !headed,
          slowMo,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Critical for Docker / Render 512MB RAM
            '--no-first-run',
            '--no-zygote'
          ]
        });

        this._browser.on('disconnected', () => {
          this._browser = null;
          this._isHeaded = null;
        });

        return this._browser;
      } finally {
        this._isLaunching = false;
        this._launchPromise = null;
      }
    })();

    return this._launchPromise;
  }

  /**
   * Spawns an isolated BrowserContext with standard desktop viewport and realistic User-Agent.
   * 
   * @param {object} [options]
   * @param {boolean} [options.headed=false]
   * @returns {Promise<{ context: import('playwright').BrowserContext, page: import('playwright').Page }>}
   */
  async createSession(options = {}) {
    const browser = await this.getBrowser(options);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      deviceScaleFactor: 1
    });

    const page = await context.newPage();
    return { context, page };
  }

  /**
   * Gracefully shuts down the browser and all associated processes.
   */
  async closeAll() {
    if (this._browser && this._browser.isConnected()) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}

// Export singleton instance
const defaultBrowserPool = new BrowserPool();

module.exports = {
  BrowserPool,
  defaultBrowserPool
};
