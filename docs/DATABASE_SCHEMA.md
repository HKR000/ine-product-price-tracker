# Database Architecture & Schema Documentation

## 1. Overview & Core Philosophy

The persistence layer for the **INE Product Price Tracker** is backed by **Supabase PostgreSQL** and built with strict transaction isolation and integrity invariants:

1. **Zero Corrupt / Fake Data Invariant**: If a scrape fails, encounters a timeout, or receives invalid DOM data, **no price history record is ever created**, and the existing valid price/stock is **never overwritten** by null, 0, or arbitrary values.
2. **Honest Audit Log Invariant**: Every attempt—whether `success`, `retried`, or `failed`—is recorded in `scrape_logs` with timestamps, durations, HTTP codes, and detailed diagnostic error types.
3. **Privileged Backend Security**: All database operations and connection credentials (`DATABASE_URL` / connection pool) are kept strictly on the backend. No Supabase service-role keys or direct table write permissions are ever exposed to the frontend browser client.
4. **Concurrency Safety**: Atomic transaction boundaries (`BEGIN` / `COMMIT`) with row-level locks (`SELECT ... FOR UPDATE`) prevent race conditions when concurrent scrape jobs run for the same product.

---

## 2. Table Schemas

### Table 1: `tracked_products`
Represents the items actively monitored. Maintains cached latest verified values so the dashboard can load instantly without running expensive aggregation table scans over history.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique internal identifier |
| `store_product_id` | `INTEGER` | `NOT NULL UNIQUE` | Store identifier (e.g. `154`, `391`) |
| `slug` | `VARCHAR(255)` | `NOT NULL` | URL slug |
| `name` | `VARCHAR(255)` | `NOT NULL` | Product title |
| `brand` | `VARCHAR(100)` | `NULL` | Brand name |
| `category` | `VARCHAR(100)` | `NULL` | Product category |
| `sku` | `VARCHAR(100)` | `NULL` | SKU identifier |
| `description` | `TEXT` | `NULL` | Product description |
| `target_url` | `TEXT` | `NOT NULL` | Full scrape URL |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Active monitoring flag |
| `latest_price` | `NUMERIC(10,2)` | `CHECK (latest_price IS NULL OR latest_price > 0)` | Cached latest valid price |
| `latest_currency` | `VARCHAR(10)` | `DEFAULT 'INR'` | Currency code |
| `latest_stock_status`| `VARCHAR(50)` | `CHECK (... IN ('in_stock', 'out_of_stock'))` | Latest stock state |
| `latest_stock_count` | `INTEGER` | `CHECK (... >= 0)` | Latest stock quantity |
| `latest_raw_stock_text`| `VARCHAR(255)`| `NULL` | Verbatim stock badge text |
| `last_scraped_at` | `TIMESTAMPTZ` | `NULL` | Timestamp of most recent attempt |
| `last_scrape_status`| `VARCHAR(20)` | `CHECK (... IN ('pending', 'success', 'failed'))` | Last scrape result |
| `last_error_message`| `TEXT` | `NULL` | Last diagnostic error message |
| `version` | `INTEGER` | `NOT NULL DEFAULT 1` | Optimistic locking version |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Last update timestamp |

---

### Table 2: `price_history`
Append-only time-series data table for price and stock tracking charts.
**STRICT RULE**: Rows are **only** inserted upon validated, successful scrapes.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique record ID |
| `product_id` | `UUID` | `REFERENCES tracked_products(id) ON DELETE CASCADE` | Foreign key to tracked item |
| `price` | `NUMERIC(10,2)`| `NOT NULL CHECK (price > 0)` | Strictly positive price |
| `currency` | `VARCHAR(10)` | `DEFAULT 'INR'` | Currency |
| `mrp` | `NUMERIC(10,2)`| `CHECK (mrp IS NULL OR mrp > 0)` | MRP strikethrough price |
| `stock_status` | `VARCHAR(50)` | `CHECK (... IN ('in_stock', 'out_of_stock'))` | Stock state |
| `stock_count` | `INTEGER` | `CHECK (... >= 0)` | Stock quantity |
| `raw_stock_text` | `VARCHAR(255)`| `NULL` | Extracted badge text |
| `scraped_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Timestamp of price snapshot |

---

### Table 3: `scrape_logs`
Immutable audit log recording every single attempt and transition.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique log ID |
| `product_id` | `UUID` | `REFERENCES tracked_products(id) ON DELETE CASCADE` | Foreign key |
| `store_product_id` | `INTEGER` | `NOT NULL` | Numeric store ID |
| `correlation_id` | `VARCHAR(100)`| `NULL` | Correlates retries in a single job |
| `status` | `VARCHAR(20)` | `CHECK (... IN ('success', 'retried', 'failed'))` | Outcome |
| `attempt_number` | `INTEGER` | `NOT NULL CHECK (attempt_number >= 1)` | 1, 2, 3... |
| `max_attempts` | `INTEGER` | `DEFAULT 3` | Max retries configured |
| `duration_ms` | `INTEGER` | `CHECK (duration_ms >= 0)` | Attempt duration in milliseconds |
| `extracted_price` | `NUMERIC(10,2)`| `CHECK (... > 0)` | Extracted price (NULL on failure) |
| `extracted_stock` | `VARCHAR(100)`| `NULL` | Extracted stock text (NULL on failure) |
| `http_status_code` | `INTEGER` | `NULL` | Upstream HTTP status (200, 503, 404) |
| `error_code` | `VARCHAR(100)`| `NULL` | Error classification code |
| `error_message` | `TEXT` | `NULL` | Detailed error description |
| `scraper_mode` | `VARCHAR(20)` | `CHECK (... IN ('headless', 'headed'))` | Execution mode |
| `attempt_timestamp`| `TIMESTAMPTZ` | `DEFAULT NOW()` | Execution timestamp |

---

## 3. Database Indexes

To ensure high performance under frequent cron executions and instant frontend queries, the following indexes are defined:

1. **Tracked Product ID**:
   - `idx_price_history_product_id` ON `price_history(product_id)`
   - `idx_scrape_logs_product_id` ON `scrape_logs(product_id)`
2. **History Timestamp**:
   - `idx_price_history_scraped_at` ON `price_history(scraped_at DESC)`
   - `idx_price_history_product_time` ON `price_history(product_id, scraped_at DESC)`
3. **Scrape Log Timestamp**:
   - `idx_scrape_logs_timestamp` ON `scrape_logs(attempt_timestamp DESC)`
   - `idx_scrape_logs_product_time` ON `scrape_logs(product_id, attempt_timestamp DESC)`
4. **Product Identifier**:
   - `idx_tracked_products_store_id` ON `tracked_products(store_product_id)`
   - `idx_scrape_logs_store_product_id` ON `scrape_logs(store_product_id)`
5. **Deduplication / Idempotency**:
   - `uq_price_history_dedup` ON `price_history(product_id, date_trunc('minute', scraped_at))` (prevents accidental duplicates within the same minute).

---

## 4. How to Observe Data In and Out of the Database

You can observe what goes into and out of the database in 3 ways:

### Option A: Real-Time Terminal Watcher (Recommended for CLI)
Run the dedicated database monitor in watch mode:
```bash
npm run db:watch
```
Or for a one-time snapshot:
```bash
npm run db:status
```
This prints live, formatted console tables for:
- **Tracked Products** (current known state and versions)
- **Price History** (new validated entries as they arrive)
- **Audit Scrape Logs** (every attempt, status `SUCCESS`, `RETRIED`, `FAILED`, and durations)

### Option B: Supabase Dashboard
1. Open your Supabase project in the browser: [https://app.supabase.com](https://app.supabase.com).
2. Click on **Table Editor** in the left sidebar:
   - Click `tracked_products` to see current monitored items.
   - Click `price_history` to see verified price snapshots.
   - Click `scrape_logs` to see the complete audit trail.
3. Open **Logs > Postgres Logs** to view live incoming SQL queries, connection pool transactions, and query execution times.

### Option C: Backend REST API Endpoints
When the Express backend runs, query the live endpoints:
- `GET /api/tracked-products` — Returns all tracked products with latest prices.
- `GET /api/tracked-products/:id/history` — Returns time-series price/stock history.
- `GET /api/tracked-products/:id/scrape-logs` — Returns attempt logs for auditing.
