# Video Demonstration Recording Script (2–4 Minutes)

This script provides an exact, step-by-step cue sheet for recording the assignment video walkthrough, designed to keep the final video strictly within the 2–4 minute evaluation window while clearly demonstrating reliability engineering, headed browser execution, and data integrity.

---

## Preparation Checklist Before Recording

1. **Start Backend Server**:
   ```bash
   npm start
   ```
   *(Running on `http://localhost:3000`)*

2. **Start Frontend Dashboard**:
   ```bash
   npm run client:dev
   ```
   *(Running on `http://localhost:5173`)*

3. **Split Screen / Dual Window Layout**:
   - **Left Half**: Web Browser showing the SaaS Dashboard (`http://localhost:5173`).
   - **Right Half**: Terminal / PowerShell for running CLI commands.

---

## Cue Sheet (Total Duration: ~3 Minutes 15 Seconds)

### [0:00 – 0:20] 1. Dashboard Overview
* **Visual**: Show the live SaaS dashboard (`http://localhost:5173`).
* **Actions**:
  - Point to the live backend health indicator (`System Operational`) in the top navigation bar.
  - Highlight the metrics cards: **Tracked Products**, **In Stock %**, **Successful Scrapes**, **Failed Scrapes**, and **Last Scrape**.
* **Voiceover / Caption Cue**:
  > *"This is the INE Price Tracker dashboard, built with React, Vite, and an Express REST backend. The system continuously tracks product prices, stock states, and full audit logs from the INE mock store without fabricating data."*

---

### [0:20 – 0:40] 2. Product Search (Lightweight Catalog Sync)
* **Visual**: Click the **Track New Product** button in the dashboard.
* **Actions**:
  - In the modal search box, type `toaster`.
  - Show instant results populating across the 1,000-item store catalog without launching heavy browser instances.
* **Voiceover / Caption Cue**:
  > *"We implement lightweight HTTP catalog synchronization with in-memory caching and 429 rate-limit backoff. The user can search across 1,000 products by name, SKU, or category instantly."*

---

### [0:40 – 1:00] 3. Track Product
* **Visual**: Click the **Track Product** button next to **Copperpot Toaster Lite (#391)**.
* **Actions**:
  - Show the modal close and product #391 appear in the Tracked Products table.
  - Show initial state: Status `PENDING`, Price `—`, Stock `—`.
* **Voiceover / Caption Cue**:
  > *"Tracking product #391 adds it to our Supabase PostgreSQL database. The backend enforces strict SSRF domain whitelisting and input sanitization before any scraping is allowed."*

---

### [1:00 – 1:30] 4. Headed Scraper & Anti-Bot Bypass
* **Visual**: Switch focus to terminal and run the observable headed scraper command:
  ```bash
  npm run scrape:headed -- 391
  ```
* **Actions**:
  - Show the visible Chromium window launch.
  - Show page navigation to `https://demo.inelabteamdev.com/product/391`.
  - Point out:
    1. Automatic suppression of the cookie consent modal trap (`display: none !important`).
    2. Realistic mouse movements dispatched to the price container satisfying the `minMoves: 8` and `minDwellMs: 600ms` bundle requirement.
    3. The button unlocking and the pointer click triggering the Proof-of-Work solver.
* **Voiceover / Caption Cue**:
  > *"Here is the observable headed scraper in action. The store implements adversarial traps: an intercepting cookie overlay, a Proof-of-Work requirement, and a mouse-movement telemetry gate. Our scraper solves the challenge, neutralizes the overlay, and dispatches realistic mouse trajectories."*

---

### [1:30 – 2:00] 5. Demonstrating Reliability: Slow / Failing Attempt
* **Visual**: In terminal, run the deterministic fault-injection demo mode:
  ```bash
  npm run scrape:headed -- 391 --fault-injection=transient
  ```
* **Actions**:
  - Show terminal output for **Attempt 1**:
    `[DEMO: FAULT-INJECTION] Simulating transient upstream HTTP 503 gateway spike on attempt 1`
  - Show Attempt 1 fail: `ATTEMPT_1_FAILED: Category = RETRY_CANDIDATE (503 Gateway Error)`.
  - Show state transition: `EXTRACTING -> RETRYING`.
* **Voiceover / Caption Cue**:
  > *"To verify resilience against real-world network turbulence, we trigger our deterministic test mode. On Attempt 1, an upstream 503 error occurs. The Retry Policy classifies this as a retry candidate rather than crashing."*

---

### [2:00 – 2:20] 6. Retry & Exponential Backoff
* **Visual**: Observe the backoff delay in terminal.
* **Actions**:
  - Show the exponential backoff calculation with jitter (`~1.5s`).
  - Show **Attempt 2** automatically initiated.
  - Show the visible Chromium browser window re-open cleanly.
* **Voiceover / Caption Cue**:
  > *"The scraper initiates exponential backoff with jitter to prevent thundering herds, cleanly reallocating a fresh ephemeral browser context for Attempt 2."*

---

### [2:20 – 2:40] 7. Successful Extraction & Validation Gate
* **Visual**: Watch Attempt 2 resolve the price in the browser window and output the terminal audit report.
* **Actions**:
  - Show the browser window revealing the real price: `₹ 9,886`.
  - Show terminal table output:
    - Extracted Price: `₹ 9,886`
    - Stock Status: `IN_STOCK (164 units)`
    - Decoy prices (`aria-hidden="true"`) filtered out.
    - Full-width unicode digits normalized.
    - Validation Gate passed (`price > 0`, non-zero, non-NaN).
* **Voiceover / Caption Cue**:
  > *"Attempt 2 succeeds. The normalizer strips decoy prices and unicode characters, and our validation gate ensures only non-zero, positive prices are ever accepted."*

---

### [2:40 – 3:00] 8. Dashboard History & Audit Log Inspection
* **Visual**: Return to the React dashboard (`http://localhost:5173`).
* **Actions**:
  - Click **Refresh** or **View Details** on product #391.
  - Show the **Price History Chart** (interactive SVG line chart showing the newly recorded price point).
  - Show the **Price & Stock Table**.
  - Open the **Scrape Activity & Audit Logs** tab:
    - Point out the honest audit logs:
      - Attempt 1: `RETRIED` (showing the 503 error message).
      - Attempt 2: `SUCCESS` (showing 9,886 and 164 units).
    - Note that **zero fake price rows** were inserted into price history during Attempt 1.
* **Voiceover / Caption Cue**:
  > *"Back in the dashboard, the detail modal displays the validated price history chart. Crucially, the scrape audit panel transparently records both the retried attempt and the successful attempt—proving that failures never write corrupted or zero prices into history."*

---

### [3:00 – 3:15] 9. Production Architecture & Conclusion
* **Visual**: Switch to `docs/CRON_CONFIGURATION.md` or the terminal.
* **Actions**:
  - Run the local simulation verification:
    ```bash
    npm run cron:simulate
    ```
  - Highlight the 4/4 passed checks: 401 unauthorized rejection, product batch scrape, overlap lock guard (409 conflict), and idle transition.
* **Voiceover / Caption Cue**:
  > *"For production, scheduled scrapes run every 2 hours via cron-job.org with authorization headers and concurrency locks—completely eliminating in-process setInterval timers. The system is robust, auditable, and ready for production deployment on Render and Supabase."*

---

## Quick Summary of CLI Commands for the Video

| Scenario | Command | Expected Output |
|---|---|---|
| **Standard Headed Scrape** | `npm run scrape:headed -- 391` | Headed browser, solves PoW, extracts real price in ~10s |
| **Transient Retry Demo** | `npm run scrape:headed -- 391 --fault-injection=transient` | Attempt 1: 503 error &rarr; backoff &rarr; Attempt 2: live success |
| **Real Store 404 Demo** | `npm run scrape:headed -- 99999` | Non-retryable 404 halt, zero corrupt data stored |
| **Cron Scheduler Simulation** | `npm run cron:simulate` | 401 auth test, batch scrape, 409 overlap guard |
