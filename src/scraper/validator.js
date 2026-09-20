/**
 * Strict schema validation for scraped product records.
 * 
 * CORE CONTRACT:
 * No data can be written to the price history or tracked products database tables
 * without passing through this validation gate.
 */

const { ValidationError } = require('./errors');

/**
 * Validates a normalized product scrape result.
 * 
 * @param {object} data
 * @param {string|number} data.productId - External or internal product ID.
 * @param {string} data.productName - Product title.
 * @param {number} data.price - Numeric selling price.
 * @param {string} data.currency - Currency code (e.g. 'INR').
 * @param {'in_stock'|'out_of_stock'} data.stockStatus - Valid stock state.
 * @param {number|null} data.stockCount - Units remaining or null.
 * @returns {boolean} Returns true if valid.
 * @throws {ValidationError} If any field violates integrity rules.
 */
function validateScrapedProduct(data) {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Scraped product payload must be an object');
  }

  // 1. Product Identifier
  if (data.productId === undefined || data.productId === null || String(data.productId).trim() === '') {
    throw new ValidationError('productId is required and cannot be empty', { data });
  }

  // 2. Product Name
  if (!data.productName || typeof data.productName !== 'string' || data.productName.trim().length === 0) {
    throw new ValidationError('productName must be a non-empty string', { data });
  }

  // 3. Price Integrity (CRITICAL)
  if (typeof data.price !== 'number' || !Number.isFinite(data.price)) {
    throw new ValidationError(`Price must be a valid finite number, received: ${typeof data.price} (${data.price})`, { data });
  }

  if (data.price <= 0) {
    throw new ValidationError(`Price must be strictly positive (> 0), received: ${data.price}`, { data });
  }

  // 4. Currency
  if (!data.currency || typeof data.currency !== 'string' || data.currency.trim().length === 0) {
    throw new ValidationError('currency must be a non-empty string', { data });
  }

  // 5. Stock Status Integrity
  const allowedStockStatuses = ['in_stock', 'out_of_stock'];
  if (!allowedStockStatuses.includes(data.stockStatus)) {
    throw new ValidationError(`stockStatus must be 'in_stock' or 'out_of_stock', received: "${data.stockStatus}"`, { data });
  }

  // 6. Stock Count Integrity
  if (data.stockStatus === 'out_of_stock' && data.stockCount !== null && data.stockCount !== 0) {
    throw new ValidationError(`When stockStatus is 'out_of_stock', stockCount must be 0 or null, received: ${data.stockCount}`, { data });
  }

  if (data.stockCount !== null && data.stockCount !== undefined) {
    if (typeof data.stockCount !== 'number' || !Number.isInteger(data.stockCount) || data.stockCount < 0) {
      throw new ValidationError(`stockCount must be a non-negative integer or null, received: ${data.stockCount}`, { data });
    }
  }

  return true;
}

module.exports = {
  validateScrapedProduct
};
