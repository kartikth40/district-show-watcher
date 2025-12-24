<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/c0d39be2-1fdc-4a8e-9711-4933c5027e63" />


# 🎬 District Show Watcher

A lightweight automation that monitors movie show availability on [**District**](https://www.district.in/movies/) and notifies you when new dates appear for selected cinemas.

Built using **Node.js + GitHub Actions**, with zero paid infrastructure.

---

## ✨ Features

* 📅 Monitors movie show dates on District
* 🔔 Sends Telegram notifications when new dates appear
* 🧠 State-aware (no duplicate alerts)
* 📋 Config-driven via `watchlist.json`
* ⏱ Runs on GitHub Actions (free tier)
* ▶️ Manually enable / ⏹ disable cron execution
* 🛑 Automatically stops itself when all movies expire

---

## 🧩 How it works (high level)

1. A **watchlist** defines which movies & cinemas to monitor
2. A scheduled GitHub Action checks District pages periodically
3. New dates are detected by comparing against persisted state
4. Notifications are sent via Telegram
5. When all watchers expire, the cron job disables itself

No database. No server. No UI.

---

## 📁 Repository structure

```text
.
├── app.js                         # Main watcher logic
├── watchlist.json                 # Movies / cinemas to track
├── state.json                     # Last-seen dates (auto-updated)
├── .github/workflows/
│   ├── district-watcher.yml       # Cron workflow (non-default branch)
│   ├── enable-watcher.yml         # Manual: enable cron
│   └── disable-watcher.yml        # Manual: disable cron
└── README.md
```

---

## 📝 Configuration

### 1️⃣ `watchlist.json`

Each entry represents one movie + cinema to watch.

```json
[
  {
    "id": "avatar-priya-imax",
    "movie": "Avatar: Fire and Ash",
    "cinema": "PVR IMAX Priya Vasant Vihar",
    "url": "https://www.district.in/movies/...",
    "enabled": true,
    "expiresAt": "2026-01-15"
  }
]
```

**Fields**

* `id` – unique identifier (used for state tracking)
* `movie` – movie name (for notifications)
* `cinema` – cinema name (for notifications)
* `url` – District cinema page URL (without `fromdate`)
* `enabled` – toggle watcher on/off
* `expiresAt` – date after which watcher is ignored

---

### 2️⃣ `state.json`

Auto-managed file that stores the last detected show date per watcher.

```json
{
  "avatar-priya-imax": {
    "lastMaxDate": "2025-12-25"
  }
}
```

⚠️ Do not edit this manually (except for testing).

---

## 🔔 Notifications

Notifications are sent via **Telegram Bot API**.

### Required secrets (GitHub → Settings → Secrets → Actions)

* `TELEGRAM_BOT_TOKEN`
* `TELEGRAM_CHAT_ID`

---

## ⚙️ GitHub Actions setup

### Important design choice

> **The cron workflow is NOT on the default branch.**

This allows the scheduler to be **fully stopped** when not needed.

---

### ▶️ Enable cron (manual)

Run this workflow from GitHub UI:

```
Actions → Enable District Watcher → Run workflow
```

What it does:

* Copies the cron workflow from a non-default branch into `main`
* GitHub scheduler starts executing it

---

### ⏹ Disable cron (manual or automatic)

Run this workflow:

```
Actions → Disable District Watcher → Run workflow
```

What it does:

* Removes the cron workflow from `main`
* GitHub stops scheduling immediately

This is also triggered automatically when:

* All movies in `watchlist.json` have expired
* `ALLOW_AUTO_DISABLE=true` is set

---

## 🛑 Auto-disable safety guard

To prevent accidental shutdowns, auto-disable is **opt-in**.

### GitHub Actions Variable

```
ALLOW_AUTO_DISABLE = false
```

Set to `true` only when you want automatic shutdown to be allowed.

---

## 🧠 Why this design?

* GitHub cron is **best-effort**, not guaranteed
* Scheduled workflows cannot be dynamically disabled
* Removing the workflow file is the **only true way** to stop cron

This repo implements a **safe, explicit lifecycle** for scheduled jobs.

---

## 🧪 Local development

```bash
npm install
node app.js
```

Notes:

* Telegram + GitHub APIs are skipped locally
* State updates still work
* No secrets required locally

---

## 🚫 Limitations

* GitHub Actions cron timing is not exact
* Runs may be delayed or skipped
* Designed for polling use-cases (not real-time alerts)
