/**
 * Pure normalization routines for extracted raw strings from the mock storefront.
 * 
 * CRITICAL RELIABILITY RULES:
 * 1. NEVER convert a missing or empty price into 0 or any arbitrary number.
 * 2. NEVER convert a missing stock indicator into an arbitrary status.
 * 3. Pure functions: deterministic, zero side effects, fully unit-testable.
 */

const { ValidationError, MissingStockError } = require('./errors');

/**
 * Strips zero-width spaces, BOMs, non-breaking spaces, and excess whitespace.
 * The mock storefront injects zero-width spaces (\u200b) and non-breaking spaces (\u00a0)
 * to disrupt naive scrapers.
 * 
 * @param {string|null|undefined} text
 * @returns {string}
 */
function cleanText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces & invisible marks
    .replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 65248)) // Convert full-width Unicode digits (0-9)
    .replace(/\u00A0/g, ' ')               // Convert non-breaking space to regular space
    .replace(/\s+/g, ' ')                  // Collapse multiple whitespace
    .trim();
}

/**
 * Normalizes raw price strings into a verified positive floating-point number.
 * Handles patterns such as:
 * - "₹ 13,626"
 * - "₹13,626.50"
 * - "Rs. 1,499.00"
 * - "13626"
 * - "13 626" (spaced format)
 * - "13.626,00" (euro format used in some store layouts)
 * 
 * @param {string|null|undefined} rawText - Unsanitized string extracted from DOM.
 * @returns {number} - Positive finite float representing selling price.
 * @throws {ValidationError} - If input is missing, empty, NaN, or <= 0.
 */
function normalizePrice(rawText) {
  const cleaned = cleanText(rawText);
  if (!cleaned) {
    throw new ValidationError('Price text is missing or empty; cannot normalize');
  }

  // Reject explicit non-price status strings if mistakenly passed
  if (/price hidden|loading|retrying|couldn/i.test(cleaned)) {
    throw new ValidationError(`Encountered placeholder text instead of price: "${cleaned}"`);
  }

  // Remove currency signs, trailing labels, and tax notes
  let sanitized = cleaned
    .replace(/₹|Rs\.?|INR|\/-\s*\(incl\.[^)]*\)/gi, '')
    .trim();

  // Handle euro format: e.g. "13.626,00" -> "13626.00"
  if (/^\d{1,3}(\.\d{3})+(,\d{2})$/.test(sanitized)) {
    sanitized = sanitized.replace(/\./g, '').replace(',', '.');
  } else {
    // Handle standard indian / international format: "13,626" or "13 626"
    sanitized = sanitized.replace(/[, ]/g, '');
  }

  // Extract first valid decimal or integer number sequence
  const match = sanitized.match(/^-?\d+(\.\d+)?/);
  if (!match) {
    throw new ValidationError(`Failed to parse numeric price from: "${rawText}"`);
  }

  const parsed = parseFloat(match[0]);

  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Parsed price is not a finite number: ${parsed}`);
  }

  if (parsed <= 0) {
    throw new ValidationError(`Price must be strictly greater than 0, got: ${parsed}`);
  }

  return Math.round(parsed * 100) / 100;
}

/**
 * Normalizes currency symbol/code into an ISO code.
 * 
 * @param {string|null|undefined} rawText
 * @returns {string} - Default 'INR'
 */
function normalizeCurrency(rawText) {
  const cleaned = cleanText(rawText);
  if (/(\$|USD)/i.test(cleaned)) return 'USD';
  if (/(€|EUR)/i.test(cleaned)) return 'EUR';
  if (/£|GBP/i.test(cleaned)) return 'GBP';
  return 'INR'; // Mock store targets Indian market with INR (₹)
}

/**
 * Normalizes stock information into a structured inventory status and count.
 * 
 * @param {string|null|undefined} rawStockText - Text inside .stock-badge.
 * @param {boolean} [isOutOfStockClass=false] - Whether .out-stock class was present on badge.
 * @returns {{ status: 'in_stock'|'out_of_stock', count: number|null, raw: string }}
 * @throws {MissingStockError} - If stock text is missing and class is absent.
 */
function normalizeStock(rawStockText, isOutOfStockClass = false) {
  const cleaned = cleanText(rawStockText);

  // If no text and no class was found, the element was completely absent
  if (!cleaned && !isOutOfStockClass) {
    throw new MissingStockError('Stock text and badge are completely missing');
  }

  // 1. Check for Out of Stock conditions
  if (isOutOfStockClass || /out of stock|sold out|unavailable|discontinued|backorder|awaiting stock/i.test(cleaned)) {
    return {
      status: 'out_of_stock',
      count: 0,
      raw: cleaned || 'Out of stock'
    };
  }

  // 2. Check for In Stock conditions and extract count
  // Supported store formats:
  // - "In stock · 178 left"
  // - "Selling fast — 178 left"
  // - "Only 4 left"
  // - "178 in stock"
  // - "Hurry, just 3 left"
  const countMatch = cleaned.match(/\d+/);
  const count = countMatch ? parseInt(countMatch[0], 10) : null;

  return {
    status: 'in_stock',
    count: count !== null && !isNaN(count) ? count : null,
    raw: cleaned
  };
}

module.exports = {
  cleanText,
  normalizePrice,
  normalizeCurrency,
  normalizeStock
};
