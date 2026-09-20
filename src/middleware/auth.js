/**
 * Authentication & Scheduled Job Security Middleware.
 * 
 * Protects cron-triggered batch endpoints from unauthorized public invocation.
 * Supports:
 * 1. X-Cron-Secret header (preferred by cron-job.org)
 * 2. Authorization: Bearer <secret>
 */

function requireCronSecret(req, res, next) {
  const configuredSecret = process.env.CRON_SECRET || 'ine_price_tracker_secret_cron_token';

  // Extract from header
  const headerSecret = req.headers['x-cron-secret'];
  const authHeader = req.headers['authorization'];
  let bearerToken = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const providedSecret = headerSecret || bearerToken;

  if (!providedSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing cron secret header. Provide X-Cron-Secret or Authorization Bearer token.'
      }
    });
  }

  next();
}

module.exports = {
  requireCronSecret
};
