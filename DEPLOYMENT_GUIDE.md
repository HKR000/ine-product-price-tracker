# Complete Production Deployment Guide: Vercel + Render + Supabase + cron-job.org

This guide contains step-by-step instructions for deploying the **INE Product Price Tracker** to production from a clean machine without exposing secrets.

---

## Architecture Overview

```
┌────────────────────────────────────────┐
│              cron-job.org              │
│       (Pings every 2 hours)            │
└───────────────────┬────────────────────┘
                    │ POST /api/jobs/scrape-all
                    │ Header: X-Cron-Secret
                    ▼
┌────────────────────────────────────────┐       HTTP (REST)       ┌────────────────────────────────────────┐
│            Render.com                  │ ◄─────────────────────► │                Vercel                  │
│       (Node.js Express Backend)        │                         │          (React / Vite SPA)            │
│  - Playwright Chromium Scraping        │                         │  - Dashboard & Visual Analytics        │
│  - State Machine & Validation Engine   │                         │  - Time-Series Chart & Tables          │
└───────────────────┬────────────────────┘                         └────────────────────────────────────────┘
                    │
                    │ PostgreSQL Pool (SSL)
                    ▼
┌────────────────────────────────────────┐
│          Supabase PostgreSQL           │
│  - tracked_products                    │
│  - price_history                       │
│  - scrape_logs                         │
└────────────────────────────────────────┘
```

---

## Step 1: Supabase Database Setup

1. Log in to [Supabase](https://supabase.com/) and create a new project.
2. Under **Project Settings -> Database**:
   - Locate your **Connection String** (URI mode / Connection Pooling or Direct):
     `postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
     *(or direct port 5432)*.
3. Open the **SQL Editor** in your Supabase dashboard:
   - Copy the contents of [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql).
   - Paste and click **Run**.
4. Verify the 3 tables are created:
   - `tracked_products`
   - `price_history`
   - `scrape_logs`

---

## Step 2: Push Repository to GitHub

1. Initialize git and commit all source code (note that `.gitignore` prevents sensitive `.env` or `node_modules` from being included):
   ```bash
   git init
   git add .
   git commit -m "feat: production ready price tracker with hostile qa verification"
   ```
2. Create a new repository on [GitHub](https://github.com/new).
3. Push to your repository:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 3: Backend Deployment on Render

Render hosts the Express backend with Playwright Chromium installed.

### Option A: Automatic Deployment using Blueprint (`render.yaml`)
1. Go to [Render Dashboard](https://dashboard.render.com/) -> **New** -> **Blueprint**.
2. Select your GitHub repository.
3. Render will detect [`render.yaml`](render.yaml) and automatically configure the Web Service.
4. Set the required secret environment variables:
   - `DATABASE_URL`: Your Supabase connection string.
   - `CORS_ORIGIN`: Your Vercel frontend URL (e.g. `https://ine-price-tracker.vercel.app`, or `*` temporarily until Vercel URL is known).

### Option B: Manual Web Service Setup
1. On Render, click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure the following settings:
   - **Name:** `ine-price-tracker-backend`
   - **Region:** Any (e.g., Oregon or Frankfurt)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npx playwright install chromium`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Under **Environment Variables**, add:
   | Key | Value | Description |
   |:---|:---|:---|
   | `NODE_ENV` | `production` | Enables production optimizations & logging |
   | `PORT` | `10000` | Render default web port |
   | `DATABASE_URL` | `postgresql://postgres:...` | Supabase connection string |
   | `CRON_SECRET` | *(Generate a strong 32+ char token)* | Protects the scheduled scrape endpoint |
   | `CORS_ORIGIN` | `https://<YOUR-VERCEL-APP>.vercel.app` | Allowed frontend origin (no trailing slash) |
   | `MOCK_STORE_BASE_URL` | `https://demo.inelabteamdev.com` | Target store address |
   | `SCRAPER_MAX_ATTEMPTS`| `3` | State machine retry ceiling |
   | `SCRAPER_TIMEOUT_MS`  | `25000` | Browser navigation timeout |
   | `SCRAPER_HEADED`      | `false` | Headless mode on Linux cloud instances |
5. Click **Create Web Service**.
6. Wait for the build to finish. Once live, test the health check:
   ```bash
   curl https://<YOUR-RENDER-SERVICE-NAME>.onrender.com/health
   ```
   *Expected response:* `{"status":"healthy", ... "database":{"status":"connected"}}`

---

## Step 4: Frontend Deployment on Vercel

Vercel hosts the React + Vite single-page application.

1. Go to [Vercel Dashboard](https://vercel.com/) -> **Add New** -> **Project**.
2. Import your GitHub repository.
3. In **Project Settings**:
   - **Framework Preset:** `Vite`
   - **Root Directory:** Edit and set to `client` *(or leave as `./` since root `vercel.json` is configured)*.
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. In **Environment Variables**, add:
   | Key | Value | Description |
   |:---|:---|:---|
   | `VITE_API_BASE_URL` | `https://<YOUR-RENDER-SERVICE-NAME>.onrender.com` | Render Backend URL **without trailing slash** |
5. Click **Deploy**.
6. Once deployed, note your live Vercel URL (e.g. `https://ine-price-tracker.vercel.app`).
7. **Important CORS Step:** Go back to Render -> **Environment Variables** -> update `CORS_ORIGIN` to match your exact Vercel URL (`https://ine-price-tracker.vercel.app`).

---

## Step 5: Scheduled Scrape Setup on cron-job.org

Because free-tier Render services sleep after 15 minutes of inactivity, `cron-job.org` wakes the service and triggers the batch scrape every 2 hours.

1. Sign up at [cron-job.org](https://cron-job.org/).
2. Click **Create Cronjob**.
3. Configure the job:
   - **Title:** `INE Price Tracker 2-Hour Scrape`
   - **URL:** `https://<YOUR-RENDER-SERVICE-NAME>.onrender.com/api/jobs/scrape-all`
   - **Schedule:** `Every 2 hours` (or Cron expression: `0 */2 * * *`)
   - **Request Method:** `POST`
4. Under **Advanced / Headers**:
   - Add Header:
     - **Key:** `X-Cron-Secret`
     - **Value:** *(The exact `CRON_SECRET` configured in Render)*
5. Under **Notifications**:
   - Check **Notify on failure**.
6. Save and click **Test Run**.
   - *Expected response:* HTTP 200 with batch scrape JSON summary:
     ```json
     {
       "message": "Batch scrape completed: X succeeded, 0 failed",
       "total": X,
       "successCount": X,
       "failedCount": 0
     }
     ```

---

## Local Pre-Flight Verification Checklist

Before deploying, run these 3 verification commands locally from a clean shell:

```bash
# 1. Verify Frontend Production Build
npm run build
# -> Must exit with code 0 and generate client/dist/

# 2. Verify Backend Starts and Serves Health Endpoint
npm start
# -> Must listen on port 3000 and respond to /health

# 3. Verify Complete Automated Test Suite (97 Tests)
npm test
# -> Must pass 97 / 97 tests with 0 failures
```
