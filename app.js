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

  for (const item of watchlist) {
    if (!item.enabled) continue

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
  }

  if (stateChanged) {
    saveState(state)
    commitStateIfChanged()
  }
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



// async function localTest() {
//   console.log('--- Local Test Started ---')

//   const dates = await fetchDates()
//   console.log('Fetched dates:', dates)

//   await checkForNewDates()

//   console.log('--- Local Test Finished ---')
// }

// localTest()