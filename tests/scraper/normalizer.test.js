const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizePrice,
  normalizeCurrency,
  normalizeStock,
  cleanText
} = require('../../src/scraper/normalizer');
const { ValidationError, MissingStockError } = require('../../src/scraper/errors');

describe('Normalizer Subsystem', () => {
  describe('cleanText', () => {
    it('strips zero-width spaces and invisible marks', () => {
      const input = 'Summit\u200B Approach\u200C Shoe\u200D';
      assert.strictEqual(cleanText(input), 'Summit Approach Shoe');
    });

    it('converts non-breaking spaces to standard spaces and collapses whitespace', () => {
      const input = '  ₹\u00A0 13,626   \n  ';
      assert.strictEqual(cleanText(input), '₹ 13,626');
    });

    it('handles null and undefined gracefully', () => {
      assert.strictEqual(cleanText(null), '');
      assert.strictEqual(cleanText(undefined), '');
    });
  });

  describe('normalizePrice', () => {
    it('correctly normalizes standard INR formatted string', () => {
      assert.strictEqual(normalizePrice('₹ 13,626'), 13626);
      assert.strictEqual(normalizePrice('₹13,626.50'), 13626.5);
      assert.strictEqual(normalizePrice('Rs. 1,499.00'), 1499);
      assert.strictEqual(normalizePrice('INR 450'), 450);
    });

    it('correctly normalizes full-width unicode digits injected by store layout', () => {
      assert.strictEqual(normalizePrice('₹１６,０７１'), 16071);
    });

    it('handles spaced numbers and tax notes', () => {
      assert.strictEqual(normalizePrice('₹ 13 626/- (incl. of all taxes)'), 13626);
    });

    it('handles euro decimal notation', () => {
      assert.strictEqual(normalizePrice('13.626,00'), 13626);
    });

    it('CRITICAL: NEVER converts missing or empty price to 0', () => {
      assert.throws(() => normalizePrice(''), ValidationError);
      assert.throws(() => normalizePrice(null), ValidationError);
      assert.throws(() => normalizePrice(undefined), ValidationError);
    });

    it('CRITICAL: Throws ValidationError on 0 or negative price', () => {
      assert.throws(() => normalizePrice('₹ 0'), ValidationError);
      assert.throws(() => normalizePrice('₹ 0.00'), ValidationError);
      assert.throws(() => normalizePrice('₹ -500'), ValidationError);
    });

    it('CRITICAL: Throws ValidationError on placeholder or non-numeric text', () => {
      assert.throws(() => normalizePrice('Price hidden'), ValidationError);
      assert.throws(() => normalizePrice('Loading current price…'), ValidationError);
      assert.throws(() => normalizePrice('Retrying (attempt 1/6)…'), ValidationError);
      assert.throws(() => normalizePrice('Not a number'), ValidationError);
    });
  });

  describe('normalizeCurrency', () => {
    it('detects standard Indian currency markers', () => {
      assert.strictEqual(normalizeCurrency('₹ 13,626'), 'INR');
      assert.strictEqual(normalizeCurrency('Rs. 500'), 'INR');
      assert.strictEqual(normalizeCurrency('INR 100'), 'INR');
    });

    it('defaults to INR when unstated', () => {
      assert.strictEqual(normalizeCurrency('13626'), 'INR');
    });
  });

  describe('normalizeStock', () => {
    it('parses in-stock text formats and extracts accurate count', () => {
      const s1 = normalizeStock('In stock · 178 left');
      assert.strictEqual(s1.status, 'in_stock');
      assert.strictEqual(s1.count, 178);

      const s2 = normalizeStock('Selling fast — 42 left');
      assert.strictEqual(s2.status, 'in_stock');
      assert.strictEqual(s2.count, 42);

      const s3 = normalizeStock('Only 4 left');
      assert.strictEqual(s3.status, 'in_stock');
      assert.strictEqual(s3.count, 4);

      const s4 = normalizeStock('185 in stock');
      assert.strictEqual(s4.status, 'in_stock');
      assert.strictEqual(s4.count, 185);
    });

    it('correctly classifies out of stock states', () => {
      const s1 = normalizeStock('Out of stock');
      assert.strictEqual(s1.status, 'out_of_stock');
      assert.strictEqual(s1.count, 0);

      const s2 = normalizeStock('', true); // isOutOfStockClass is true
      assert.strictEqual(s2.status, 'out_of_stock');
      assert.strictEqual(s2.count, 0);
    });

    it('CRITICAL: NEVER converts missing stock to an arbitrary status', () => {
      assert.throws(() => normalizeStock(''), MissingStockError);
      assert.throws(() => normalizeStock(null), MissingStockError);
      assert.throws(() => normalizeStock(undefined), MissingStockError);
    });
  });
});
