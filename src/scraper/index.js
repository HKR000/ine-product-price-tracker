/**
 * Public API for the Scraping Subsystem.
 */

const { ScraperEngine, defaultScraper } = require('./scraperEngine');
const { BrowserPool, defaultBrowserPool } = require('./browserPool');
const { Navigator } = require('./navigator');
const { Interactor } = require('./interactor');
const { extractFromDom, extractFromPage } = require('./extractor');
const { cleanText, normalizePrice, normalizeCurrency, normalizeStock } = require('./normalizer');
const { validateScrapedProduct } = require('./validator');
const { RetryPolicy } = require('./retryPolicy');
const { ScrapeStates, ScraperStateMachine } = require('./stateMachine');
const { StructuredLogger, defaultLogger } = require('./logger');
const { ProductDiscovery, defaultDiscovery } = require('./discovery');
const { PersistenceInterface, InMemoryPersistence } = require('./persistenceInterface');
const errors = require('./errors');

module.exports = {
  ScraperEngine,
  defaultScraper,
  BrowserPool,
  defaultBrowserPool,
  Navigator,
  Interactor,
  extractFromDom,
  extractFromPage,
  cleanText,
  normalizePrice,
  normalizeCurrency,
  normalizeStock,
  validateScrapedProduct,
  RetryPolicy,
  ScrapeStates,
  ScraperStateMachine,
  StructuredLogger,
  defaultLogger,
  ProductDiscovery,
  defaultDiscovery,
  PersistenceInterface,
  InMemoryPersistence,
  ...errors
};
