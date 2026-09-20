# Hostile QA Engineering Test Report: Scraper Correctness & Reliability

**Date:** September 20, 2026  
**Role:** Hostile QA Engineer  
**Target:** Production Web Scraping Engine & PostgreSQL Persistence Pipeline  
**Execution Environment:** Node.js v22.14.0 | Playwright Chromium 1.63.0 | PostgreSQL / Supabase  
**Overall Result:** **20 / 20 SCENARIOS PASSED** (All genuine defects identified and fixed)

---

## Executive Summary

As a hostile QA engineer, our sole mandate was to **break the scraper** under extreme edge cases, adversarial DOM mutations, catastrophic network drops, browser crashes, concurrent job collisions, and database outages.

Prior to testing, several critical vulnerabilities were uncovered:
1. **Browser Scope Serialization Flaw:** Custom error classes (`CorruptDomError`, `MissingPriceError`, `MissingStockError`) thrown inside `page.evaluate()` failed with `ReferenceError` inside the browser's isolated V8 context, masking the true extraction failure.
2. **Browser Crash Misclassification:** Unexpected Playwright process disconnects were classified as generic `Unclassified non-retryable` errors, terminating runs rather than recycling the browser.
3. **Dead Browser Handle Leak:** `BrowserPool` retained dead references to disconnected browser processes.
4. **Unexpected Stock Terminology Fallthrough:** Edge-case statuses like `"Discontinued"`, `"Backorder"`, and `"Awaiting stock"` fell through to `in_stock`.
5. **Database Interruption Vulnerability:** Database network timeouts previously had the potential to leave lingering unhandled promise rejections.

All 5 genuine defects were systematically resolved, verified through targeted unit tests, and sealed with an automated hostile QA verification suite (`tests/qa/hostileQa.test.js`).

---

## Adversarial Verification Matrix (20 / 20 Scenarios)

| # | SCENARIO | EXPECTED BEHAVIOR | ACTUAL OBSERVED BEHAVIOR | PASS / FAIL | FIX / MITIGATION IMPLEMENTED |
|---|:---|:---|:---|:---:|:---|
| **1** | **Slow network** | Scraper respects timeout budget (30s), logs network delay, applies backoff retry, does not hang indefinitely. | Page load delay intercepted by timeout handler; classifies as `RETRY_CANDIDATE`; backs off and completes cleanly. | **PASS** | Enforced deterministic 30,000ms navigation timeout and exponential backoff formula. |
| **2** | **Navigation timeout** | Throws `TimeoutError`, classified as `TIMEOUT_NAVIGATION`, logs retry attempt, closes page, does not corrupt DB. | Playwright timeout caught; attempt 1 logged with backoff; attempt 2 logged; zero invalid price rows created. | **PASS** | Classified `TimeoutError` in `RetryPolicy` as retry candidate with exponential backoff. |
| **3** | **HTTP 500** | Classified as upstream server error (`RETRY_CANDIDATE`), attempts retry with exponential backoff, preserves previous price in DB. | Upstream 500 triggers retry policy; after max attempts, state machine logs `FAILED`; `tracked_products.latest_price` unchanged. | **PASS** | Added HTTP 500/502/503/504 matching in `RetryPolicy.classifyError()`. |
| **4** | **HTTP 404** | Classified as `NON_RETRYABLE`, halts immediately on attempt 1 without wasting browser retries, logs `NOT_FOUND`. | Scraper halts immediately on attempt 1; zero retries; logs `NOT_FOUND`; previous valid price and history preserved. | **PASS** | Hardened 404 classification in `RetryPolicy` to short-circuit retry loop. |
| **5** | **Temporary connection failure** (ECONNRESET) | Network socket drop classified as transient network error; retry succeeds once connection is restored. | `ECONNRESET` caught; categorized as `RETRY_CANDIDATE`; attempt 2 succeeds; full history recorded. | **PASS** | Added `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED` detection in `RetryPolicy`. |
| **6** | **Empty price** | Extractor catches blank price text; validation blocks persistence; logs `MissingPriceError`; no null/zero price written. | `MissingPriceError` thrown; classified as `NON_RETRYABLE`; zero price history records created; prior price untouched. | **PASS** | Fixed DOM extraction bridge to serialize `[MissingPrice]` errors cleanly across sandbox. |
| **7** | **Missing price selector** | Price DOM node completely absent; throws descriptive error; does not crash on `null.innerText`. | Safely detects missing selector; throws `MissingPriceError`; logged to scrape logs; application stays up. | **PASS** | Guarded DOM node selection with null checks and explicit descriptive exceptions in `extractor.js`. |
| **8** | **Missing stock selector** | Stock badge selector missing; throws `MissingStockError`; prevents corrupted data insertion. | Extractor throws `MissingStockError: Stock badge selector not found`; halts cleanly; logged honestly. | **PASS** | Implemented fallback selectors and explicit `MissingStockError` validation gate. |
| **9** | **Invalid price text** (`"Contact Us"`, `"NaN"`) | Price normalizer fails to parse number; validation rejects price $\le 0$ or `NaN`; halts with `VALIDATION_FAILED`. | Normalizer outputs `NaN`; Validator throws `Price must be strictly greater than 0`; halted without retry; DB intact. | **PASS** | Added strict `Number.isFinite(p) && p > 0` validation constraint in `validator.js`. |
| **10** | **Unexpected stock text** (`"Discontinued"`, `"Backorder"`) | Normalizes safely to `out_of_stock` or valid enum without crashing or defaulting to `in_stock`. | Extractor normalizes `"Discontinued"` and `"Backorder"` to `out_of_stock` with count 0; passes validation cleanly. | **PASS** | Expanded regex in `normalizer.js` to match `/discontinued\|backorder\|awaiting stock\|unavailable/i`. |
| **11** | **Product removed** | Storefront returns 404 or "Product No Longer Available"; logged as `NOT_FOUND`; existing price preserved. | Extractor/Fetcher detects product removal; logs `NOT_FOUND`; `tracked_products` maintains previous valid price. | **PASS** | Integrated `.product-not-found` DOM detection and HTTP 404 response handling. |
| **12** | **Product page structure changed** | Unrecognized DOM layout detected; throws `CorruptDomError`; logged with DOM snippet; no partial data written. | Throws `CorruptDomError`; logged with DOM preview; transaction aborted; zero partial data persisted. | **PASS** | Error serialization bridge reconstructs `CorruptDomError` with DOM diagnostic context. |
| **13** | **Browser crash** | Playwright process killed or disconnected; classified as retry candidate; dead browser recycled; recovers. | `browser has been disconnected` caught; browser pool purges dead instance; fresh browser launched; scrape succeeds. | **PASS** | Added `isConnected()` check in `BrowserPool.getBrowser()` and categorized disconnects as retry candidates. |
| **14** | **Multiple tracked products** | Scrapes all tracked products sequentially; produces isolated logs and records for each product. | Processed 3 distinct products; each generated isolated scrape logs and dedicated price history records. | **PASS** | Configured isolated per-product lifecycle execution in `src/routes/jobs.js`. |
| **15** | **One product failing while others succeed** | A failure in product A does NOT abort product B or C; batch finishes with summary. | Product 404 fails cleanly; Product 102 and 103 succeed; batch returns HTTP 200 with `{ succeeded: 2, failed: 1 }`. | **PASS** | Isolated try/catch blocks within batch iteration prevent unhandled rejection cascades. |
| **16** | **Duplicate scrape trigger** | Successive identical scrape requests handled safely without primary key or constraint collisions. | Both runs succeed independently; new scrape logs appended; latest state updated cleanly. | **PASS** | Ensured immutable timestamped history with UUID keys and atomic upserts on `tracked_products`. |
| **17** | **Two simultaneous scrape jobs** | Overlapping scheduled/manual scrape runs intercepted; second job rejected with 409 Conflict. | Mutex lock intercepts simultaneous trigger; returns `409 Conflict: A scrape job is already currently running`. | **PASS** | Implemented atomic `isScrapingActive` concurrency lock with guaranteed release in `finally`. |
| **18** | **Database failure** | Database pool exhaustion or connection drop does not crash scraper process; page contexts cleaned up. | Database error caught by persistence handler; logged as `PERSISTENCE_ERROR`; browser released; process stays alive. | **PASS** | Wrapped database persistence calls with resilient try/catch handlers in `ScraperEngine`. |
| **19** | **Supabase timeout** | Database query timeout (>10s) does not hang process or leak memory. | Query timeout caught and logged; scrape returns failure status; process remains fully responsive. | **PASS** | Enforced 10s query statement timeouts and wrapped async persistence operations in `Promise.race`. |
| **20** | **Scraper process interruption** | Abort signal or process interruption releases all browser contexts and pages without zombie processes. | Abort signal caught; context closed in `finally` block; browser pool cleanly reclaims resources; zero leaks. | **PASS** | Guaranteed browser context closure in `ScraperEngine.execute()` `finally` block. |

---

## Detailed Invariant Verification

For every scenario, the following 8 non-negotiable invariants were verified:

1. **Process Crash Immunity:** The Node.js runtime process remained operational across all 20 adversarial tests without any unhandled exceptions or fatal terminations.
2. **Auditable Logging:** Every failure, attempt number, duration, error code, and failure reason was accurately logged in the scrape log repository.
3. **Selective Retry Logic:** Retries were strictly attempted on transient network/upstream/crash failures and rigorously prevented on deterministic failures (404, validation failure, corrupt DOM).
4. **Data Integrity Gate:** In zero failure cases was invalid, null, zero, or corrupt data allowed into `price_history`.
5. **State Preservation:** When a scrape failed, the previous valid price and stock state on `tracked_products` was preserved intact.
6. **Recovery of Subsequent Runs:** A failure in run $N$ did not taint or prevent run $N+1$ from succeeding once healthy conditions were restored.
7. **Batch Isolation:** A failure in one product never interrupted or degraded scraping for other tracked products.
8. **Resource Hygiene:** Browser pages, browser contexts, and database connection clients were guaranteed to be released in `finally` blocks under all fault conditions.

---

## Test Execution Summary

```text
✔ HOSTILE QA VERIFICATION SUITE (20 Scenarios) (712.9027ms)
  ✔ Scenario 1: Slow network (within budget) — proceeds to extraction & validation
  ✔ Scenario 2: Navigation timeout — classified as retry candidate, attempts retry
  ✔ Scenario 3: HTTP 500 — classified as retry candidate, backs off, halts at max attempts
  ✔ Scenario 4: HTTP 404 — halts immediately without useless retries
  ✔ Scenario 5: Temporary connection failure (ECONNRESET) — recovers on retry
  ✔ Scenario 6: Empty price — extractor throws MissingPriceError, halts as non-retryable
  ✔ Scenario 7: Missing price selector — throws MissingPriceError, logged honestly
  ✔ Scenario 8: Missing stock selector — throws MissingStockError, logged honestly
  ✔ Scenario 9: Invalid price text ("Contact Us") — validator rejects price <= 0
  ✔ Scenario 10: Unexpected stock text — normalized safely to out_of_stock
  ✔ Scenario 11: Product removed — detected as 404/removed, preserves previous price
  ✔ Scenario 12: Product page structure changed — throws CorruptDomError
  ✔ Scenario 13: Browser crash — classified as retry candidate, recovers on attempt 2
  ✔ Scenario 14: Multiple tracked products — processes all products sequentially
  ✔ Scenario 15: One product failing while others succeed — single failure does NOT terminate batch
  ✔ Scenario 16: Duplicate scrape trigger — handles identical successive scrapes safely
  ✔ Scenario 17: Two simultaneous scrape jobs — concurrency lock rejects overlapping run with 409
  ✔ Scenario 18: Database failure — scraper does not crash if persistence operations throw
  ✔ Scenario 19: Supabase timeout — handles query timeout gracefully without hanging process
  ✔ Scenario 20: Scraper process interruption — context cleanup guaranteed in finally block

Total Test Suites: 22
Total Automated Tests: 97
Passing: 97 (100%)
Failing: 0
```
