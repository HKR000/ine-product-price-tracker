-- ============================================================================
-- INE Product Price Tracker: Production Database Migration
-- Target Engine: Supabase PostgreSQL
-- ============================================================================

-- Enable pgcrypto for UUID generation if not already active
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Table: tracked_products
-- Represents monitored items. Maintains cached latest verified values
-- so dashboard queries are O(1) without expensive table scans.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracked_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_product_id INTEGER NOT NULL UNIQUE,
    slug VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    category VARCHAR(100),
    sku VARCHAR(100),
    description TEXT,
    target_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Cached Latest Valid State (Updated ONLY upon verified success)
    -- Enforces price > 0 at database constraint level
    latest_price NUMERIC(10, 2) CHECK (latest_price IS NULL OR latest_price > 0),
    latest_currency VARCHAR(10) DEFAULT 'INR',
    latest_stock_status VARCHAR(50) CHECK (latest_stock_status IS NULL OR latest_stock_status IN ('in_stock', 'out_of_stock')),
    latest_stock_count INTEGER CHECK (latest_stock_count IS NULL OR latest_stock_count >= 0),
    latest_raw_stock_text VARCHAR(255),
    
    -- Operational Status
    last_scraped_at TIMESTAMPTZ,
    last_scrape_status VARCHAR(20) DEFAULT 'pending' CHECK (last_scrape_status IN ('pending', 'success', 'failed')),
    last_error_message TEXT,
    
    -- Concurrency Versioning
    version INTEGER NOT NULL DEFAULT 1,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for tracked_products
CREATE INDEX IF NOT EXISTS idx_tracked_products_active ON tracked_products(is_active);
CREATE INDEX IF NOT EXISTS idx_tracked_products_store_id ON tracked_products(store_product_id);
CREATE INDEX IF NOT EXISTS idx_tracked_products_last_scraped ON tracked_products(last_scraped_at DESC);


-- ----------------------------------------------------------------------------
-- 2. Table: price_history
-- Append-only historical price & stock series.
-- STRICT RULE: Rows are ONLY inserted upon verified, validated scrapes.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    
    -- Strict Price Integrity: zero, negative, or null prices REJECTED by Postgres
    price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    mrp NUMERIC(10, 2) CHECK (mrp IS NULL OR mrp > 0),
    
    -- Stock Integrity
    stock_status VARCHAR(50) NOT NULL CHECK (stock_status IN ('in_stock', 'out_of_stock')),
    stock_count INTEGER CHECK (stock_count IS NULL OR stock_count >= 0),
    raw_stock_text VARCHAR(255),
    
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for price_history
CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_scraped_at ON price_history(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_product_time ON price_history(product_id, scraped_at DESC);

-- Idempotency / Deduplication index: Prevents accidental duplicate rows for same product within same minute
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_history_dedup 
ON price_history(product_id, date_trunc('minute', scraped_at));


-- ----------------------------------------------------------------------------
-- 3. Table: scrape_logs
-- Immutable execution audit log.
-- STRICT RULE: Every attempt (success, retried, failed) MUST be recorded.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
    store_product_id INTEGER NOT NULL,
    correlation_id VARCHAR(100),
    
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'retried', 'failed')),
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    max_attempts INTEGER NOT NULL DEFAULT 3,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    
    -- Extracted values if available (NULL on failure)
    extracted_price NUMERIC(10, 2) CHECK (extracted_price IS NULL OR extracted_price > 0),
    extracted_stock VARCHAR(100),
    
    -- Diagnostic information
    http_status_code INTEGER,
    error_code VARCHAR(100),
    error_message TEXT,
    
    scraper_mode VARCHAR(20) NOT NULL DEFAULT 'headless' CHECK (scraper_mode IN ('headless', 'headed')),
    attempt_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for scrape logs auditing and pagination
CREATE INDEX IF NOT EXISTS idx_scrape_logs_product_id ON scrape_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_store_product_id ON scrape_logs(store_product_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_timestamp ON scrape_logs(attempt_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_product_time ON scrape_logs(product_id, attempt_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_status ON scrape_logs(status);


-- ----------------------------------------------------------------------------
-- 4. Table: catalog_cache
-- Stores synchronized catalog items (1,000 products) for sub-millisecond search.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_cache (
    store_product_id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    category VARCHAR(100),
    sku VARCHAR(100),
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_name_pattern ON catalog_cache(name varchar_pattern_ops);
