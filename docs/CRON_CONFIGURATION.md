# Production Scheduled Scraping Configuration (cron-job.org)

## 1. Architecture Flow

```
   cron-job.org (External Cron Service)
        │
        │ HTTP POST /api/jobs/scrape-all
        │ (Header: X-Cron-Secret: <CRON_SECRET>)
        ▼
   Render Backend (Express REST API)
        │
        │ 1. Verify X-Cron-Secret (401 if invalid)
        │ 2. Acquire batch concurrency lock (409 if active)
        │ 3. Query active items from tracked_products
        ▼
   Tracked Products List
        │
        ▼
   Playwright Scraper Engine
        │
        │ • Bypasses Proof-of-Work & telemetry traps
        │ • Isolates ephemeral browser contexts (< 200MB RAM)
        │ • Sequential loop: One product error does NOT break batch
        ▼
   Supabase PostgreSQL
        │
        ├── scrape_logs: Audit record per attempt (SUCCESS, RETRIED, FAILED)
        ├── price_history: Validated price snapshots (only on success)
        └── tracked_products: Latest valid price/stock updated atomically
```

---

## 2. Step-by-Step cron-job.org Setup

Follow these exact steps to configure automated 2-hour scraping:

### Step 1: Create a Free Account
1. Visit [https://cron-job.org](https://cron-job.org) and register or log in.
2. Navigate to **Cronjobs** &rarr; **Create cronjob**.

### Step 2: Configure Job Details
In the job creation form, fill in the following parameters:

| Field | Configuration Value | Notes |
|---|---|---|
| **Title** | `INE Price Tracker 2-Hour Scrape` | Identifies the job |
| **URL** | `https://<YOUR-RENDER-SERVICE>.onrender.com/api/jobs/scrape-all` | Replace with your live Render backend URL |
| **Execution schedule** | **Every 2 hours** (or `0 */2 * * *`) | Meets assignment 2-hour requirement |
| **Request method** | **`POST`** | Critical: Must be POST |
| **Request Timeout** | **`180 seconds`** (or max allowed) | Allows multi-item scraping and telemetry |

---

### Step 3: Configure Authentication Headers (Security)
Expand **Advanced Settings** &rarr; **Headers**:

Click **Add Header**:
* **Header Name**: `X-Cron-Secret`
* **Header Value**: `<YOUR_CRON_SECRET>` *(matches `CRON_SECRET` configured in Render environment variables)*

> [!IMPORTANT]
> The backend strictly rejects any request without this header with `HTTP 401 Unauthorized`.

---

### Step 4: Configure Error Notifications
Under **Notifications**:
* Enable **Notify on failure**.
* Set **After failures**: `1` (sends an instant email notification if Render backend or database encounters an error).
* Click **Save cronjob**.

---

## 3. Local Simulation & Verification

You do **not** need to wait 2 hours to verify that the scheduled scraping pipeline works. Use the built-in simulation tool:

```bash
npm run cron:simulate
```

### What the Simulation Tests:
1. **Security Guard**: Dispatches an unauthorized request without `X-Cron-Secret` and verifies the backend returns `401 Unauthorized`.
2. **Authorized Batch Trigger**: Dispatches an authorized `POST /api/jobs/scrape-all` with `X-Cron-Secret`.
3. **Execution Summary**: Outputs real-time statistics:
   * Total products monitored
   * Successful extractions
   * Products requiring retries
   * Failed extractions
   * Total execution duration in seconds
4. **Status Inspection**: Queries `GET /api/jobs/status` to verify lock state and last-run summary.

---

## 4. Concurrency Guard & Overlap Protection

If a previous scheduled run is still active when the next cron triggers:
* The backend inspects the active run timestamp.
* If active for less than 15 minutes, the overlapping request is rejected with `HTTP 409 Conflict` (`JOB_ALREADY_RUNNING`), preventing memory exhaustion or duplicate scrapes.
* If a previous run exceeded 15 minutes (stale process), the lock auto-expires to prevent deadlocks.
