// Anytime-TD legs for the home-page bet generator.
// The Touchdowns tab reads the week file. This pool is computed from the same
// season box scores Flyers uses, because the home page never remaps nflverse
// player ids onto the ESPN roster, and that join was leaving the pool empty.
//
// Confidence = 1 - exp(-λ_position × player share).
// λ_position is the half-life-weighted touchdowns that position scored against
// this defense. Player share mixes that player's weighted touchdowns and
// carries or targets with the goal-line role weight from the RB sheet.
import { americanImplied } from '../matchupValue.js'
import { historyFor, sides, valid, weighted } from './model.js'
import { findRb, findWr, roleDecision, tdWeight } from './roleEligibility.js'
import { normName } from './parlayBoard.js'
import { scatterAbbrev } from './scatterCheck.js'

export const MISMATCH_MIN_EDGE = 0.05
export const MISMATCH_MIN_RATIO = 1.25
export const MISMATCH_BIG_EDGE = 0.10
export const HIGH_CONFIDENCE_MIN = 0.40

const POSITIONS = ['QB', 'RB', 'WR', 'TE']
const LEAK_RATE = 0.35
const LEAK_LAMBDA = 0.45
const MIN_PROBABILITY = 0.04

function positionOf(player) {
  if (player?.position === 'FB') return 'RB'
  return player?.position || ''
}

function scoredTd(player, position = positionOf(player)) {
  if (position === 'QB') return valid(player?.rushTD) ? player.rushTD : null
  if (!POSITIONS.includes(position)) return null
  if (!valid(player?.rushTD) || !valid(player?.recTD)) return null
  return player.rushTD + player.recTD
}

function usageKey(position) {
  return position === 'WR' || position === 'TE' ? 'targets' : 'carries'
}

function decimalPrice(american) {
  const price = Number(american)
  if (!Number.isFinite(price) || price === 0) return null
  return price > 0 ? 1 + price / 100 : 1 + 100 / -price
}

function bookRank(book) {
  const text = String(book || '')
  if (/draft\s?kings/i.test(text)) return 0
  if (/fan\s?duel/i.test(text)) return 1
  return 2
}

export function bookShort(book) {
  const text = String(book || '')
  if (/draft\s?kings/i.test(text)) return 'DK'
  if (/fan\s?duel/i.test(text)) return 'FD'
  const clean = text.replace(/\(.*\)/, '').trim()
  return clean || 'book'
}

export function preferBook(quotes) {
  const priced = (quotes || []).filter(quote => Number.isFinite(Number(quote?.price)) && Number(quote.price) !== 0)
  priced.sort((a, b) => bookRank(a.book) - bookRank(b.book) || String(a.book).localeCompare(String(b.book)))
  return priced[0] || null
}

function addQuote(map, name, price, book) {
  const key = normName(name)
  const number = Number(price)
  if (!key || !Number.isFinite(number) || number === 0) return
  const list = map.get(key) || []
  list.push({ price: number, book: book || '' })
  map.set(key, list)
}

function picksOf(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

/** DraftKings, then FanDuel, then any other saved anytime-TD price, keyed by player. */
export function collectTdPrices(tdData, parlayData) {
  const map = new Map()
  for (const game of tdData?.games || []) {
    for (const side of game.sides || []) {
      for (const row of side.rows || []) {
        for (const slot of ['confident', 'relativelySafe', 'upside']) {
          for (const pick of picksOf(row?.[slot])) {
            if (pick?.prop !== 'Anytime TD') continue
            addQuote(map, pick.player, pick.price, pick.book)
          }
        }
      }
    }
  }
  for (const game of Object.values(parlayData?.games || {})) {
    for (const leg of game?.legs || []) {
      if (leg?.kind !== 'td' && leg?.market !== 'anytime TD') continue
      addQuote(map, leg.player, leg.price, leg.book)
    }
  }
  const chosen = new Map()
  for (const [key, quotes] of map) {
    const best = preferBook(quotes)
    if (best) chosen.set(key, best)
  }
  return chosen
}

export function bookGap(probability, price, oppositePrice) {
  const model = Number(probability)
  const quoted = Number(price)
  if (!Number.isFinite(model) || !Number.isFinite(quoted) || quoted === 0) return null
  const raw = americanImplied(quoted)
  if (raw == null || raw <= 0) return null
  let bookProb = raw
  let vigRemoved = false
  const other = americanImplied(oppositePrice)
  if (other != null && other > 0) {
    bookProb = raw / (raw + other)
    vigRemoved = true
  }
  if (!(bookProb > 0)) return null
  const edge = model - bookProb
  return {
    edge,
    ratio: model / bookProb,
    bookProb,
    vigRemoved,
    likely: model + 1e-9 >= HIGH_CONFIDENCE_MIN,
    big: edge + 1e-9 >= MISMATCH_BIG_EDGE,
  }
}

export function classifyMismatch(probability, price, oppositePrice) {
  const gap = bookGap(probability, price, oppositePrice)
  if (!gap || gap.edge + 1e-9 < MISMATCH_MIN_EDGE || gap.ratio + 1e-9 < MISMATCH_MIN_RATIO) return null
  return gap
}

/** 3 = TD mismatch the model also likes, 2 = other TD mismatch, 1 = any other mismatch. */
export function mismatchRank(leg) {
  if (!leg?.mismatch) return 0
  if (leg.type === 'td' && leg.mismatch.likely) return 3
  if (leg.type === 'td') return 2
  return 1
}

export function defenseTdProfile(data, defenseId, halfLife, beforeDate) {
  const games = historyFor(data, defenseId).filter(game => !beforeDate || Date.parse(game.date) < Date.parse(beforeDate))
  const rows = { QB: [], RB: [], WR: [], TE: [] }
  for (const game of games) {
    const [, offense] = sides(game, defenseId)
    const players = offense?.playerBox?.players || []
    if (!players.length) continue
    const totals = { QB: 0, RB: 0, WR: 0, TE: 0 }
    let seen = false
    for (const player of players) {
      const position = positionOf(player)
      if (!rows[position]) continue
      const scored = scoredTd(player, position)
      if (scored == null) continue
      seen = true
      totals[position] += scored
    }
    if (!seen) continue
    for (const position of POSITIONS) rows[position].push({ value: totals[position], scored: totals[position] >= 1 ? 1 : 0 })
  }
  const profile = {}
  for (const position of POSITIONS) {
    const lambda = weighted(rows[position], 'value', halfLife)
    const rate = weighted(rows[position], 'scored', halfLife)
    profile[position] = { lambda: lambda || 0, rate: rate || 0, n: rows[position].length }
  }
  return profile
}

function offensePlayers(data, team, beforeDate) {
  const games = historyFor(data, team.id).filter(game => !beforeDate || Date.parse(game.date) < Date.parse(beforeDate))
  const recent = new Set()
  for (const game of games.slice(-2)) {
    const [self] = sides(game, team.id)
    for (const player of self?.playerBox?.players || []) recent.add(player.id)
  }
  const logs = new Map()
  const meta = new Map()
  for (const game of games) {
    const [self] = sides(game, team.id)
    for (const player of self?.playerBox?.players || []) {
      const position = positionOf(player)
      if (!POSITIONS.includes(position) || !recent.has(player.id)) continue
      const list = logs.get(player.id) || []
      list.push(player)
      logs.set(player.id, list)
      meta.set(player.id, { id: player.id, name: player.name, position })
    }
  }
  return [...meta.values()].map(player => ({ ...player, logs: logs.get(player.id) || [] }))
}

function shareRows(players, halfLife, book, teamName) {
  const groups = new Map()
  for (const player of players) {
    const list = groups.get(player.position) || []
    list.push(player)
    groups.set(player.position, list)
  }
  const rows = []
  for (const [position, list] of groups) {
    const eligible = []
    for (const player of list) {
      const decision = roleDecision(
        { name: player.name, position, team: { name: teamName } },
        { statKey: 'totalTD', book },
      )
      if (!decision.eligible) continue
      const tdLogs = player.logs.map(log => ({ total: scoredTd(log, position) })).filter(log => valid(log.total))
      const td = weighted(tdLogs, 'total', halfLife) || 0
      const usage = weighted(player.logs, usageKey(position), halfLife) || 0
      const rb = position === 'RB' ? findRb(player.name, book) : null
      const wr = position === 'WR' ? findWr(player.name, teamName, book) : null
      const role = position === 'RB' ? tdWeight(rb) : 1
      eligible.push({ player, td, usage, role, rb, wr, note: decision.note || null })
    }
    const tdSum = eligible.reduce((sum, row) => sum + row.td, 0)
    const useSum = eligible.reduce((sum, row) => sum + row.usage, 0)
    const weightedRows = eligible.map(row => {
      const tdShare = tdSum > 0 ? row.td / tdSum : 0
      const useShare = useSum > 0 ? row.usage / useSum : (eligible.length ? 1 / eligible.length : 0)
      const mix = tdSum > 0 ? 0.65 * tdShare + 0.35 * useShare : useShare
      return { ...row, raw: Math.max(0, mix * row.role) }
    })
    const rawSum = weightedRows.reduce((sum, row) => sum + row.raw, 0)
    for (const row of weightedRows) rows.push({ ...row, share: rawSum > 0 ? row.raw / rawSum : 0 })
  }
  return rows
}

function isSleeper(row, group) {
  const position = row.player.position
  if (position === 'RB') {
    if (row.rb?.depth) return /^RB[2-9]/.test(row.rb.depth)
    const leader = Math.max(...group.map(item => item.usage))
    return group.length > 1 && row.usage + 1e-9 < leader
  }
  if (position === 'WR') {
    if (row.wr?.rank) return row.wr.rank === 'WR3'
    const ranked = [...group].sort((a, b) => b.usage - a.usage || a.player.name.localeCompare(b.player.name))
    return ranked.length >= 3 && ranked.slice(2).some(item => item.player.id === row.player.id)
  }
  if (position === 'TE') {
    if (group.length < 2) return false
    const leader = Math.max(...group.map(item => item.usage))
    return row.usage + 1e-9 < leader
  }
  return false
}

function roleLabel(row) {
  if (row.rb?.depth) return row.rb.depth
  if (row.wr?.rank) return row.wr.rank
  if (row.player.position === 'TE') return 'TE'
  if (row.player.position === 'QB') return 'QB rush'
  return row.player.position
}

function leaks(profile) {
  return profile.rate >= LEAK_RATE || profile.lambda >= LEAK_LAMBDA
}

export function filterTdAxis(legs, mode = 'mix') {
  if (mode === 'confidence') return (legs || []).filter(leg => leg.axis === 'confidence' || leg.axis === 'both')
  if (mode === 'value') return (legs || []).filter(leg => leg.axis === 'value' || leg.axis === 'both')
  return (legs || []).filter(leg => leg.axis === 'confidence' || leg.axis === 'value' || leg.axis === 'both')
}

/**
 * One anytime-TD leg per recent skill player on each unstarted offense.
 * `mode` is stored on the leg; callers filter with filterTdAxis.
 */
export function buildTdScorers({ data, matchups, halfLife = 3, book = null, prices = new Map() } = {}) {
  const legs = []
  for (const game of matchups || []) {
    if (game?.started || game?.final || !game?.away?.abbr || !game?.home?.abbr) continue
    for (const [offense, defense] of [[game.away, game.home], [game.home, game.away]]) {
      if (!offense?.id) continue
      const profile = defenseTdProfile(data, defense.id, halfLife, game.date)
      const players = offensePlayers(data, offense, game.date)
      const shares = shareRows(players, halfLife, book, offense.name)
      const computed = []
      for (const row of shares) {
        const spot = profile[row.player.position] || { lambda: 0, rate: 0, n: 0 }
        const lambda = spot.lambda * row.share
        const prob = lambda > 0 ? 1 - Math.exp(-lambda) : 0
        if (!(prob >= MIN_PROBABILITY)) continue
        const quote = prices.get(normName(row.player.name)) || null
        const price = quote ? quote.price : null
        const dec = decimalPrice(price)
        const implied = price == null ? null : americanImplied(price)
        const ev = dec == null || implied == null ? null : prob * dec - 1
        const group = shares.filter(item => item.player.position === row.player.position)
        const sleeper = isSleeper(row, group)
        const leak = leaks(spot)
        computed.push({ row, spot, prob, price, book: quote?.book || '', ev, sleeper, leak })
      }
      computed.sort((a, b) => b.prob - a.prob || a.row.player.name.localeCompare(b.row.player.name))
      computed.forEach((item, index) => {
        const highConfidence = index < 2 || item.prob >= HIGH_CONFIDENCE_MIN
        const highValue = Boolean(item.sleeper && item.leak && item.ev != null && item.ev > 0)
        let axis = null
        if (highConfidence && highValue) axis = 'both'
        else if (highConfidence) axis = 'confidence'
        else if (highValue) axis = 'value'
        if (!axis) return
        const player = item.row.player
        legs.push({
          id: `td:${game.id}:${normName(player.name)}`,
          type: 'td',
          gameId: game.id,
          gameLabel: `${game.away.abbr} at ${game.home.abbr}`,
          kickoff: game.date || '',
          playerId: normName(player.name),
          playerName: player.name,
          team: offense.abbr,
          teamName: offense.name || offense.abbr,
          logo: offense.logo || null,
          title: `${player.name} anytime TD`,
          subtitle: `${roleLabel(item.row)} · ${scatterAbbrev(defense.abbr) || defense.abbr} defense`,
          detail: item.spot.n
            ? `${defense.abbr} allows ${item.spot.lambda.toFixed(2)} ${player.position} TDs/game · share ${Math.round(item.row.share * 100)}%`
            : '',
          market: 'Anytime TD',
          confidence: item.prob,
          valueScore: item.ev == null ? 0 : item.ev,
          priced: item.price != null,
          price: item.price,
          book: item.book,
          kelly: null,
          edge: null,
          axis,
          sleeper: item.sleeper,
          leak: item.leak,
        })
      })
    }
  }
  return legs
}
