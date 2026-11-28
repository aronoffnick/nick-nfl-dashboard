// Custom parlay builder. Legs come from the model's existing signals:
// one ML-or-spread pick per game (Kelly / edge), a season-weighted anytime TD rate,
// and the deduped prop list's hit chance `p`. Nothing here invents a price.
import { americanImplied, valueParlayLegs } from '../matchupValue.js'
import { coverProb } from '../teamParlayPick.js'
import { americanToDecimal, decimalToAmerican } from './betGenerator.js'
import { favoriteWinEstimate } from './diversifiedParlays.js'
import { valid, weightedShare } from './model.js'
import { boardGame, filePropCandidates, legHit, normName } from './parlayBoard.js'
import { scatterAbbrev, scatterGameKey } from './scatterCheck.js'
import { classifyMismatch, mismatchRank } from './tdScorers.js'

const TYPE_ORDER = { outcome: 0, td: 1, prop: 2 }
export function formatChance(value) {
  if (!Number.isFinite(value)) return '—'
  const pct = Math.round(value * 1000) / 10
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`
}

export function formatSignedChance(value) {
  if (!Number.isFinite(value)) return '—'
  const pct = Math.round(value * 1000) / 10
  const text = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)
  return `${pct > 0 ? '+' : ''}${text}%`
}

function wholeNumber(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const number = Number(text)
  return number >= 1 ? number : null
}

export function checkedTypes(types) {
  return ['outcome', 'td', 'prop'].filter(type => types?.[type])
}

export function validateCustomParlay({ legs, games, legsPerGame, types } = {}) {
  const legCount = wholeNumber(legs)
  const gameCount = wholeNumber(games)
  if (legCount == null) return { ok: false, message: 'Enter the number of legs as a whole number, 1 or more.' }
  if (gameCount == null) return { ok: false, message: 'Enter the number of games as a whole number, 1 or more.' }
  if (legCount > 12) return { ok: false, message: 'Use 12 legs or fewer.' }
  if (gameCount > 14) return { ok: false, message: 'Use 14 games or fewer.' }
  const perText = legsPerGame == null ? '' : String(legsPerGame).trim()
  let perGame = null
  if (perText !== '') {
    perGame = wholeNumber(perText)
    if (perGame == null) return { ok: false, message: 'Legs per game has to be a whole number, or left blank.' }
    const product = gameCount * perGame
    if (product !== legCount) {
      return {
        ok: false,
        message: `${gameCount} ${gameCount === 1 ? 'game' : 'games'} × ${perGame} ${perGame === 1 ? 'leg' : 'legs'} per game is ${product} legs, not ${legCount}. Change the counts, or clear legs per game.`,
      }
    }
  } else if (legCount < gameCount) {
    return { ok: false, message: `${legCount} ${legCount === 1 ? 'leg' : 'legs'} cannot cover ${gameCount} games. Add legs or use fewer games.` }
  }
  const selected = checkedTypes(types)
  if (!selected.length) return { ok: false, message: 'Select at least one of game outcomes, touchdown scorers, or props.' }
  if (selected.length === 1 && selected[0] === 'outcome' && legCount > gameCount) {
    return { ok: false, message: 'Each game has one outcome pick. Add games, reduce legs, or include touchdowns or props.' }
  }
  const note = selected.length > legCount
    ? `${legCount} ${legCount === 1 ? 'leg' : 'legs'} cannot include all ${selected.length} types, so the highest-ranked legs are used.`
    : null
  return {
    ok: true,
    note,
    input: {
      legs: legCount,
      games: gameCount,
      legsPerGame: perGame,
      types: { outcome: selected.includes('outcome'), td: selected.includes('td'), prop: selected.includes('prop') },
    },
  }
}

function signedSpread(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const rounded = Math.round(n * 10) / 10
  const body = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1)
  if (rounded > 0) return `+${body}`
  if (rounded < 0) return `-${body}`
  return 'PK'
}

function formatAmerican(price) {
  const n = Number(price)
  if (!Number.isFinite(n)) return ''
  return n > 0 ? `+${n}` : String(n)
}

function priceEdge(probability, price) {
  const implied = americanImplied(price)
  if (implied == null || !Number.isFinite(probability)) return null
  return probability - implied
}

export function seasonTdShare(logs, halfLife) {
  return weightedShare(logs || [], halfLife, log => {
    if (!valid(log?.rushTD) || !valid(log?.recTD)) return null
    return log.rushTD + log.recTD >= 1
  })
}

function outcomeLeg(game, team, pick) {
  const spread = pick.bet === 'Spread' ? signedSpread(pick.line) : ''
  return {
    id: `outcome:${game.id}:${scatterAbbrev(team.abbr)}`,
    type: 'outcome',
    gameId: game.id,
    gameLabel: `${game.away.abbr} at ${game.home.abbr}`,
    kickoff: game.date || '',
    playerId: null,
    team: team.abbr,
    teamName: team.name,
    logo: team.logo || null,
    title: spread ? `${team.name} ${spread}` : `${team.name} moneyline`,
    subtitle: pick.bet === 'Spread' ? 'Spread' : 'Moneyline',
    detail: [formatAmerican(pick.price), pick.book].filter(Boolean).join(' '),
    confidence: pick.prob,
    valueScore: Number(pick.kelly) || 0,
    priced: true,
    price: pick.price,
    book: pick.book || '',
    oppositePrice: pick.oppositePrice ?? null,
    kelly: pick.kelly,
    edge: pick.edge,
  }
}

function modelOutcomes(matchups, oddsFile) {
  const byId = new Map((matchups || []).map(game => [game.id, game]))
  return valueParlayLegs(matchups, oddsFile).map(leg => {
    const game = byId.get(leg.gameId)
    return outcomeLeg(game || { id: leg.gameId, away: { abbr: leg.team }, home: { abbr: '' }, date: '' }, {
      abbr: leg.team, name: leg.teamName, logo: leg.logo,
    }, { ...leg, prob: leg.prob, line: leg.line ?? leg.spreadLine })
  })
}

function winProbs(game) {
  if (!(game.margin >= 0.05) || !game.winner) return { away: 0.5, home: 0.5 }
  const favorite = favoriteWinEstimate(game.margin)
  return game.winner.id === game.away.id
    ? { away: favorite, home: 1 - favorite }
    : { away: 1 - favorite, home: favorite }
}

function coverPair(game, spread) {
  const homeLine = Number(spread?.homeLine)
  if (!Number.isFinite(homeLine) || !Number.isFinite(game.homePoints) || !Number.isFinite(game.awayPoints)) return null
  const home = coverProb(game.homePoints - game.awayPoints, homeLine)
  if (!Number.isFinite(home)) return null
  return { home, away: 1 - home }
}

function quoteFor(market, abbr) {
  if (!market || !abbr) return null
  for (const key of [abbr, scatterAbbrev(abbr)]) {
    const quote = market[key]
    const price = Number(quote?.price)
    if (!Number.isFinite(price) || price === 0) continue
    const line = Number(quote?.line)
    return { price, line: Number.isFinite(line) ? line : null, book: quote.book || '' }
  }
  return null
}

function kellyFraction(prob, american) {
  const decimal = americanToDecimal(american)
  if (!Number.isFinite(decimal) || decimal <= 1 || !Number.isFinite(prob)) return null
  return (prob * decimal - 1) / (decimal - 1)
}

function teamOutcomes(matchups, oddsFile, teamAbbr) {
  const want = scatterAbbrev(teamAbbr)
  const games = oddsFile?.games || {}
  const out = []
  for (const game of matchups || []) {
    if (game?.started || game?.final || !game?.away?.abbr || !game?.home?.abbr) continue
    const sideName = scatterAbbrev(game.away.abbr) === want ? 'away' : scatterAbbrev(game.home.abbr) === want ? 'home' : null
    if (!sideName) continue
    const odds = games[scatterGameKey(game.away.abbr, game.home.abbr)]
    if (!odds) continue
    const team = game[sideName]
    const probs = winProbs(game)
    const covers = coverPair(game, odds.spread)
    const choices = []
    const other = sideName === 'away' ? game.home : game.away
    const ml = quoteFor(odds.moneyline, team.abbr)
    if (ml) {
      const kelly = kellyFraction(probs[sideName], ml.price)
      const implied = americanImplied(ml.price)
      const opposite = quoteFor(odds.moneyline, other.abbr)
      if (kelly != null) choices.push({ bet: 'ML', prob: probs[sideName], kelly, edge: implied == null ? 0 : probs[sideName] - implied, price: ml.price, line: null, book: ml.book, oppositePrice: opposite?.price ?? null })
    }
    const spread = quoteFor(odds.spread, team.abbr)
    if (spread && covers) {
      const kelly = kellyFraction(covers[sideName], spread.price)
      const implied = americanImplied(spread.price)
      const opposite = quoteFor(odds.spread, other.abbr)
      if (kelly != null) choices.push({ bet: 'Spread', prob: covers[sideName], kelly, edge: implied == null ? 0 : covers[sideName] - implied, price: spread.price, line: spread.line, book: spread.book, oppositePrice: opposite?.price ?? null })
    }
    if (!choices.length) continue
    choices.sort((a, b) => b.kelly - a.kelly || b.edge - a.edge)
    out.push(outcomeLeg(game, team, choices[0]))
  }
  return out
}

export function outcomeCandidates(matchups, oddsFile, teamAbbr = null) {
  return teamAbbr ? teamOutcomes(matchups, oddsFile, teamAbbr) : modelOutcomes(matchups, oddsFile)
}

export function filterPools(pools, teamAbbr) {
  if (!teamAbbr) return { outcome: pools?.outcome || [], td: pools?.td || [], prop: pools?.prop || [] }
  const want = scatterAbbrev(teamAbbr)
  const keep = leg => scatterAbbrev(leg?.team) === want
  return {
    outcome: (pools?.outcome || []).filter(keep),
    td: (pools?.td || []).filter(keep),
    prop: (pools?.prop || []).filter(keep),
  }
}

const SCRIPT_MARKET = {
  'pass yds': 'passYds', 'pass yards': 'passYds', 'passing yards': 'passYds',
  'rush yds': 'rushYds', 'rush yards': 'rushYds', 'rushing yards': 'rushYds',
  'rec yds': 'recYds', 'receiving yards': 'recYds',
  receptions: 'rec',
}

export function applyGameScript(pools, { props = [], selection, matchup } = {}) {
  const gameId = matchup?.id
  const winner = selection?.win == null ? null : [matchup?.away, matchup?.home].find(team => String(team?.id) === String(selection.win))
  const byKey = new Map(props.map(prop => [`${normName(prop.name)}|${prop.key}`, prop]))
  const mapLeg = leg => {
    if (!gameId || leg.gameId !== gameId) return { ...leg, scriptNudge: 0 }
    if (leg.type === 'prop') {
      const key = SCRIPT_MARKET[String(leg.market || '').toLowerCase()]
      const script = key && byKey.get(`${leg.playerId}|${key}`)
      if (!script) return { ...leg, scriptNudge: 0 }
      const side = String(leg.side || '').toLowerCase()
      const agrees = !side || side === script.direction
      return {
        ...leg,
        scriptNudge: (agrees ? 1 : -1) * Math.abs(Number(script.pct) || 0),
        arrow: script.arrow,
        scriptNote: script.why,
      }
    }
    if (leg.type === 'td') {
      const moves = ['rushTD', 'recTD'].map(key => byKey.get(`${leg.playerId}|${key}`)).filter(Boolean)
      if (!moves.length) return { ...leg, scriptNudge: 0 }
      const best = [...moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0]
      return { ...leg, scriptNudge: best.pct, arrow: best.arrow, scriptNote: best.why }
    }
    if (leg.type === 'outcome' && winner) {
      const same = scatterAbbrev(leg.team) === scatterAbbrev(winner.abbr)
      const mag = selection.margin === 'big' ? 0.12 : selection.margin === 'close' ? 0.04 : 0.08
      return {
        ...leg,
        scriptNudge: same ? mag : -mag,
        arrow: same ? 'up' : 'down',
        scriptNote: same ? `${winner.abbr} is the script side` : `Script favors ${winner.abbr}`,
      }
    }
    return { ...leg, scriptNudge: 0 }
  }
  return {
    outcome: (pools?.outcome || []).map(mapLeg),
    td: (pools?.td || []).map(mapLeg),
    prop: (pools?.prop || []).map(mapLeg),
  }
}

function sideTeam(game, abbr) {
  const key = scatterAbbrev(abbr)
  if (scatterAbbrev(game.away?.abbr) === key) return game.away
  if (scatterAbbrev(game.home?.abbr) === key) return game.home
  return null
}

export function propCandidates(parlayData, matchups) {
  if (!parlayData || Number(parlayData.version) < 2) return []
  const wrapped = { matched: true, data: parlayData }
  const out = []
  for (const game of matchups || []) {
    if (game?.started || game?.final) continue
    const board = boardGame(wrapped, game.away?.abbr, game.home?.abbr)
    if (!board) continue
    for (const leg of filePropCandidates(board)) {
      const hit = legHit(leg)
      if (hit == null) continue
      const team = sideTeam(game, leg.team)
      const edge = leg.priced ? priceEdge(hit, leg.price) : null
      out.push({
        id: `prop:${leg.id}`,
        type: 'prop',
        gameId: game.id,
        gameLabel: `${game.away.abbr} at ${game.home.abbr}`,
        kickoff: game.date || '',
        playerId: normName(leg.player),
        playerName: leg.player,
        team: leg.team,
        teamName: team?.name || leg.team,
        logo: team?.logo || null,
        title: leg.card_label || leg.label || leg.player,
        subtitle: [leg.pos, leg.market].filter(Boolean).join(' · '),
        detail: leg.season || '',
        market: leg.market,
        side: leg.side,
        confidence: hit,
        valueScore: edge == null ? 0 : edge,
        priced: edge != null,
        price: edge == null ? null : leg.price,
        book: leg.book || '',
        kelly: null,
        edge,
      })
    }
  }
  return out
}

export function touchdownPrices(tdData) {
  const map = new Map()
  for (const game of tdData?.games || []) {
    for (const side of game.sides || []) {
      for (const row of side.rows || []) {
        for (const slot of ['confident', 'relativelySafe', 'upside']) {
          const value = row?.[slot]
          const picks = Array.isArray(value) ? value : value ? [value] : []
          for (const pick of picks) {
            if (pick?.prop !== 'Anytime TD') continue
            const price = Number(pick.price)
            if (!Number.isFinite(price) || price === 0) continue
            const key = normName(pick.player)
            if (key && !map.has(key)) map.set(key, price)
          }
        }
      }
    }
  }
  return map
}

export function touchdownCandidate({ game, player, share, team, price = null }) {
  const edge = price == null ? null : priceEdge(share.rate, price)
  return {
    id: `td:${player.id}`,
    type: 'td',
    gameId: game.id,
    gameLabel: `${game.away.abbr} at ${game.home.abbr}`,
    kickoff: game.date || '',
    playerId: normName(player.name),
    playerName: player.name,
    team: team?.abbr || '',
    teamName: team?.name || team?.abbr || '',
    logo: team?.logo || null,
    title: `${player.name} anytime TD`,
    subtitle: `${player.position || 'Player'} · season-weighted`,
    detail: share.n ? `${share.hits} of ${share.n} games` : '',
    confidence: share.rate,
    valueScore: edge == null ? 0 : edge,
    priced: edge != null,
    price: edge == null ? null : price,
    kelly: null,
    edge,
  }
}

export function parseAmerican(value) {
  const text = String(value ?? '').trim()
  if (!text) return { ok: true, value: null }
  const number = Number(text.replace(/^\+/, ''))
  if (!Number.isFinite(number) || Math.abs(number) < 100) return { ok: false, value: null }
  return { ok: true, value: number }
}

export function americanBounds(minOdds, maxOdds) {
  const min = parseAmerican(minOdds)
  const max = parseAmerican(maxOdds)
  if (!min.ok || !max.ok) return { ok: false, message: 'American odds look like +200 or -150. Leave a box blank to skip that side.' }
  if (min.value == null && max.value == null) return { ok: true, range: null }
  return { ok: true, range: { min: min.value, max: max.value } }
}

export function combinedAmerican(legs) {
  let decimal = 1
  for (const leg of legs || []) {
    const price = Number(leg?.price)
    if (!Number.isFinite(price) || price === 0) return null
    const quote = americanToDecimal(price)
    if (!Number.isFinite(quote) || quote <= 1) return null
    decimal *= quote
  }
  const text = decimalToAmerican(decimal)
  const number = Number(String(text).replace(/^\+/, ''))
  return Number.isFinite(number) ? { text, number } : null
}

/** Fair American price for a model probability. 68.75% is −220. About 47.6% is +110. */
export function fairAmerican(probability) {
  const p = Number(probability)
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100)
  return Math.round(((1 - p) / p) * 100)
}

/**
 * Book line versus the model's fair line.
 * A −500 price the model makes −220 is overvalued. A +150 the model makes +110 is undervalued.
 * ev is expected profit per 1 unit staked (probability edge times the decimal price).
 */
export function legValue(probability, price) {
  const book = Number(price)
  const fair = fairAmerican(probability)
  const implied = americanImplied(book)
  if (fair == null || implied == null) return { hasLine: false, fair: null, book: null, edge: null, ev: null, tag: 'no-line' }
  const decimal = americanToDecimal(book)
  if (!Number.isFinite(decimal) || decimal <= 1) return { hasLine: false, fair: null, book: null, edge: null, ev: null, tag: 'no-line' }
  const edge = Number(probability) - implied
  const ev = Number(probability) * decimal - 1
  const tag = edge > 1e-4 ? 'undervalued' : edge < -1e-4 ? 'overvalued' : 'fair'
  return { hasLine: true, fair, book, edge, ev, tag }
}

function decorateLeg(leg) {
  const value = legValue(leg?.confidence, leg?.price)
  return {
    ...leg,
    hasLine: value.hasLine,
    bookLine: value.book,
    fairLine: value.fair,
    edge: value.hasLine ? value.edge : null,
    ev: value.ev,
    valueTag: value.tag,
    valueScore: value.hasLine ? value.ev : null,
    mismatch: classifyMismatch(leg?.confidence, leg?.price, leg?.oppositePrice),
  }
}

export function slateMismatchSummary(pools) {
  const legs = ['outcome', 'td', 'prop'].flatMap(type => (pools?.[type] || []).map(decorateLeg))
  const flagged = legs.filter(leg => leg.mismatch)
  const near = legs
    .filter(leg => !leg.mismatch && Number.isFinite(leg.edge) && leg.edge > 0)
    .sort((a, b) => b.edge - a.edge || String(a.id).localeCompare(String(b.id)))
    .slice(0, 3)
  return { count: flagged.length, near }
}

export function priceInRange(price, range) {
  if (!range || (range.min == null && range.max == null)) return true
  if (!price) return false
  const bounds = [range.min, range.max].filter(value => value != null)
  if (bounds.length === 2) {
    const [lo, hi] = [...bounds].sort((a, b) => a - b)
    return price.number >= lo && price.number <= hi
  }
  if (range.min != null) return price.number >= range.min
  return price.number <= range.max
}

function withPrice(parlay, range) {
  if (!parlay) return null
  const price = combinedAmerican(parlay.legs)
  const next = { ...parlay, priceText: price?.text || null, priceNumber: price?.number ?? null }
  if (range && !priceInRange(price, range)) return null
  return next
}

function legScore(leg, mode) {
  const nudge = Number(leg.scriptNudge) || 0
  if (mode === 'value') {
    if (!leg.hasLine) return -2 + nudge * 0.01
    return (Number(leg.ev) || 0) + nudge * 0.05
  }
  return (Number(leg.confidence) || 0) + nudge
}

function compareLegs(mode, prioritizeMismatch = false) {
  return (a, b) => {
    if (prioritizeMismatch) {
      const tier = mismatchRank(b) - mismatchRank(a)
      if (tier) return tier
      if (mismatchRank(a)) {
        const edge = (b.mismatch?.edge || 0) - (a.mismatch?.edge || 0)
        if (Math.abs(edge) > 1e-12) return edge
      }
    }
    const diff = legScore(b, mode) - legScore(a, mode)
    if (diff) return diff
    const confidence = (b.confidence || 0) - (a.confidence || 0)
    if (confidence) return confidence
    return String(a.id).localeCompare(String(b.id))
  }
}

function profitOf(american) {
  const price = Number(american)
  if (!Number.isFinite(price) || Math.abs(price) < 100) return null
  return price > 0 ? price / 100 : 100 / -price
}

/** Base window: ±25 American points at |odds| <= 200, otherwise ±15% of the profit. `scale` widens it. */
export function priceMatchesTarget(price, target, scale = 1) {
  const quoted = Number(price)
  const goal = Number(target)
  if (!Number.isFinite(quoted) || quoted === 0 || !Number.isFinite(goal)) return false
  const widen = Number(scale) > 0 ? Number(scale) : 1
  if (Math.abs(goal) <= 200) return Math.abs(quoted - goal) <= 25 * widen
  const base = profitOf(goal)
  const got = profitOf(quoted)
  if (base == null || got == null || base === 0) return false
  return Math.abs(got - base) <= Math.abs(base) * 0.15 * widen
}

export function runningAmerican(legs, field = 'price') {
  const priced = (legs || [])
    .map(leg => ({ price: leg?.[field] }))
    .filter(leg => Number.isFinite(Number(leg.price)) && Number(leg.price) !== 0)
  if (!priced.length) return null
  return combinedAmerican(priced)
}

export function oddsDirection(previous, next) {
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return null
  if (next > previous + 0.5) return 'up'
  if (next < previous - 0.5) return 'down'
  return 'flat'
}

function combinations(items, size) {
  const out = []
  const picked = []
  const walk = start => {
    if (picked.length === size) {
      out.push(picked.slice())
      return
    }
    for (let i = start; i <= items.length - (size - picked.length); i++) {
      picked.push(items[i])
      walk(i + 1)
      picked.pop()
    }
  }
  if (size >= 1 && size <= items.length) walk(0)
  return out
}

function combinationCount(n, k) {
  if (k < 0 || k > n) return 0
  let value = 1
  for (let i = 0; i < k; i++) value = value * (n - i) / (i + 1)
  return value
}

function supplyCount(legs) {
  let outcome = false
  const players = new Set()
  let loose = 0
  for (const leg of legs) {
    if (leg.type === 'outcome') outcome = true
    else if (leg.playerId) players.add(leg.playerId)
    else loose += 1
  }
  return (outcome ? 1 : 0) + players.size + loose
}

function summarize(legs, mode) {
  const ordered = [...legs].sort((a, b) => (
    String(a.kickoff).localeCompare(String(b.kickoff))
    || String(a.gameId).localeCompare(String(b.gameId))
    || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    || (b.confidence || 0) - (a.confidence || 0)
  ))
  const combined = ordered.reduce((product, leg) => product * (Number(leg.confidence) || 0), 1)
  const value = ordered.reduce((sum, leg) => sum + (leg.hasLine ? Number(leg.ev) || 0 : 0), 0)
  const nudge = ordered.reduce((sum, leg) => sum + (Number(leg.scriptNudge) || 0), 0)
  return {
    id: ordered.map(leg => leg.id).sort().join('|'),
    legs: ordered,
    combined,
    value,
    missingLine: ordered.some(leg => !leg.hasLine),
    rank: mode === 'value' ? ordered.reduce((sum, leg) => sum + legScore(leg, 'value'), 0) : combined + nudge,
    games: new Set(ordered.map(leg => leg.gameId)).size,
    mode,
  }
}

function compareParlays() {
  return (a, b) => {
    const diff = (b.rank || 0) - (a.rank || 0)
    if (Math.abs(diff) > 1e-12) return diff
    const hit = b.combined - a.combined
    if (Math.abs(hit) > 1e-12) return hit
    return a.id.localeCompare(b.id)
  }
}

function bestFill(gameList, pools, input, mode, banned, targets = null, prioritizeMismatch = false) {
  const types = checkedTypes(input.types)
  const ids = new Set(gameList.map(game => game.id))
  const limited = input.legsPerGame != null
  const cap = new Map(gameList.map(game => [game.id, input.legsPerGame ?? Infinity]))
  const usedIds = new Set()
  const usedPlayers = new Set()
  const usedOutcomes = new Set()
  const chosen = []
  const required = types.length <= input.legs
  const order = compareLegs(mode, prioritizeMismatch)

  const available = type => (pools[type] || []).filter(leg => ids.has(leg.gameId) && !banned.has(leg.id))
  const poolLegs = () => types.flatMap(type => pools[type] || []).filter(leg => ids.has(leg.gameId) && !banned.has(leg.id))
  function canTake(leg, ignore) {
    if (!leg || banned.has(leg.id) || usedIds.has(leg.id)) return false
    if (leg.playerId && usedPlayers.has(leg.playerId) && leg.playerId !== ignore?.playerId) return false
    if (leg.type === 'outcome' && usedOutcomes.has(leg.gameId) && ignore?.gameId !== leg.gameId) return false
    if (limited && (cap.get(leg.gameId) ?? 0) < 1) return false
    return ids.has(leg.gameId)
  }
  function take(leg, extra) {
    const row = extra ? { ...leg, ...extra } : leg
    chosen.push(row)
    usedIds.add(row.id)
    if (row.playerId) usedPlayers.add(row.playerId)
    if (row.type === 'outcome') usedOutcomes.add(row.gameId)
    if (limited) cap.set(row.gameId, cap.get(row.gameId) - 1)
  }
  function release(leg) {
    const index = chosen.indexOf(leg)
    if (index >= 0) chosen.splice(index, 1)
    usedIds.delete(leg.id)
    if (leg.playerId) usedPlayers.delete(leg.playerId)
    if (leg.type === 'outcome') usedOutcomes.delete(leg.gameId)
    if (limited) cap.set(leg.gameId, cap.get(leg.gameId) + 1)
  }

  const filled = (targets || []).slice(0, input.legs)
    .map((value, index) => ({ value, index }))
    .filter(item => item.value != null && item.value !== '')
    .map(item => ({ value: Number(item.value), index: item.index }))
    .filter(item => Number.isFinite(item.value) && Math.abs(item.value) >= 100)
  if (filled.length) {
    const open = poolLegs()
    const pending = [...filled].sort((a, b) => {
      const count = item => open.filter(leg => priceMatchesTarget(leg.price, item.value, 1)).length
      return count(a) - count(b) || a.index - b.index
    })
    for (const item of pending) {
      if (chosen.length >= input.legs) break
      let pick = null
      let met = false
      for (const scale of [1, 2, 3, 4]) {
        const fits = open.filter(leg => priceMatchesTarget(leg.price, item.value, scale) && canTake(leg)).sort(order)
        if (!fits.length) continue
        pick = fits[0]
        met = scale === 1
        break
      }
      const fallback = !pick
      if (!pick) pick = open.filter(leg => canTake(leg)).sort(order)[0]
      if (!pick) return null
      take(pick, {
        targetOdds: item.value,
        targetMet: met && !fallback,
        targetFallback: fallback,
      })
    }
  }

  const placeOrder = [...types].sort((a, b) => {
    const gamesOf = type => new Set(available(type).map(leg => leg.gameId)).size
    return gamesOf(a) - gamesOf(b) || TYPE_ORDER[a] - TYPE_ORDER[b]
  })
  if (required) {
    for (const type of placeOrder) {
      if (chosen.some(leg => leg.type === type)) continue
      const pick = available(type).sort(order).find(leg => canTake(leg))
      if (pick && chosen.length < input.legs) {
        take(pick)
        continue
      }
      const donor = [...chosen].sort(order).reverse().find(leg => (
        !leg.targetMet
        && !(types.includes(leg.type) && chosen.filter(item => item.type === leg.type).length <= 1)
      ))
      const replacement = donor && available(type).sort(order).find(leg => canTake(leg, donor))
      if (!donor || !replacement) return null
      release(donor)
      take(replacement)
    }
  }

  const rest = poolLegs().sort(order)
  for (const leg of rest) {
    if (chosen.length >= input.legs) break
    if (canTake(leg)) take(leg)
  }
  if (chosen.length !== input.legs) return null

  if (!limited && !coverEveryGame(chosen, gameList, pools, types, mode, required, canTake, release, take, prioritizeMismatch)) return null
  if (limited) {
    for (const game of gameList) {
      if (chosen.filter(leg => leg.gameId === game.id).length !== input.legsPerGame) return null
    }
  }
  if (new Set(chosen.map(leg => leg.gameId)).size !== gameList.length) return null
  return summarize(chosen, mode)
}

function coverEveryGame(chosen, gameList, pools, types, mode, required, canTake, release, take, prioritizeMismatch = false) {
  const requiredTypes = required ? types : []
  const order = compareLegs(mode, prioritizeMismatch)
  const removalOrder = (a, b) => {
    const sticky = (a.targetMet ? 1 : 0) - (b.targetMet ? 1 : 0)
    if (sticky) return -sticky
    return order(a, b)
  }
  let guard = 0
  while (guard++ < 24) {
    const counts = new Map(gameList.map(game => [game.id, 0]))
    for (const leg of chosen) counts.set(leg.gameId, counts.get(leg.gameId) + 1)
    const empty = gameList.find(game => counts.get(game.id) === 0)
    if (!empty) return true
    const donors = [...counts.entries()].filter(([, count]) => count >= 2).map(([id]) => id)
    let swapped = false
    for (const donorId of donors) {
      const donorLegs = chosen.filter(leg => leg.gameId === donorId).sort(removalOrder)
      for (let i = donorLegs.length - 1; i >= 0 && !swapped; i--) {
        const removed = donorLegs[i]
        const alone = requiredTypes.includes(removed.type) && chosen.filter(leg => leg.type === removed.type).length <= 1
        const replacement = types.flatMap(type => pools[type] || [])
          .filter(leg => leg.gameId === empty.id)
          .sort(order)
          .find(leg => (!alone || leg.type === removed.type) && canTake(leg, removed))
        if (!replacement) continue
        release(removed)
        take(replacement)
        swapped = true
      }
      if (swapped) break
    }
    if (!swapped) return false
  }
  return false
}

const TYPE_LABEL = { outcome: 'Game outcomes', td: 'Touchdown scorers', prop: 'Props' }

export function skipNote(type) {
  if (type === 'outcome') return 'Game outcomes are checked, but no unstarted game has a moneyline or spread the model likes. Uncheck Game outcomes. This parlay uses the other selected types.'
  if (type === 'td') return 'Touchdown scorers are checked, but none fit this TD mode. Uncheck Touchdown scorers, or switch TD mode to Mix. This parlay uses the other selected types.'
  return 'Props are checked, but this week’s file has none for the unstarted games. Uncheck Props. This parlay uses the other selected types.'
}

function emptyReason(types) {
  const names = types.map(type => TYPE_LABEL[type] || type).join(', ')
  return `None of the selected types have a leg on an unstarted game (${names}). Uncheck an empty type, or lower Number of games. The generator only uses games that have not kicked off.`
}

export function buildCustomParlays(pools = {}, input, { mode = 'confidence', limit = 8, oddsRange = null, targets = null, prioritizeMismatch = false } = {}) {
  const requested = checkedTypes(input?.types)
  const byType = {
    outcome: (pools.outcome || []).map(decorateLeg),
    td: (pools.td || []).map(decorateLeg),
    prop: (pools.prop || []).map(decorateLeg),
  }
  const skipped = requested.filter(type => !byType[type].length)
  const types = requested.filter(type => byType[type].length)
  const note = skipped.map(skipNote).join(' ')
  if (!types.length) return { parlays: [], reason: emptyReason(requested), skipped }
  const working = {
    ...input,
    types: { outcome: types.includes('outcome'), td: types.includes('td'), prop: types.includes('prop') },
  }
  const games = new Map()
  for (const type of types) {
    for (const leg of byType[type]) {
      if (!games.has(leg.gameId)) games.set(leg.gameId, { id: leg.gameId, kickoff: leg.kickoff || '', legs: [] })
      games.get(leg.gameId).legs.push(leg)
    }
  }
  let catalog = [...games.values()]
  if (working.legsPerGame != null) catalog = catalog.filter(game => supplyCount(game.legs) >= working.legsPerGame)
  if (catalog.length < working.games) {
    const count = catalog.length
    return { parlays: [], reason: `Only ${count} unstarted ${count === 1 ? 'game has' : 'games have'} these legs, and Number of games is ${working.games}. Lower Number of games${working.legsPerGame != null ? ', or clear Legs per game' : ''}.`, skipped, note }
  }
  const order = compareLegs(mode, prioritizeMismatch)
  const ranked = [...catalog].sort((a, b) => {
    const score = game => [...game.legs].sort(order).slice(0, working.legsPerGame || 3).reduce((sum, leg) => sum + legScore(leg, mode) + (prioritizeMismatch ? mismatchRank(leg) * 5 : 0), 0)
    return score(b) - score(a) || String(a.kickoff).localeCompare(String(b.kickoff)) || String(a.id).localeCompare(String(b.id))
  })
  let pool = ranked
  if (combinationCount(pool.length, working.games) > 5000) pool = ranked.slice(0, Math.min(ranked.length, working.games + 6))
  const seen = new Set()
  const found = []
  let rejectedByOdds = false
  const keep = parlay => {
    if (!parlay || seen.has(parlay.id)) return
    const priced = withPrice(parlay, oddsRange)
    if (!priced) {
      if (oddsRange) rejectedByOdds = true
      return
    }
    seen.add(priced.id)
    found.push(priced)
  }
  for (const combo of combinations(pool, working.games)) keep(bestFill(combo, byType, working, mode, new Set(), targets, prioritizeMismatch))
  found.sort(compareParlays(mode))
  if (found.length < 2 && found[0]) {
    const ids = new Set(found[0].legs.map(leg => leg.gameId))
    const combo = pool.filter(game => ids.has(game.id))
    const banned = new Set()
    for (let step = 0; found.length < limit && step < limit * 3; step++) {
      const worst = [...found[found.length - 1].legs].sort(order).reverse().find(leg => !leg.targetMet)
      if (!worst) break
      banned.add(worst.id)
      keep(bestFill(combo.length ? combo : pool.filter(game => ids.has(game.id)), byType, working, mode, banned, targets, prioritizeMismatch))
    }
    found.sort(compareParlays(mode))
  }
  if (!found.length) {
    const reason = rejectedByOdds
      ? 'No mix has a saved price inside Min American and Max American. Clear those boxes. Props and touchdowns often have no snapshot price, so a range only fits when every leg is priced.'
      : `No mix of ${working.games} ${working.games === 1 ? 'game' : 'games'} can fill ${working.legs} legs without repeating a leg. Lower Number of legs or Number of games, or clear Legs per game.`
    return { parlays: [], reason, skipped, note }
  }
  return { parlays: found.slice(0, limit), reason: null, skipped, note }
}
