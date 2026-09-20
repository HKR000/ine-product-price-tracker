const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateScrapedProduct } = require('../../src/scraper/validator');
const { ValidationError } = require('../../src/scraper/errors');

describe('Validator Subsystem', () => {
  const validPayload = {
    productId: 154,
    productName: 'Summit Approach Shoe Mini',
    price: 13626.00,
    currency: 'INR',
    stockStatus: 'in_stock',
    stockCount: 178
  };

  it('passes on a valid normalized product payload', () => {
    assert.strictEqual(validateScrapedProduct(validPayload), true);
  });

  it('CRITICAL: Fails if price is 0 or negative', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: 0 }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: -10 }), ValidationError);
  });

  it('CRITICAL: Fails if price is NaN or not a number', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: NaN }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: '13626' }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: null }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, price: undefined }), ValidationError);
  });

  it('Fails if productId is missing or empty', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, productId: null }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, productId: '' }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, productId: '   ' }), ValidationError);
  });

  it('Fails if productName is missing or empty', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, productName: '' }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, productName: null }), ValidationError);
  });

  it('Fails if currency is missing or empty', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, currency: '' }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, currency: null }), ValidationError);
  });

  it('Fails on invalid stockStatus enum', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, stockStatus: 'available' }), ValidationError);
    assert.throws(() => validateScrapedProduct({ ...validPayload, stockStatus: 'unknown' }), ValidationError);
  });

  it('Fails if stockStatus is out_of_stock but stockCount is positive', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, stockStatus: 'out_of_stock', stockCount: 10 }), ValidationError);
  });

  it('Fails if stockCount is negative', () => {
    assert.throws(() => validateScrapedProduct({ ...validPayload, stockCount: -5 }), ValidationError);
  });

  it('Passes with valid out_of_stock payload', () => {
    const outPayload = {
      ...validPayload,
      stockStatus: 'out_of_stock',
      stockCount: 0
    };
    assert.strictEqual(validateScrapedProduct(outPayload), true);
  });
});
