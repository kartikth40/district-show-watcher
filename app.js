import * as cheerio from 'cheerio'
import fs from 'fs'
import 'dotenv/config'
import { execSync } from 'child_process'

const WATCHLIST_FILE = './watchlist.json'
const STATE_FILE = './state.json'

function loadWatchlist() {
  return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'))
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {}
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
}

function getTodayDate() {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function fetchDates(baseUrl) {
  const url = `${baseUrl}?fromdate=${getTodayDate()}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  })

  const html = await res.text()
  const $ = cheerio.load(html)

  const dates = new Set()

  $("a[href*='fromdate=']").each((_, el) => {
    const href = $(el).attr('href')
    const match = href.match(/fromdate=(\d{4}-\d{2}-\d{2})/)
    if (match) {
      dates.add(match[1])
    }
  })

  return [...dates].sort()
}

async function checkForNewDates() {
  const watchlist = loadWatchlist()
  const state = loadState()
  let stateChanged = false

  const activeWatchers = watchlist.filter((item) => item.enabled && !isExpired(item.expiresAt))

  if (activeWatchers.length === 0) {
    console.log('🏁 All watchers expired')
    if (process.env.ALLOW_AUTO_DISABLE !== 'true') {
      console.log('⚠️ Auto-disable is not allowed. Exiting.')
      return
    }
    await notifyAllExpired()
    await triggerDisableWorkflow()
    console.log("ℹ️ Disable workflow triggered")
    process.exit(0)
  }

  if (shouldSendHeartbeat(state)) {
    await sendHeartbeat(activeWatchers.length)

    state._meta = {
      ...(state._meta || {}),
      lastHeartbeatDate: todayISO(),
    }

    stateChanged = true
  }

  for (const item of watchlist) {
    if (!item.enabled) continue

    if (isExpired(item.expiresAt)) {
    console.log(`⏹ Skipping expired watcher: ${item.id}`)
    continue
  }

    console.log(`🔍 Checking: ${item.movie} @ ${item.cinema}`)

    const dates = await fetchDates(item.url)
    if (dates.length === 0) continue

    const maxDate = dates[dates.length - 1]
    const lastSeen = state[item.id]?.lastMaxDate

    if (!lastSeen) {
      state[item.id] = { lastMaxDate: maxDate }
      stateChanged = true
      console.log(`📌 Initial state saved for ${item.id}`)
      continue
    }

    if (maxDate > lastSeen) {
      await notify(item, maxDate)
      state[item.id].lastMaxDate = maxDate
      stateChanged = true
    } else {
      console.log(`⏸ No new dates for ${item.id}`)
    }

    await sleep(1000)
  }

  if (stateChanged) {
    saveState(state)
    commitStateIfChanged()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function notify(item, newDate) {
  console.log('🚨 NOTIFY CALLED')
  console.log('New date detected:', newDate)

  const formattedDate = new Date(newDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const message =
    `🎬 New show dates available!\n\n` +
    `🎥 ${item.movie}\n` +
    `📍 ${item.cinema}\n` +
    `📅 Latest date: ${formattedDate}\n\n` +
    `🔗 ${item.url}\n\n` +
    `Book fast 👀`

  await sendTelegram(message)
}

console.log('🚀 District watcher run started')

try {
  await checkForNewDates()
  console.log('✅ Run completed')
} catch (err) {
  console.error('❌ Run failed:', err)
  process.exit(1)
}

function commitStateIfChanged() {
  try {
    execSync('git config user.name "github-actions[bot]"')
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"')

    execSync('git add state.json')
    execSync('git diff --cached --quiet || git commit -m "chore: update watcher state"')
    execSync('git push')

    console.log('📦 state.json committed')
  } catch (err) {
    console.log('ℹ️ No state changes to commit')
  }
}

async function notifyAllExpired() {
  const message =
    `🛑 District watcher stopped\n\n` +
    `All configured movies/cinemas have expired.\n` +
    `Cron job has been disabled automatically.`

  await sendTelegram(message)
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
    }),
  })

  console.log('📨 Telegram notification sent')
}


function isExpired(expiresAt) {
  if (!expiresAt) return false
  return new Date() > new Date(expiresAt)
}

async function triggerDisableWorkflow() {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/disable-watcher.yml/dispatches`

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      ref: 'main',
    }),
  })

  console.log('🛑 Disable watcher workflow triggered')
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function shouldSendHeartbeat(state) {
  if (process.env.HEARTBEAT_ENABLED !== 'true') return false

  const last = state._meta?.lastHeartbeatDate
  return last !== todayISO()
}

async function sendHeartbeat(activeWatchersCount) {
  const message =
    `💓 District watcher heartbeat\n\n` +
    `Active watchers: ${activeWatchersCount}\n` +
    `Date: ${new Date().toUTCString()}`

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
    }),
  })

  console.log('💓 Heartbeat sent')
}




// async function localTest() {
//   console.log('--- Local Test Started ---')

//   const dates = await fetchDates()
//   console.log('Fetched dates:', dates)

//   await checkForNewDates()

//   console.log('--- Local Test Finished ---')
// }

// localTest()