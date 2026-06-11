import fs from 'fs'
import 'dotenv/config'
import { execSync } from 'child_process'
import Fuse from 'fuse.js'

const WATCHLIST_FILE = './watchlist.json'
const STATE_FILE = './state.json'

// Fuzzy match threshold (0 = perfect match, 1 = match anything)
// 0.4 is a good balance: tolerates typos and abbreviations but won't match unrelated strings
const FUZZY_THRESHOLD = 0.4

function loadWatchlist() {
  return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'))
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {}
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  return new Date() > new Date(expiresAt)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Haversine Distance (km) ---

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// --- Fuzzy Matching ---

function fuzzyMatchMovies(movies, movieFilter) {
  if (!movieFilter) return movies

  const fuse = new Fuse(movies, {
    keys: ['name', 'label'],
    threshold: FUZZY_THRESHOLD,
    ignoreLocation: true, // don't care where in the string the match is
    includeScore: true,
  })

  const results = fuse.search(movieFilter)

  if (results.length === 0) {
    console.log(`   ⚠️ No fuzzy match for "${movieFilter}" in [${movies.map((m) => m.name).join(', ')}]`)
    return []
  }

  console.log(
    `   🎯 Fuzzy matched "${movieFilter}" → ${results.map((r) => `"${r.item.name}" (score: ${r.score.toFixed(3)})`).join(', ')}`
  )

  return results.map((r) => r.item)
}

function fuzzyMatchFormat(sessions, formatFilter) {
  if (!formatFilter) return sessions

  // Format matching is simpler — case-insensitive includes is sufficient
  // since formats are short strings like "IMAX 2D", "4DX", "2D"
  const filterLower = formatFilter.toLowerCase()
  const matched = sessions.filter((s) => {
    const fmt = (s.scrnFmt || '').toLowerCase()
    const premLabel = (s.premiumLabel || '').toLowerCase()
    return fmt.includes(filterLower) || premLabel.includes(filterLower)
  })

  if (matched.length === 0) {
    console.log(`   ⚠️ No format match for "${formatFilter}"`)
  }

  return matched
}

// --- Data Fetching (via __NEXT_DATA__ JSON embedded in SSR page) ---

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.ok) return res
      if (res.status >= 500) {
        console.warn(`⚠️ Server error ${res.status}, retry ${i + 1}/${retries}`)
        await sleep(1000 * (i + 1))
        continue
      }
      return res // 4xx — don't retry
    } catch (err) {
      if (i === retries - 1) throw err
      console.warn(`⚠️ Fetch failed, retry ${i + 1}/${retries}: ${err.message}`)
      await sleep(1000 * (i + 1))
    }
  }
}

async function fetchCinemaData(baseUrl) {
  const res = await fetchWithRetry(baseUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })

  if (!res || !res.ok) {
    throw new Error(`HTTP ${res?.status || 'unknown'} fetching ${baseUrl}`)
  }

  const html = await res.text()

  // Extract __NEXT_DATA__ JSON from SSR page
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) {
    throw new Error('Could not find __NEXT_DATA__ in response')
  }

  const nextData = JSON.parse(match[1])
  const serverState = nextData.props?.pageProps?.data?.serverState

  if (!serverState) {
    throw new Error('No serverState found in __NEXT_DATA__')
  }

  // Find the cinema ID key (numeric keys only)
  const cinemaId = Object.keys(serverState).find((k) => /^\d+$/.test(k))
  if (!cinemaId) {
    throw new Error('No cinema ID found in serverState')
  }

  const cinemaData = serverState[cinemaId]

  return {
    sessionDates: cinemaData.data?.sessionDates || [],
    sessions: cinemaData.pageData?.sessions || [],
    movies: cinemaData.meta?.movies || [],
    cinema: cinemaData.meta?.cinema || {},
    cinemaId,
  }
}

// --- Movie Page Fetcher (type: "movie") ---

function buildLocationCookie(loc) {
  if (!loc) return null

  // Build the location JSON that district.in expects in the cookie
  const locationObj = {
    lat: loc.lat,
    long: loc.lon,
    title: loc.title || 'Location',
    subtitle: loc.subtitle || '',
    cityId: loc.cityId || 1,
    cityName: loc.cityName || 'Delhi NCR',
    pCityKey: loc.pCityKey || '',
    pCityName: loc.pCityName || '',
    countryId: '1',
    countryKey: 'india',
  }

  return `location=${encodeURIComponent(JSON.stringify(locationObj))}`
}

async function fetchMoviePage(movieUrl, location) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  }

  // Add location cookie if provided — district.in uses this to scope cinemas to your area
  const locationCookie = buildLocationCookie(location)
  if (locationCookie) {
    headers['Cookie'] = locationCookie
  }

  const res = await fetchWithRetry(movieUrl, { headers })

  if (!res || !res.ok) {
    throw new Error(`HTTP ${res?.status || 'unknown'} fetching ${movieUrl}`)
  }

  const html = await res.text()

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) {
    throw new Error('Could not find __NEXT_DATA__ in movie page response')
  }

  const nextData = JSON.parse(match[1])
  const pageType = nextData.props?.pageProps?.type
  const data = nextData.props?.pageProps?.data

  if (!data) {
    throw new Error('No data found in movie page __NEXT_DATA__')
  }

  const serverState = data.serverState
  if (!serverState?.movieData) {
    throw new Error('No serverState.movieData found')
  }

  // movieData is keyed by contentId (numeric string)
  const contentId = Object.keys(serverState.movieData)[0]
  if (!contentId) {
    throw new Error('No contentId found in movieData')
  }

  const movieEntry = serverState.movieData[contentId]
  const movieName = movieEntry.movie?.name || 'Unknown Movie'
  const showDates = movieEntry.showDates || []
  const cinemas = movieEntry.cinemas || []
  const isReleased = data.movieData?.meta?.isReleased ?? null

  return {
    pageType,
    contentId,
    movieName,
    showDates,
    cinemas,
    isReleased,
  }
}

// --- Movie Watcher Logic ---
// Primary use case: detect when booking STARTS for a movie (one-time notification).
// Once notified, it won't notify again (bookingNotified flag in state).
// Sends location cookie so district.in scopes results to your area.

async function checkMovieWatcher(item, state) {
  const watcherId = item.id || deriveIdFromUrl(item.url)
  console.log(`🎬 Checking movie watcher: ${watcherId}`)

  const data = await fetchMoviePage(item.url, item.location)
  console.log(`   🎥 ${data.movieName} — showDates: ${data.showDates.length}, cinemas: ${data.cinemas.length}, isReleased: ${data.isReleased}`)

  const watcherState = state[watcherId] || {}

  // Already notified — nothing to do
  if (watcherState.bookingNotified) {
    console.log(`   ✅ Already notified for this movie, skipping`)
    return { changed: false, watcherId }
  }

  // Check if booking has started (showDates is non-empty)
  if (data.showDates.length === 0) {
    console.log(`   ⏸ Booking not yet open`)
    // Save initial state so we track it
    if (!state[watcherId]) {
      state[watcherId] = { bookingNotified: false, lastChecked: todayISO() }
      return { changed: true, watcherId }
    }
    state[watcherId].lastChecked = todayISO()
    return { changed: true, watcherId }
  }

  // 🎉 Booking has started! Send one-time notification
  const datesStr = data.showDates.slice(0, 5).map(formatDate).join(', ')
  const moreStr = data.showDates.length > 5 ? ` (+${data.showDates.length - 5} more)` : ''

  let message = `🎬 Booking OPEN — ${data.movieName}!\n\n`
  message += `📅 Dates: ${datesStr}${moreStr}\n`

  if (item.formatFilter) {
    message += `🎞️ Wanted format: ${item.formatFilter}\n`
  }

  // Include nearby cinemas if returned
  if (data.cinemas.length > 0) {
    message += `\n🏟️ Cinemas near you:\n`
    for (const cinema of data.cinemas.slice(0, 8)) {
      const name = cinema.cinemaInfo?.name || cinema.cinemaInfo?.label || `Cinema ${cinema.id}`
      const dist = cinema.distanceFromUser ? ` (${cinema.distanceFromUser})` : ''
      message += `   • ${name}${dist}\n`
    }
    if (data.cinemas.length > 8) {
      message += `   ... and ${data.cinemas.length - 8} more\n`
    }
  }

  message += `\n🔗 ${item.url}\n\nBook fast 👀`

  await sendTelegram(message)
  console.log(`   🚨 Booking-started notification sent!`)

  // Mark as notified — won't notify again
  state[watcherId] = {
    bookingNotified: true,
    notifiedAt: todayISO(),
    showDates: data.showDates,
  }

  return { changed: true, watcherId }
}

// --- Notification Formatting ---

function formatSessionDetails(sessions, movies) {
  if (!sessions.length) return ''

  // Group sessions by movie
  const movieMap = new Map()
  for (const movie of movies) {
    movieMap.set(movie.id, movie)
  }

  const sessionsByMovie = new Map()
  for (const session of sessions) {
    const movieId = session.mid
    if (!sessionsByMovie.has(movieId)) {
      sessionsByMovie.set(movieId, [])
    }
    sessionsByMovie.get(movieId).push(session)
  }

  let details = ''
  for (const [movieId, movieSessions] of sessionsByMovie) {
    const movie = movieMap.get(movieId)
    const movieName = movie?.name || movieId
    const format = movieSessions[0]?.scrnFmt || ''
    const premiumLabel = movieSessions[0]?.premiumLabel || ''

    // Movie header with format
    details += `\n🎥 ${movieName}`
    if (premiumLabel) details += ` (${premiumLabel})`
    else if (format) details += ` (${format})`
    details += '\n'

    // Movie metadata: duration, censor, genres
    if (movie) {
      const meta = []
      if (movie.duration) meta.push(`${movie.duration} min`)
      if (movie.censor) meta.push(movie.censor)
      if (movie.grn?.length) meta.push(movie.grn.join(', '))
      if (meta.length) details += `   ℹ️ ${meta.join(' • ')}\n`
    }

    for (const session of movieSessions) {
      const time = new Date(session.showTime).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      const avail = session.avail
      const total = session.total
      const fillPct = total > 0 ? Math.round(((total - avail) / total) * 100) : 0
      const lang = session.lang || ''

      let fillIndicator = '🟢'
      if (session.statusColor === 'Y') fillIndicator = '🟡'
      else if (session.statusColor === 'R') fillIndicator = '🔴'

      // Price range from areas
      const priceStr = formatPriceRange(session.areas)

      // Per-category seat availability
      const seatsStr = formatSeatCategories(session.areas)

      details += `   ${fillIndicator} ${time}`
      if (lang) details += ` [${lang}]`
      details += ` — ${avail}/${total} seats`
      if (fillPct > 50) details += ` (${fillPct}%)`
      if (priceStr) details += ` • ${priceStr}`
      details += '\n'

      // Show per-category breakdown
      if (seatsStr) details += `      ${seatsStr}\n`
    }
  }

  return details
}

function formatSeatCategories(areas) {
  if (!areas || !areas.length) return ''

  // Show compact per-category availability
  const parts = areas
    .filter((a) => a.sAvail !== null && a.sAvail !== undefined)
    .map((a) => `${a.label}: ${a.sAvail}/${a.sTotal}`)

  if (parts.length === 0) return ''
  return parts.join(' | ')
}

function formatPriceRange(areas) {
  if (!areas || !areas.length) return ''

  const prices = areas.map((a) => a.price).filter(Boolean).sort((a, b) => a - b)
  if (prices.length === 0) return ''

  const min = prices[0]
  const max = prices[prices.length - 1]

  if (min === max) return `₹${min}`
  return `₹${min}–₹${max}`
}

function formatDateRange(dates) {
  if (!dates.length) return 'none'
  if (dates.length === 1) return formatDate(dates[0])

  const sorted = [...dates].sort()
  const first = formatDate(sorted[0])
  const last = formatDate(sorted[sorted.length - 1])
  return `${first} → ${last} (${sorted.length} days)`
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

// --- Core Logic ---

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
    console.log('ℹ️ Disable workflow triggered')
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

    // Route to appropriate handler based on type
    if (item.type === 'movie') {
      try {
        const result = await checkMovieWatcher(item, state)
        if (result.changed) stateChanged = true
      } catch (err) {
        console.error(`   ❌ Error: ${err.message}`)
      }
      await sleep(1500)
      continue
    }

    // --- Cinema watcher (default type) ---

    // Auto-derive ID from URL if not set
    const watcherId = item.id || deriveIdFromUrl(item.url)

    console.log(`🔍 Checking: ${watcherId}`)

    try {
      const cinemaData = await fetchCinemaData(item.url)
      const cinemaName = cinemaData.cinema.name || 'Unknown Cinema'

      console.log(`   📍 ${cinemaName}`)

      // Apply movie filter (fuzzy match)
      let relevantMovies = cinemaData.movies
      if (item.movieFilter) {
        relevantMovies = fuzzyMatchMovies(cinemaData.movies, item.movieFilter)
        if (relevantMovies.length === 0) {
          console.log(`   ⏸ Movie "${item.movieFilter}" not found at this cinema, skipping.`)
          continue
        }
      }

      // Apply format filter to sessions
      let relevantSessions = cinemaData.sessions
      if (item.movieFilter) {
        const movieIds = new Set(relevantMovies.map((m) => m.id))
        relevantSessions = relevantSessions.filter((s) => movieIds.has(s.mid))
      }
      if (item.formatFilter) {
        relevantSessions = fuzzyMatchFormat(relevantSessions, item.formatFilter)
      }

      // Determine available dates from filtered sessions, or fall back to all dates
      let dates = cinemaData.sessionDates
      if (item.movieFilter || item.formatFilter) {
        // Extract unique dates from filtered sessions
        const sessionDates = new Set(relevantSessions.map((s) => s.showTime.split('T')[0]))
        // Also include sessionDates that are beyond today (future dates without sessions loaded yet)
        dates = [...new Set([...sessionDates, ...cinemaData.sessionDates])].sort()
      }

      if (dates.length === 0) {
        console.warn('   ⚠️ No dates found, skipping.')
        continue
      }

      console.log(`   📅 Dates: ${dates.join(', ')}`)

      const maxDate = dates[dates.length - 1]
      const lastSeen = state[watcherId]?.lastMaxDate

      if (!lastSeen) {
        state[watcherId] = { lastMaxDate: maxDate, dates }
        stateChanged = true
        console.log(`   📌 Initial state saved`)
        continue
      }

      if (maxDate > lastSeen) {
        const previousDates = state[watcherId].dates || []
        const newDates = dates.filter((d) => !previousDates.includes(d) && d > lastSeen)

        await notify(
          { ...item, id: watcherId, cinema: cinemaName },
          maxDate,
          newDates,
          relevantSessions,
          relevantMovies
        )

        state[watcherId] = { lastMaxDate: maxDate, dates }
        stateChanged = true
      } else {
        console.log(`   ⏸ No new dates`)
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`)
    }

    await sleep(1500)
  }

  if (stateChanged) {
    saveState(state)
    commitStateIfChanged()
  }
}

function deriveIdFromUrl(url) {
  // Extract slug from URL: "pvr-imax-with-laser-priya-vasant-vihar-new-delhi-in-gurgaon-CD1022246"
  const match = url.match(/\/movies\/([^?]+)$/)
  return match ? match[1] : url
}

// --- Notifications ---

async function notify(item, newMaxDate, newDates, sessions, movies) {
  console.log('   🚨 NOTIFY — new date detected:', newMaxDate)

  const newDatesFormatted = newDates.length > 0 ? formatDateRange(newDates) : formatDate(newMaxDate)

  let message =
    `🎬 New show dates available!\n\n` + `📍 ${item.cinema}\n` + `📅 New: ${newDatesFormatted}\n`

  if (item.movieFilter) {
    message += `🔎 Filter: "${item.movieFilter}"`
    if (item.formatFilter) message += ` (${item.formatFilter})`
    message += '\n'
  }

  // Add session details if available
  if (sessions.length > 0) {
    const sessionInfo = formatSessionDetails(sessions, movies)
    if (sessionInfo) {
      message += `\n📋 Shows today:${sessionInfo}`
    }
  }

  message += `\n🔗 ${item.url}\n\nBook fast 👀`

  await sendTelegram(message)
}

async function notifyAllExpired() {
  const message =
    `🛑 District watcher stopped\n\n` +
    `All configured movies/cinemas have expired.\n` +
    `Cron job has been disabled automatically.`

  await sendTelegram(message)
}

async function sendHeartbeat(activeWatchersCount) {
  const message = `💓 District watcher heartbeat\n\nActive watchers: ${activeWatchersCount}\n`

  await sendTelegram(message)
  console.log('💓 Heartbeat sent')
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
    }),
  })

  if (!res || !res.ok) {
    console.error('❌ Telegram notification failed:', res?.status)
    return
  }

  console.log('   📨 Telegram notification sent')
}

// --- State Persistence ---

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

// --- Workflow Management ---

async function triggerDisableWorkflow() {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/disable-watcher.yml/dispatches`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WORKFLOW_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ ref: 'main' }),
  })

  if (!response || !response.ok) {
    const errorText = await response?.text()
    throw new Error(`GitHub API error: ${response?.status} - ${errorText}`)
  }

  console.log('🛑 Disable watcher workflow triggered successfully')
}

// --- Helpers ---

function shouldSendHeartbeat(state) {
  if (process.env.HEARTBEAT_ENABLED !== 'true') return false
  const last = state._meta?.lastHeartbeatDate
  return last !== todayISO()
}

// --- Main ---

console.log('🚀 District watcher run started')

try {
  await checkForNewDates()
  console.log('✅ Run completed')
} catch (err) {
  console.error('❌ Run failed:', err)
  process.exit(1)
}
