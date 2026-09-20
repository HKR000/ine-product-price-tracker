const { describe, it } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { extractFromDom } = require('../../src/scraper/extractor');
const { MissingPriceError, MissingStockError, CorruptDomError } = require('../../src/scraper/errors');

describe('Extractor Subsystem (DOM Fixtures)', () => {
  it('1. Valid Product: extracts real price, filters out adversarial decoy and MRP', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="product-info">
            <h1>Summit Approach Shoe Mini</h1>
          </div>
          <div class="price-block price-success pw-a7">
            <div class="price-main">
              <!-- Adversarial Decoy injected by mock store to poison scrapers -->
              <span class="price-value" aria-hidden="true" style="display:none">₹ 99,999</span>
              
              <!-- Strikethrough MRP -->
              <span class="mr-a7" style="text-decoration: line-through">₹ 17,248</span>
              
              <!-- Discount Badge -->
              <span class="sl-a7">21% off</span>
              
              <!-- Real Selling Price -->
              <span class="pv-a7">₹ 13,626</span>
            </div>
            <div class="stock">
              <span class="stock-badge in-stock">Selling fast — 178 left</span>
            </div>
            <div class="price-meta">
              <span>Loaded in 1 attempt</span>
            </div>
          </div>
        </body>
      </html>
    `;

    const dom = new JSDOM(html);
    const result = extractFromDom(dom.window.document);

    assert.strictEqual(result.rawTitle, 'Summit Approach Shoe Mini');
    assert.strictEqual(result.rawPrice, '₹ 13,626');
    assert.strictEqual(result.rawMrp, '₹ 17,248');
    assert.strictEqual(result.rawStockText, 'Selling fast — 178 left');
    assert.strictEqual(result.isOutOfStockClass, false);
  });

  it('2. Missing Price: throws MissingPriceError when price span is absent', () => {
    const html = `
      <div class="price-block price-success">
        <div class="price-main">
          <!-- Only decoy and MRP exist, no selling price -->
          <span class="price-value" aria-hidden="true" style="display:none">₹ 99,999</span>
          <span style="text-decoration: line-through">₹ 17,248</span>
        </div>
        <span class="stock-badge in-stock">In stock · 10 left</span>
      </div>
    `;

    const dom = new JSDOM(html);
    assert.throws(
      () => extractFromDom(dom.window.document),
      MissingPriceError
    );
  });

  it('3. Missing Stock: throws MissingStockError when .stock-badge is absent', () => {
    const html = `
      <div class="price-block price-success">
        <div class="price-main">
          <span>₹ 13,626</span>
        </div>
      </div>
    `;

    const dom = new JSDOM(html);
    assert.throws(
      () => extractFromDom(dom.window.document),
      MissingStockError
    );
  });

  it('7. Malformed Content: throws MissingPriceError when price text contains no numbers', () => {
    const html = `
      <div class="price-block price-success">
        <div class="price-main">
          <span>Unparseable Gibberish</span>
        </div>
        <span class="stock-badge in-stock">In stock</span>
      </div>
    `;

    const dom = new JSDOM(html);
    assert.throws(
      () => extractFromDom(dom.window.document),
      MissingPriceError
    );
  });

  it('8. Selector Failure: throws CorruptDomError when .price-block.price-success is missing', () => {
    const html = `
      <div>
        <p>Page layout completely shifted</p>
      </div>
    `;

    const dom = new JSDOM(html);
    assert.throws(
      () => extractFromDom(dom.window.document),
      CorruptDomError
    );
  });
});
