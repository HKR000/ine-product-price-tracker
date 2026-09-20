/**
 * Scheduled Cron Jobs & Batch Operations REST Routes.
 * 
 * Target Architecture:
 * cron-job.org (Every 2 hours) -> Render Backend -> POST /api/jobs/scrape-all -> Tracked Products -> Scraper -> Supabase
 * 
 * INVARIANTS:
 * 1. Only authorized scheduler requests can trigger it (X-Cron-Secret header).
 * 2. Scrapes all active tracked products.
 * 3. Individual product failures do NOT terminate the batch.
 * 4. Each product produces its own scrape log.
 * 5. Returns a structured summary: total products, successful, retried, failed, and duration.
 * 6. Concurrency lock prevents overlapping scrape runs (with 15-minute stale auto-expiry).
 */

const express = require('express');
const { requireCronSecret } = require('../middleware/auth');
const { defaultProductService } = require('../services/productService');
const { ScraperEngine } = require('../scraper/scraperEngine');
const { SupabasePersistence } = require('../db/supabasePersistence');
const { InMemoryPersistence } = require('../scraper/persistenceInterface');
const { getDbPool } = require('../db/connection');
const { defaultLogger } = require('../scraper/logger');

const router = express.Router();

let isBatchJobRunning = false;
let batchJobStartedAt = null;
let lastBatchSummary = null;
const MAX_BATCH_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max runtime before breaking stale lock

/**
 * GET /api/jobs/status
 * Public status endpoint showing current lock state and previous run summary.
 */
router.get('/jobs/status', (req, res) => {
  const isRunning = isBatchJobRunning && (Date.now() - (batchJobStartedAt || 0) < MAX_BATCH_TIMEOUT_MS);
  const elapsedSeconds = isRunning ? Math.round((Date.now() - batchJobStartedAt) / 1000) : 0;

  res.json({
    status: isRunning ? 'running' : 'idle',
    isRunning,
    runningSince: isRunning ? new Date(batchJobStartedAt).toISOString() : null,
    elapsedSeconds,
    lastRun: lastBatchSummary
  });
});

/**
 * POST /api/jobs/scrape-all
 * Scheduled batch scraping endpoint.
 */
router.post('/jobs/scrape-all', requireCronSecret, async (req, res, next) => {
  const forceReset = req.query.force === 'true' || req.body?.force === true;

  // 1. Concurrency Guard: Prevent overlapping runs
  if (isBatchJobRunning && !forceReset) {
    const elapsed = Date.now() - (batchJobStartedAt || Date.now());
    if (elapsed < MAX_BATCH_TIMEOUT_MS) {
      const elapsedSeconds = Math.round(elapsed / 1000);
      defaultLogger.warn('CRON_OVERLAP_REJECTED', {
        runningSince: new Date(batchJobStartedAt).toISOString(),
        elapsedSeconds
      });

      return res.status(409).json({
        error: {
          code: 'JOB_ALREADY_RUNNING',
          message: `A scheduled scrape batch is already in progress (running for ${elapsedSeconds}s). Overlapping execution rejected.`,
          runningSince: new Date(batchJobStartedAt).toISOString(),
          elapsedSeconds
        }
      });
    } else {
      defaultLogger.warn('CRON_STALE_LOCK_BROKEN', {
        previousStartTime: new Date(batchJobStartedAt).toISOString()
      });
    }
  }

  isBatchJobRunning = true;
  batchJobStartedAt = Date.now();
  const startTime = Date.now();

  defaultLogger.info('CRON_BATCH_STARTED', {
    startedAt: new Date(startTime).toISOString()
  });

  try {
    // 2. Fetch all active tracked products
    const products = await defaultProductService.listTrackedProducts();

    if (products.length === 0) {
      const emptySummary = {
        message: 'No active tracked products to scrape',
        total: 0,
        successful: 0,
        retried: 0,
        failed: 0,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        results: []
      };
      lastBatchSummary = emptySummary;
      return res.json(emptySummary);
    }

    // 3. Configure persistence layer (Supabase PostgreSQL if configured, otherwise memory adapter)
    const pool = getDbPool();
    const persistence = pool ? new SupabasePersistence(pool) : defaultProductService.getPersistenceAdapter();
    const scraper = new ScraperEngine({ persistence });

    const results = [];
    let successfulCount = 0;
    let retriedProductsCount = 0;
    let failedCount = 0;

    // 4. Sequential execution (One failure does NOT terminate the batch)
    for (const product of products) {
      const itemStart = Date.now();
      try {
        const scrapeResult = await scraper.scrape(product.store_product_id, { headed: false });
        const didRetry = (scrapeResult.attempts || 1) > 1;

        if (scrapeResult.success) {
          successfulCount++;
        } else {
          failedCount++;
        }

        if (didRetry) {
          retriedProductsCount++;
        }

        results.push({
          productId: product.store_product_id,
          name: product.name,
          status: scrapeResult.success ? 'success' : 'failed',
          price: scrapeResult.price ?? null,
          stockStatus: scrapeResult.stockStatus ?? null,
          attempts: scrapeResult.attempts,
          retried: didRetry,
          durationMs: scrapeResult.durationMs || (Date.now() - itemStart),
          error: scrapeResult.errorMessage ?? null
        });

      } catch (err) {
        // Individual product failure caught: Batch continues!
        failedCount++;
        defaultLogger.error('CRON_ITEM_UNCAUGHT_ERROR', {
          productId: product.store_product_id,
          error: err.message
        });

        results.push({
          productId: product.store_product_id,
          name: product.name,
          status: 'failed',
          attempts: 1,
          retried: false,
          durationMs: Date.now() - itemStart,
          error: err.message
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      message: `Batch scrape completed: ${successfulCount} successful (${retriedProductsCount} retried), ${failedCount} failed out of ${products.length} total`,
      total: products.length,
      successful: successfulCount,
      retried: retriedProductsCount,
      failed: failedCount,
      durationMs,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      results
    };

    lastBatchSummary = summary;
    defaultLogger.info('CRON_BATCH_COMPLETED', {
      total: products.length,
      successful: successfulCount,
      retried: retriedProductsCount,
      failed: failedCount,
      durationMs
    });

    return res.json(summary);

  } catch (err) {
    defaultLogger.error('CRON_BATCH_FATAL_ERROR', { error: err.message });
    next(err);
  } finally {
    isBatchJobRunning = false;
    batchJobStartedAt = null;
  }
});

module.exports = router;
