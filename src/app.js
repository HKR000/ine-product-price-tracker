/**
 * Express Application Configuration.
 * 
 * Exports the pre-configured Express application for both server runtime and testing.
 */

const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');
const productsRouter = require('./routes/products');
const trackedProductsRouter = require('./routes/trackedProducts');
const jobsRouter = require('./routes/jobs');
const { defaultLogger } = require('./scraper/logger');

const app = express();

// Security & Parsing Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) 
    : '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret']
}));

app.use(express.json({ limit: '1mb' }));

// Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      defaultLogger.info('HTTP_REQUEST', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip
      });
    }
  });
  next();
});

// Root Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'INE Product Price Tracker API',
    version: '1.0.0',
    documentation: '/health',
    endpoints: {
      health: 'GET /health',
      search: 'GET /api/products/search?q={query}',
      trackedProducts: 'GET /api/tracked-products',
      trackProduct: 'POST /api/tracked-products',
      history: 'GET /api/tracked-products/:id/history',
      scrapeLogs: 'GET /api/tracked-products/:id/scrape-logs',
      manualScrape: 'POST /api/tracked-products/:id/scrape',
      batchScrape: 'POST /api/jobs/scrape-all'
    }
  });
});

// Health check endpoint
app.use(healthRouter);

// API Routes
app.use('/api', productsRouter);
app.use('/api', trackedProductsRouter);
app.use('/api', jobsRouter);

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} does not exist`
    }
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || err.errorCode || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR');

  defaultLogger.error('API_ERROR', {
    method: req.method,
    path: req.path,
    statusCode,
    errorCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: err.message || 'An unexpected error occurred',
      details: err.details || undefined
    }
  });
});

module.exports = app;
