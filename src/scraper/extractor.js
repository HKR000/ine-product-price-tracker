/**
 * Pure Content Extraction from the Resolved DOM.
 * 
 * DESIGN PRINCIPLES:
 * 1. Anti-Decoy Shielding: The mock store intentionally creates:
 *    `<span class="price-value" aria-hidden="true" style="display:none">...</span>`
 *    which contains random numbers. This extractor filters out any element with
 *    display === 'none' or aria-hidden === 'true'.
 * 2. Class Obfuscation Immunity: Does NOT rely on randomized dynamic classes
 *    from `/api/layout` (e.g. `pw-a7`, `sl-a7`).
 * 3. Separate Extraction from Normalization: Extractor obtains raw strings;
 *    Normalizer cleans them.
 * 4. Can be executed either inside a Playwright `page` or against static DOM fixtures.
 */

const { MissingPriceError, MissingStockError, CorruptDomError } = require('./errors');

/**
 * Pure DOM extraction function intended to execute within the browser context.
 * 
 * @param {Document} doc - The DOM document object (browser or jsdom).
 * @returns {object} Raw extracted fields.
 */
function extractFromDom(doc) {
  const createError = (type, msg) => {
    if (type === 'CorruptDom' && typeof CorruptDomError !== 'undefined') return new CorruptDomError(msg);
    if (type === 'MissingPrice' && typeof MissingPriceError !== 'undefined') return new MissingPriceError(msg);
    if (type === 'MissingStock' && typeof MissingStockError !== 'undefined') return new MissingStockError(msg);
    const err = new Error(`[${type}] ${msg}`);
    err.name = `${type}Error`;
    return err;
  };

  // 1. Product Title
  const titleEl = doc.querySelector('h1, .product-title, .detail-header h1');
  const rawTitle = titleEl ? titleEl.textContent : null;

  // 2. Price Container
  const block = doc.querySelector('.price-block.price-success');
  if (!block) {
    const errorBlock = doc.querySelector('.price-block.price-error');
    if (errorBlock) {
      throw new Error(`Price container in error state: "${errorBlock.textContent.trim()}"`);
    }
    throw createError('CorruptDom', 'Could not find resolved .price-block.price-success in DOM');
  }

  const main = block.querySelector('.price-main');
  if (!main) {
    throw createError('CorruptDom', 'Could not find .price-main container inside resolved price block');
  }

  // 3. Price Elements & Decoy Filtering
  const spans = Array.from(main.querySelectorAll('span, p, div'));
  let rawPrice = null;
  let rawMrp = null;
  let rawBadge = null;

  for (const span of spans) {
    // Check computed styles if available (browser environment)
    let isHidden = span.getAttribute('aria-hidden') === 'true';
    const inlineStyle = span.getAttribute('style') || '';
    if (/display:\s*none/i.test(inlineStyle)) {
      isHidden = true;
    }

    if (doc.defaultView && doc.defaultView.getComputedStyle) {
      const computed = doc.defaultView.getComputedStyle(span);
      if (computed.display === 'none') isHidden = true;
      if (computed.textDecoration && computed.textDecoration.includes('line-through')) {
        rawMrp = span.textContent;
        continue;
      }
    }

    // Skip hidden decoy elements
    if (isHidden) continue;

    // Check for strikethrough MRP via inline style or class
    if (/line-through/i.test(inlineStyle) || span.className.includes('mrp')) {
      rawMrp = span.textContent;
      continue;
    }

    const text = span.textContent.trim();
    if (!text) continue;

    // Check for discount badge (e.g. "21% off", "Deal price")
    if (text.includes('%') || /deal price|off/i.test(text)) {
      rawBadge = text;
      continue;
    }

    // Check for currency signs or digits (selling price)
    if (text.includes('₹') || text.includes('Rs') || text.includes('INR') || /\d/.test(text)) {
      // If we haven't found the price yet, or this span contains the main price text
      if (!rawPrice) {
        rawPrice = text;
      }
    }
  }

  if (!rawPrice) {
    throw createError('MissingPrice', 'No visible, non-decoy selling price element found in .price-main');
  }

  // 4. Stock Badge Extraction
  const stockEl = block.querySelector('.stock-badge');
  if (!stockEl) {
    throw createError('MissingStock', 'No .stock-badge element found in resolved price block');
  }

  const rawStockText = stockEl.textContent.trim();
  const isOutOfStockClass = stockEl.classList.contains('out-stock') || /out-stock/i.test(stockEl.className);

  // 5. Meta Text
  const metaEl = block.querySelector('.price-meta');
  const metaText = metaEl ? metaEl.textContent.trim() : null;

  return {
    rawTitle,
    rawPrice,
    rawMrp,
    rawBadge,
    rawStockText,
    isOutOfStockClass,
    metaText
  };
}

/**
 * Executes the extraction inside a live Playwright page.
 * 
 * @param {import('playwright').Page} page
 * @returns {Promise<object>}
 */
async function extractFromPage(page) {
  try {
    return await page.evaluate(`(${extractFromDom.toString()})(document)`);
  } catch (err) {
    if (err.message) {
      if (err.message.includes('[CorruptDom]')) {
        throw new CorruptDomError(err.message.replace(/.*\[CorruptDom\]\s*/, '').trim());
      }
      if (err.message.includes('[MissingPrice]')) {
        throw new MissingPriceError(err.message.replace(/.*\[MissingPrice\]\s*/, '').trim());
      }
      if (err.message.includes('[MissingStock]')) {
        throw new MissingStockError(err.message.replace(/.*\[MissingStock\]\s*/, '').trim());
      }
    }
    throw err;
  }
}

module.exports = {
  extractFromDom,
  extractFromPage
};
