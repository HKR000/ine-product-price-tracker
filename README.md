# Product Price Tracker

Production-grade automated product price and stock monitoring web application for the INE hosted mock store (`https://demo.inelabteamdev.com`). Built with Node.js Express, React (Vite), Supabase PostgreSQL, and Playwright automation.

---

## Overview

The **INE Product Price Tracker** provides continuous, unattended price and stock observability for products listed on the INE mock storefront. 

The target mock storefront is intentionally adversarial:
- Prices hydrate dynamically after client-side scripts execute with artificial delays.
- Dynamic challenge verifications and obfuscated CSS selectors guard page markup.
- Fake honeypot price tags are injected into the DOM to trap naive scrapers.
- Upstream HTTP 5xx errors, slow network responses, and 404 removals occur intermittently.

This system solves these challenges using a formal **7-state scraping engine** (`STARTED` → `FETCHING` → `EXTRACTING` → `VALIDATING` → `RETRYING` → `SUCCESS` / `FAILED`), strict persistence validation boundaries, and an external cron webhook designed for sleep-prone free-tier cloud containers.

---

## Architecture

```
                                  ┌──────────────────────────┐
                                  │      cron-job.org        │
                                  │   (Pings every 2 hours)  │
                                  └─────────────┬────────────┘
                                                │ POST /api/jobs/scrape-all
                                                │ Header: X-Cron-Secret
                                                ▼
┌─────────────────────────┐          ┌──────────────────────────┐
│     React / Vite SPA    │ ◄──────► │   Express REST Backend   │
│   (Hosted on Vercel)    │   REST   │    (Hosted on Render)    │
└─────────────────────────┘          └──────┬────────────┬──────┘
                                            │            │
                                  Playwright Automation  PostgreSQL Pool (SSL)
                                            │            │
                                            ▼            ▼
                            ┌──────────────────┐   ┌────────────────────────┐
                            │  INE Mock Store  │   │  Supabase PostgreSQL   │
                            │ (Anti-Bot Traps  │   │  - tracked_products    │
                            │   Bypassed)      │   │  - price_history       │
                            └──────────────────┘   │  - scrape_logs         │
                                                   └────────────────────────┘
```

---

## Features

- **Sub-Millisecond Catalog Search:** Instant substring and token-based search across 1,000 mock store products via lightweight HTTP pagination and cached indexing.
- **Automated 2-Hour Scheduling:** Headless batch scraping triggered via authenticated `cron-job.org` webhooks, waking free-tier containers without running battery-draining continuous background loops.
- **7-State Scraper Machine:** Observable execution lifecycle with deterministic transitions and granular timing diagnostics.
- **Intelligent Retry Policy:** Exponential backoff with jitter for transient failures (HTTP 5xx, network drops, browser crashes) and immediate termination for deterministic errors (404, DOM structural shifts).
- **Zero-Corruption Invariant:** Extracted prices and stock counts are validated before persistence. Failed runs **never** overwrite existing valid prices with null, zero, or corrupt data.
- **Visual Time-Series Analytics:** Interactive SVG charts and chronological tabular history of price changes and stock availability.
- **Transparent Audit Logging:** Complete per-product scrape attempt history displaying attempt counts (`1/3`, `2/3`), duration in ms, and honest failure classifications.
- **Observable Headed Mode:** CLI command `npm run scrape:headed` with visual cursor simulation and deterministic fault-injection for reviewer demonstrations.
- **Hostile QA Tested:** Verified against 20 adversarial edge cases including process interruptions, database timeouts, and browser crashes.

---

## Tech Stack

- **Frontend:** React 18, Vite 6, Vanilla CSS Design System (no Tailwind dependencies).
- **Backend:** Node.js v20+, Express 4, CORS, Dotenv.
- **Scraping Engine:** Playwright Chromium (with honeypot evasion and challenge solving), native HTTP fetch for catalog discovery.
- **Database:** Supabase PostgreSQL with pooled SSL connections (`pg`).
- **Scheduling:** cron-job.org external scheduler calling protected API webhooks.
- **Testing:** Node.js native test runner (`node --test`), 97 automated tests across API, database, scraper, and hostile QA suites.
- **CI/CD:** GitHub Actions workflow (`.github/workflows/ci.yml`).

---

## Project Structure

```
iNE/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI/CD pipeline
├── client/                      # React / Vite Frontend
│   ├── src/
│   │   ├── api/client.js        # REST client with BASE_URL routing
│   │   ├── components/          # UI Components (Chart, Tables, Modals, Drawer)
│   │   ├── App.jsx              # Main Dashboard Application
│   │   └── index.css            # Dark-mode Design System
│   ├── .env.example             # Frontend environment template
│   ├── package.json
│   ├── vercel.json              # Vercel SPA routing configuration
│   └── vite.config.js           # Vite dev server with /api proxy
├── docs/
│   ├── CRON_CONFIGURATION.md    # Detailed cron-job.org setup instructions
│   ├── DATABASE_SCHEMA.md       # PostgreSQL schema & indexing reference
│   └── RECORDING_SCRIPT.md      # Headed scraper demo cue sheet
├── migrations/
│   └── 001_initial_schema.sql   # Idempotent PostgreSQL schema migration
├── scripts/
│   ├── observeDb.js             # CLI database observer (status & streaming watch)
│   ├── runHeaded.js             # Headed scraper demonstration runner
│   └── simulateCron.js          # CLI scheduler batch simulator
├── src/
│   ├── db/
│   │   ├── connection.js        # PostgreSQL pool with SSL & in-memory fallback
│   │   └── persistence.js       # Transactional data persistence layer
│   ├── middleware/
│   │   ├── auth.js              # X-Cron-Secret webhook authentication
│   │   └── validation.js        # SSRF domain whitelist & parameter validation
│   ├── routes/
│   │   ├── health.js            # GET /health diagnostics endpoint
│   │   ├── jobs.js              # POST /api/jobs/scrape-all batch scheduler
│   │   ├── products.js          # GET /api/products/search catalog discovery
│   │   └── trackedProducts.js   # CRUD & manual scrape endpoints
│   ├── scraper/
│   │   ├── browserPool.js       # Recycled Chromium browser manager
│   │   ├── discovery.js         # HTTP-based catalog indexer & search
│   │   ├── engine.js            # 7-State machine scrape orchestrator
│   │   ├── extractor.js         # DOM extraction & anti-bot evasion
│   │   ├── logger.js            # Structured JSON audit logger
│   │   ├── normalizer.js        # Currency, price, and stock normalizer
│   │   ├── retryPolicy.js       # Error classification & exponential backoff
│   │   └── validator.js         # Data integrity validation rules
│   ├── app.js                   # Express application configuration & CORS
│   └── server.js                # Server entry point & graceful shutdown
├── tests/
│   ├── api/                     # REST API route tests
│   ├── db/                      # Database persistence & row-lock tests
│   ├── qa/                      # 20-scenario hostile QA verification suite
│   └── scraper/                 # Unit tests for state machine, extractor, normalizer
├── .env.example                 # Backend environment variable template
├── .gitignore                   # Excludes secrets, node_modules, and build outputs
├── DEPLOYMENT_GUIDE.md          # Step-by-step production deployment manual
├── DESIGN_NOTE.md               # Engineering rationale, trade-offs & AI corrections
├── package.json
├── QA_TEST_REPORT.md            # Hostile QA test results matrix
├── render.yaml                  # Render Blueprint deployment definition
└── vercel.json                  # Root Vercel deployment definition
```

---

## Local Setup

### Prerequisites
- Node.js v20.0.0 or higher
- npm v10+
- Internet access (for Playwright Chromium download and mock store connectivity)

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd iNE

# Install backend dependencies
npm install

# Install Playwright browser binary
npx playwright install chromium

# Install frontend dependencies
cd client && npm install && cd ..
```

---

## Environment Variables

Copy the sample environment file to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```ini
# Server Configuration
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Database Configuration (Supabase PostgreSQL)
# Leave blank to use local in-memory persistence for testing
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# Scheduler Protection Secret
CRON_SECRET="your_secure_cron_token_here"

# Target Mock Storefront
MOCK_STORE_BASE_URL="https://demo.inelabteamdev.com"

# Scraper Configuration
SCRAPER_MAX_ATTEMPTS=3
SCRAPER_TIMEOUT_MS=25000
SCRAPER_HEADED=false
```

For the frontend (`client/.env`), configure if deploying to custom domains:
```ini
VITE_API_BASE_URL="" # Empty for local Vite proxy; set to Render URL on Vercel
```

---

## Database Setup

1. Create a free project on [Supabase](https://supabase.com).
2. Go to **SQL Editor** in your Supabase dashboard.
3. Paste and run [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql).
4. Copy the connection URI from **Project Settings → Database** and paste into `DATABASE_URL` in `.env`.

*Note:* If `DATABASE_URL` is omitted, the application automatically runs using a thread-safe in-memory adapter so you can develop and test without database setup.

---

## Running Backend

Start the development server with hot-reload:
```bash
npm run dev
```

Or run in standard production mode:
```bash
npm start
```
The server will listen at `http://localhost:3000`.

---

## Running Frontend

Start the Vite development client:
```bash
npm run client:dev
```
The dashboard will open at `http://localhost:5173`. Requests to `/api` and `/health` are automatically proxied to the backend on port 3000.

---

## Running Tests

Execute the complete automated test suite (97 tests across 22 suites):
```bash
npm test
```

Run specific test subsystems:
```bash
# Run API endpoint tests
npm run test:api

# Run Database persistence tests
npm run test:db

# Run Scraper unit and state machine tests
npm run test:scraper

# Run the 20-Scenario Hostile QA verification suite
npm run test:qa
```

---

## Running Scraper

Trigger an on-demand scrape via CLI:
```bash
# Simulate a scheduled batch run across all tracked products:
npm run cron:simulate
```

Or trigger via REST API:
```bash
# Scrape a specific tracked product:
curl -X POST http://localhost:3000/api/tracked-products/<PRODUCT_ID>/scrape
```

---

## Running Headed Scraper

Run an observable, visible Chromium browser window to watch the scraper navigate, bypass anti-bot traps, solve challenges, extract prices, and validate data:

```bash
# 1. Standard headed run against product #391:
npm run scrape:headed -- 391

# 2. Deterministic fault-injection demo (transient 503 error on Attempt 1 -> Backoff -> Attempt 2 success):
npm run scrape:headed -- 391 --fault-injection=transient

# 3. Real-store non-existent product demo (halts cleanly on 404 without wasted retries):
npm run scrape:headed -- 99999

# 4. Slower motion with longer screen dwell time:
npm run scrape:headed -- 391 --slow-mo=250 --keep-open=6000
```
> See [`docs/RECORDING_SCRIPT.md`](docs/RECORDING_SCRIPT.md) for the full 2–4 minute video recording script.

---

## Scheduled Scraping

### The Two-Hour Schedule
Per assignment requirements, each tracked product's current price and stock must be updated every 2 hours. Because free-tier hosting platforms (such as Render) automatically put web services to sleep after 15 minutes of inactivity, an internal `setInterval()` loop would terminate when the instance sleeps.

### cron-job.org Configuration
We use **cron-job.org** to send an authorized HTTP POST request every 2 hours:

1. **URL:** `https://<YOUR-RENDER-BACKEND>.onrender.com/api/jobs/scrape-all`
2. **Schedule:** Every 2 hours (`0 */2 * * *`)
3. **HTTP Method:** `POST`
4. **Header:** `X-Cron-Secret: <YOUR_CRON_SECRET>`
5. **Execution Behavior:** Wakes the sleeping Render service, iterates sequentially through all active tracked products, updates `tracked_products`, appends `price_history` and `scrape_logs`, and responds with a JSON summary.

> See [`docs/CRON_CONFIGURATION.md`](docs/CRON_CONFIGURATION.md) for step-by-step setup screenshots and options.

---

## API Documentation

All responses return standard JSON.

### Core Endpoints

| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `GET` | `/health` | System health, uptime, memory, and database latency | None |
| `GET` | `/api/products/search?q={query}` | Search catalog by name, brand, SKU | None |
| `GET` | `/api/products/:storeId` | Fetch store product metadata | None |
| `GET` | `/api/tracked-products` | List all active tracked products | None |
| `POST`| `/api/tracked-products` | Add product to tracking | None |
| `GET` | `/api/tracked-products/:id` | Get tracked product details | None |
| `GET` | `/api/tracked-products/:id/history` | Get chronological price & stock history | None |
| `GET` | `/api/tracked-products/:id/scrape-logs`| Get audit logs for all scrape attempts | None |
| `DELETE`| `/api/tracked-products/:id` | Soft-deactivate product tracking | None |
| `POST`| `/api/tracked-products/:id/scrape` | Trigger manual on-demand scrape | None |
| `POST`| `/api/jobs/scrape-all` | Batch scrape all tracked products | `X-Cron-Secret` |

---

## Deployment

### Vercel (Frontend)
1. Import repository on [Vercel](https://vercel.com).
2. Set Root Directory to `client` (or use root with included [`vercel.json`](vercel.json)).
3. Add Environment Variable:
   - `VITE_API_BASE_URL`: `https://<YOUR-RENDER-BACKEND>.onrender.com` (without trailing slash).
4. Deploy.

### Render (Backend)
1. Create a new Web Service on [Render](https://render.com) using [`render.yaml`](render.yaml) Blueprint or manual setup.
2. Build Command: `npm install && npx playwright install chromium`
3. Start Command: `npm start`
4. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `DATABASE_URL`: Your Supabase connection string.
   - `CRON_SECRET`: Strong secret token.
   - `CORS_ORIGIN`: Your Vercel frontend URL.

### Supabase (Database)
Execute [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql) in the Supabase SQL editor.

### cron-job.org (Scheduler)
Set up a recurring job pointing to `POST https://<YOUR-RENDER-BACKEND>.onrender.com/api/jobs/scrape-all` with header `X-Cron-Secret: <CRON_SECRET>`.

> For complete details, see [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md).

---

## Reliability

The scraping subsystem is engineered for continuous unattended runs:

1. **Timeout Budgeting:** Strict 25,000ms navigation timeouts prevent hanging browser contexts.
2. **Exponential Backoff:** Retries apply backoff with jitter: $T = \text{base} \times 2^{\text{attempt}-1} + \text{jitter}$.
3. **Failure Classification:** Retries are strictly reserved for transient errors (HTTP 5xx, timeouts, connection resets, browser crashes). Deterministic errors (HTTP 404, DOM structural shifts, negative prices) fail immediately.
4. **Validation Gate:** Prices must be finite numbers $> 0$, currency must be valid ISO, and stock statuses must conform to the schema enum.
5. **Zero Invalid History Writes:** Corrupted, empty, or failed attempts **never** insert rows into `price_history`.
6. **State Preservation:** On failure, `latest_price` and `latest_stock_status` remain untouched; only `scrape_logs` receives an audit entry.
7. **Browser Lifecycle & Resource Hygiene:** Browser contexts and pages are guaranteed to close in `finally` blocks, preventing zombie Chromium processes and memory leaks.
8. **Fault Recovery:** One product failure never terminates a batch; subsequent scheduled runs recover cleanly once upstream conditions normalize.

---

## Troubleshooting

| Issue | Cause | Solution |
|:---|:---|:---|
| `Failed to search products` | Backend server not running on port 3000. | Start backend with `npm start` or verify `VITE_API_BASE_URL`. |
| `ECONNREFUSED ::1:5432` | Database URL points to offline PostgreSQL. | Update `DATABASE_URL` with valid Supabase credentials or leave empty for in-memory mode. |
| `playwright: executable doesn't exist` | Chromium binary not installed. | Run `npx playwright install chromium`. |
| `401 UNAUTHORIZED` on batch scrape | Missing or invalid `X-Cron-Secret`. | Match the header token in cron-job.org to the `CRON_SECRET` env var on Render. |
| `409 Conflict` on batch scrape | A previous batch scrape is still running. | Concurrency lock prevents overlapping runs; wait for the current job to finish. |

---

## Security Considerations

1. **SSRF Prevention:** Product URLs are strictly validated against an allowed domain whitelist (`demo.inelabteamdev.com`). Arbitrary external domains are rejected with HTTP 400.
2. **Input Sanitization:** Product IDs are validated against strict numeric and UUID patterns to prevent injection attacks.
3. **No Secret Leaks:** Supabase service-role keys and database passwords execute exclusively on the server and are excluded from git via `.gitignore`.
4. **Cron Authentication:** Batch endpoints require a secret token header, preventing unauthorized external triggers.
5. **Row Locking:** Database updates use `SELECT ... FOR UPDATE` row locks to prevent race conditions during concurrent requests.

---

## Design Decisions

A complete, candid breakdown of technical trade-offs, dual-strategy extraction, free-tier scheduling solutions, and specific AI tool errors and corrections is documented in [`DESIGN_NOTE.md`](DESIGN_NOTE.md).
