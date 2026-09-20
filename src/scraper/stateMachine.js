/**
 * Explicit State Machine for the Scraping Lifecycle.
 * 
 * CORE STATES:
 * - STARTED: Initialization, correlation assignment, target resolution.
 * - FETCHING: Browser session allocation, page navigation, trap neutralization.
 * - EXTRACTING: Mouse movement telemetry, dwell verification, DOM content parsing.
 * - VALIDATING: Strict business schema verification (price > 0, valid stock).
 * - SUCCESS: Atomic database write (price history + log), successful completion.
 * - RETRYING: Transient failure caught; calculating exponential backoff and sleeping.
 * - FAILED: Permanent failure reached (retries exhausted or non-retryable error).
 */

const ScrapeStates = Object.freeze({
  STARTED: 'STARTED',
  FETCHING: 'FETCHING',
  EXTRACTING: 'EXTRACTING',
  VALIDATING: 'VALIDATING',
  SUCCESS: 'SUCCESS',
  RETRYING: 'RETRYING',
  FAILED: 'FAILED'
});

class ScraperStateMachine {
  /**
   * @param {object} context
   * @param {string|number} context.productId
   * @param {string} context.correlationId
   * @param {import('./logger').StructuredLogger} [context.logger]
   */
  constructor(context) {
    this.productId = context.productId;
    this.correlationId = context.correlationId || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.logger = context.logger;
    this.currentState = ScrapeStates.STARTED;
    this.history = [];
    this.stateStartTime = Date.now();
    this.createdAt = new Date().toISOString();

    this._recordInitialState();
  }

  _recordInitialState() {
    this.history.push({
      state: ScrapeStates.STARTED,
      timestamp: this.createdAt,
      durationMs: 0,
      details: {}
    });
    if (this.logger) {
      this.logger.info('SCRAPE_STARTED', {
        correlationId: this.correlationId,
        productId: this.productId,
        state: ScrapeStates.STARTED
      }, `Scrape initiated for product ${this.productId}`);
    }
  }

  /**
   * Transition to a new state with validation and duration measurement.
   * 
   * @param {string} targetState - Must be one of ScrapeStates.
   * @param {object} [details={}] - Contextual details for this transition.
   * @returns {string} The new state.
   */
  transition(targetState, details = {}) {
    if (!Object.values(ScrapeStates).includes(targetState)) {
      throw new Error(`Invalid state transition requested: "${targetState}"`);
    }

    const now = Date.now();
    const durationInPreviousState = now - this.stateStartTime;
    const previousState = this.currentState;

    // Disallow transitions out of terminal states
    if (previousState === ScrapeStates.SUCCESS || previousState === ScrapeStates.FAILED) {
      throw new Error(`Cannot transition from terminal state ${previousState} to ${targetState}`);
    }

    this.currentState = targetState;
    this.stateStartTime = now;

    const record = {
      fromState: previousState,
      toState: targetState,
      timestamp: new Date().toISOString(),
      durationMs: durationInPreviousState,
      details
    };
    this.history.push(record);

    // Emit structured logs for transitions
    if (this.logger) {
      const logContext = {
        correlationId: this.correlationId,
        productId: this.productId,
        state: targetState,
        durationMs: durationInPreviousState,
        ...details
      };

      switch (targetState) {
        case ScrapeStates.FETCHING:
          this.logger.info('FETCHING_STARTED', logContext, 'Allocating browser and navigating to page');
          break;
        case ScrapeStates.EXTRACTING:
          this.logger.info('FETCH_SUCCESS', logContext, 'Page loaded; beginning interaction and extraction');
          break;
        case ScrapeStates.VALIDATING:
          this.logger.info('EXTRACTION_SUCCESS', logContext, 'Raw content extracted; executing validation gate');
          break;
        case ScrapeStates.SUCCESS:
          this.logger.info('VALIDATION_SUCCESS', logContext, 'Data validated; persistence completed');
          this.logger.info('SCRAPE_SUCCESS', logContext, `Successfully scraped product ${this.productId}`);
          break;
        case ScrapeStates.RETRYING:
          this.logger.warn('RETRYING', logContext, `Attempt failed; backing off before next attempt. Reason: ${details.errorMessage}`);
          break;
        case ScrapeStates.FAILED:
          this.logger.error('SCRAPE_FAILED', logContext, `Scrape permanently failed. Reason: ${details.errorMessage}`);
          break;
      }
    }

    return targetState;
  }

  /**
   * Returns snapshot of state history.
   */
  getSummary() {
    return {
      correlationId: this.correlationId,
      productId: this.productId,
      finalState: this.currentState,
      transitionsCount: this.history.length,
      history: this.history
    };
  }
}

module.exports = {
  ScrapeStates,
  ScraperStateMachine
};
