import * as cheerio from 'cheerio'
import fs from 'fs'
import 'dotenv/config'
import { execSync } from 'child_process'

const URL = `https://www.district.in/movies/pvr-imax-with-laser-priya-vasant-vihar-new-delhi-in-gurgaon-CD1022246?fromdate=${getTodayDate()}`
const STATE_FILE = './state.json'

function getTodayDate() {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { lastMaxDate: null }
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function fetchDates() {
  const res = await fetch(URL, {
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
  const state = loadState()
  const dates = await fetchDates()

  if (dates.length === 0) return

  const maxDate = dates[dates.length - 1]

  if (!state.lastMaxDate) {
    saveState({ lastMaxDate: maxDate })
    console.log('Initial state saved:', maxDate)
    return
  }

  if (maxDate > state.lastMaxDate) {
    await notify(maxDate)
    saveState({ lastMaxDate: maxDate })
    commitStateIfChanged()
  } else {
    console.log('No new dates. Latest:', maxDate)
  }
}

async function notify(newDate) {
  console.log('🚨 NOTIFY CALLED')
  console.log('New date detected:', newDate)

  const formattedDate = new Date(newDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  
  const message =
    `🎬 New show dates available!\n\n` +
    `📍 Priya PVR IMAX (Laser)\n` +
    `📅 Latest date: ${formattedDate}\n\n` +
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