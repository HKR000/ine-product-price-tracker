/**
 * Interaction Subsystem for Overcoming Intentional Storefront Hurdles.
 * 
 * DESIGN PRINCIPLES:
 * 1. Telemetry Threshold Satisfaction: The mock store's client bundle enforces:
 *    - minMoves: 8 mouse movement events
 *    - minInterval: 40ms (kr) between moves
 *    - minDwellMs: 600ms dwell time before button unlocks
 *    This module dispatches a deterministic, realistic trajectory to unlock the button.
 * 2. Click-Drop Resilience: The store randomly drops 17.5% of clicks (via `Xn`);
 *    this module detects if the price block remains in `price-idle` and dispatches follow-up clicks.
 * 3. Error-State Recovery: If the store injects an intermittent failure ("Try again"),
 *    it triggers retry handling.
 */

const { InteractionTimeoutError, TrapInterferenceError, UpstreamHttpError } = require('./errors');

class Interactor {
  /**
   * @param {object} [options]
   * @param {number} [options.resolutionTimeoutMs=15000] - Max time to wait for price-success.
   */
  constructor(options = {}) {
    this.resolutionTimeoutMs = options.resolutionTimeoutMs ?? 15000;
  }

  /**
   * Interacts with the price container, unlocks the reveal button, and waits for price resolution.
   * 
   * @param {import('playwright').Page} page
   * @returns {Promise<{ resolved: boolean, state: 'success'|'error', attemptsInDom: number }>}
   */
  async revealPrice(page) {
    const priceBlock = page.locator('.price-block');
    await priceBlock.waitFor({ state: 'visible', timeout: 8000 });

    const box = await priceBlock.boundingBox();
    if (!box) {
      throw new InteractionTimeoutError('Unable to determine price-block bounding box for mouse interaction');
    }

    // 1. Hover into price container
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.waitForTimeout(100);

    // 2. Generate 14 distinct mouse moves spaced by 60ms (> 40ms requirement)
    for (let i = 0; i < 14; i++) {
      const x = box.x + 30 + (i % 6) * 20;
      const y = box.y + 30 + Math.floor(i / 6) * 10;
      await page.mouse.move(x, y);
      await page.waitForTimeout(60);
    }

    // 3. Enforce dwell duration (> 600ms requirement)
    await page.waitForTimeout(800);

    // 4. Check if Reveal button is enabled
    const revealBtn = page.locator('button[aria-label="Reveal price"]');
    const isVisible = await revealBtn.isVisible().catch(() => false);

    if (isVisible) {
      const isDisabled = await revealBtn.isDisabled().catch(() => false);
      if (isDisabled) {
        // If still disabled, perform an extra burst of movements
        for (let j = 0; j < 10; j++) {
          await page.mouse.move(box.x + 40 + j * 10, box.y + 35);
          await page.waitForTimeout(50);
        }
        await page.waitForTimeout(650);
      }

      // 5. Click the Reveal button
      await revealBtn.click({ timeout: 5000 }).catch(err => {
        if (/intercepts pointer events/i.test(err.message)) {
          throw new TrapInterferenceError('Overlay intercepted click on reveal button');
        }
        throw err;
      });

      // 6. Click-Drop Recovery: Store drops clicks randomly (via Xn function in bundle)
      // Check if button is still present in idle state after 1200ms; if so, re-click
      await page.waitForTimeout(1200);
      const stillIdle = await page.locator('.price-block.price-idle').count();
      if (stillIdle > 0 && await revealBtn.isVisible()) {
        await revealBtn.click({ timeout: 3000 }).catch(() => {});
      }
    }

    // 7. Wait for outcome: .price-success OR .price-error
    const startTime = Date.now();
    while (Date.now() - startTime < this.resolutionTimeoutMs) {
      // Check if price successfully rendered
      const isSuccess = await page.locator('.price-block.price-success').count();
      if (isSuccess > 0) {
        return { resolved: true, state: 'success', attemptsInDom: 1 };
      }

      // Check if click was dropped and button remains idle
      const isIdle = await page.locator('.price-block.price-idle').count();
      if (isIdle > 0 && await revealBtn.isVisible()) {
        const isDisabled = await revealBtn.isDisabled().catch(() => false);
        if (!isDisabled) {
          await revealBtn.click({ timeout: 2000 }).catch(() => {});
        } else {
          for (let m = 0; m < 8; m++) {
            await page.mouse.move(box.x + 35 + m * 15, box.y + 35);
            await page.waitForTimeout(50);
          }
          await page.waitForTimeout(650);
          await revealBtn.click({ timeout: 2000 }).catch(() => {});
        }
      }

      // Check if the store returned an in-page error (e.g. upstream 503 or challenge failed)
      const tryAgainBtn = page.locator('button:has-text("Try again")');
      if (await tryAgainBtn.isVisible()) {
        const errorText = await page.locator('.price-block').innerText().catch(() => '');
        if (/upstream_error/i.test(errorText) || /503/i.test(errorText)) {
          throw new UpstreamHttpError(503, 'Mock store returned upstream_error on price calculation');
        }
        // Try again in-page once
        await page.mouse.move(box.x + 30, box.y + 30);
        await page.waitForTimeout(100);
        for (let k = 0; k < 10; k++) {
          await page.mouse.move(box.x + 30 + k * 10, box.y + 30);
          await page.waitForTimeout(50);
        }
        await tryAgainBtn.click().catch(() => {});
      }

      await page.waitForTimeout(600);
    }

    throw new InteractionTimeoutError(`Price did not resolve within ${this.resolutionTimeoutMs}ms`);
  }
}

module.exports = {
  Interactor
};
