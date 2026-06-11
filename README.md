<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/c0d39be2-1fdc-4a8e-9711-4933c5027e63" />


# 🎬 District Show Watcher

A lightweight automation that monitors movie show availability on [**District**](https://www.district.in/movies/) and notifies you via Telegram when new dates appear or when booking opens for a movie.

Built using **Node.js + GitHub Actions**, with zero paid infrastructure.

---

## ✨ Features

* 📅 Monitors show dates at specific cinemas (cinema watcher)
* 🎬 Detects when booking opens for a movie (movie watcher)
* 🔔 Telegram notifications with show details, seat info, fill status
* 🧠 State-aware — no duplicate alerts
* 🔍 Fuzzy matching for movie names (via fuse.js)
* 🎞️ Format filtering (IMAX, 4DX, Dolby, etc.)
* 📍 Location-aware movie watchers (sends location cookie to scope results)
* 📋 Config-driven via `watchlist.json`
* ⏱ Runs on GitHub Actions cron (every 30 min, free tier)
* 🛑 Auto-disables itself when all watchers expire

---

## 🧩 How it works

1. `watchlist.json` defines what to monitor (cinema pages or movie pages)
2. GitHub Actions runs `node app.js` every 30 minutes
3. The script fetches district.in pages and parses `__NEXT_DATA__` JSON from the SSR response
4. Changes are detected by comparing against `state.json`
5. Notifications are sent via Telegram Bot API
6. `state.json` is committed back to the repo after each run

No database. No server. No UI.

---

## 📁 Repository structure

```text
.
├── app.js                         # All application logic (single file)
├── watchlist.json                 # What to monitor (you edit this)
├── state.json                     # Persisted state (auto-managed, don't edit)
├── .env                           # Local env vars (git-ignored)
├── package.json                   # Dependencies
├── .github/workflows/
│   ├── district-watcher.yml       # Cron workflow (runs every 30 min)
│   ├── enable-watcher.yml         # Manual: activate cron on main
│   └── disable-watcher.yml        # Manual/auto: remove cron from main
└── .kiro/steering/                # AI assistant guidance
```

---

## 📝 Configuration — `watchlist.json`

This is the only file you need to edit. It's an array of watcher entries.

There are **two types** of watchers:

---

### Type 1: Cinema Watcher (`"type": "cinema"`)

Monitors a specific cinema page for new show dates. Useful when you know *which cinema* you want to watch and want to be notified when new days open up.

```json
{
  "type": "cinema",
  "id": "priya-imax-heman",
  "url": "https://www.district.in/movies/pvr-imax-with-laser-priya-vasant-vihar-new-delhi-in-gurgaon-CD1022246",
  "movieFilter": "he-man",
  "formatFilter": "IMAX",
  "enabled": true,
  "expiresAt": "2026-08-01"
}
```

#### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"cinema"` |
| `id` | Recommended | Unique identifier for state tracking. Auto-derived from URL if omitted. |
| `url` | Yes | District.in cinema page URL. Find it by going to a cinema's page on district.in and copying the URL. Ends with `CD` + numbers. |
| `movieFilter` | No | Fuzzy-matches movie name at that cinema. Tolerates typos, abbreviations, partial names. E.g. `"he-man"` matches "He-Man and the Masters of the Universe". |
| `formatFilter` | No | Case-insensitive filter for screen format. E.g. `"IMAX"`, `"4DX"`, `"Dolby"`. |
| `enabled` | Yes | Set to `false` to pause without deleting. |
| `expiresAt` | Recommended | ISO date (`YYYY-MM-DD`). Watcher is skipped after this date. When ALL watchers expire, the cron job auto-disables. |

#### How to get the URL

1. Go to [district.in](https://www.district.in/movies/)
2. Search for or navigate to a cinema
3. Copy the URL from the browser — it looks like:
   `https://www.district.in/movies/cinema-name-city-CD1234567`

---

### Type 2: Movie Watcher (`"type": "movie"`)

Monitors a movie page and sends a **one-time notification** when booking opens (i.e., `showDates` goes from empty to non-empty). This is for upcoming movies where you want to know the moment tickets become available.

```json
{
  "type": "movie",
  "id": "spiderman-booking",
  "url": "https://www.district.in/movies/spider-man-brand-new-day-movie-tickets-MV194537",
  "formatFilter": "IMAX",
  "location": {
    "lat": 28.4080424,
    "lon": 77.1165992,
    "title": "Gurugram",
    "subtitle": "Haryana",
    "cityId": 1,
    "cityName": "Delhi NCR",
    "pCityKey": "gurgaon",
    "pCityName": "Gurugram"
  },
  "enabled": true,
  "expiresAt": "2026-09-01"
}
```

#### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"movie"` |
| `id` | Recommended | Unique identifier for state tracking. Auto-derived from URL if omitted. |
| `url` | Yes | District.in movie page URL. Ends with `MV` + numbers. |
| `formatFilter` | No | Included in the notification message so you remember what format you wanted. |
| `location` | No | Your location — sent as a cookie so district.in returns cinemas near you in the response. See below for how to get this. |
| `enabled` | Yes | Set to `false` to pause. |
| `expiresAt` | Recommended | ISO date. Should be after the movie's expected release date. |

#### How to get the movie URL

1. Go to [district.in](https://www.district.in/movies/)
2. Search for the movie
3. Click on it to get the generic movie page (NOT a city-specific one)
4. Copy URL — looks like: `https://www.district.in/movies/movie-name-movie-tickets-MV123456`

#### How to get your location data

The `location` object tells district.in where you are so it returns cinemas near you. To get your location values:

1. Open district.in in Chrome on your phone or desktop
2. Make sure your location is set (it shows your city in the header)
3. Open DevTools → Application → Cookies → `www.district.in`
4. Find the `location` cookie
5. URL-decode the value (use browser console: `decodeURIComponent(value)`)
6. Copy the relevant fields into your watchlist entry:

| Location field | Where to find it | Example |
|---|---|---|
| `lat` | `lat` in cookie | `28.4080424` |
| `lon` | `long` in cookie | `77.1165992` |
| `title` | `title` in cookie | `"Gurugram"` |
| `subtitle` | `subtitle` in cookie | `"Haryana"` |
| `cityId` | `cityId` in cookie | `1` |
| `cityName` | `cityName` in cookie | `"Delhi NCR"` |
| `pCityKey` | `pCityKey` in cookie | `"gurgaon"` |
| `pCityName` | `pCityName` in cookie | `"Gurugram"` |

> **Note:** If you omit `location`, the movie watcher still works — it just won't scope results to your area. You'll still get notified when booking starts globally.

#### Behavior

- Checks every 30 minutes if `showDates` has become non-empty
- Sends **one notification** when booking opens, then marks `bookingNotified: true` in state
- Never notifies again for the same watcher (until you reset state)
- If `location` is set, the notification includes nearby cinemas

---

## 🔧 Environment Variables

### For GitHub Actions (Secrets)

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot's API token |
| `TELEGRAM_CHAT_ID` | Chat ID to send notifications to |
| `WORKFLOW_DISPATCH_TOKEN` | GitHub PAT with workflow permissions (for auto-disable) |

### For GitHub Actions (Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `HEARTBEAT_ENABLED` | `false` | Send a daily "I'm alive" message |
| `ALLOW_AUTO_DISABLE` | `false` | Allow auto-disable when all watchers expire |

### For local development (`.env` file)

```env
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

---

## 🧪 Local development

```bash
npm install
node app.js
```

Requires `.env` with at least `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for notifications to work. State updates and fetching work without secrets.

---

## ⚙️ GitHub Actions — Enable / Disable

### ▶️ Enable cron

```
Actions → Enable District Watcher → Run workflow
```

Copies the cron workflow from `watcher-enabled` branch to `main`. GitHub starts scheduling it.

### ⏹ Disable cron

```
Actions → Disable District Watcher → Run workflow
```

Removes the cron workflow from `main`. Also triggered automatically when all watchers expire (if `ALLOW_AUTO_DISABLE=true`).

---

## 💡 Tips

- **Multiple cinemas for one movie**: Add multiple cinema watchers with the same `movieFilter` but different URLs.
- **Multiple movies at one cinema**: Add multiple cinema watchers with the same URL but different `movieFilter` values.
- **Watching for booking to open**: Use a movie watcher. Once notified, add cinema watchers for your preferred cinemas.
- **Reset a movie watcher**: Delete its entry from `state.json` (or set `bookingNotified: false`) to get notified again.
- **Fuzzy matching**: `movieFilter` uses fuse.js with threshold 0.4. Short abbreviations like `"he-man"` will match `"He-Man and the Masters of the Universe"`.

---

## 🚫 Limitations

- GitHub Actions cron is best-effort (may be delayed 5-15 min)
- District.in may change their page structure (breaking `__NEXT_DATA__` parsing)
- Movie watcher only notifies once — it's a "booking started" detector, not continuous monitoring
- Location cookie may need updating if district.in changes their cookie format
