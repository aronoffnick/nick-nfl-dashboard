// Risk-adjusted matchup value from the dashboard's own margin curve and a saved odds snapshot.
// Both the moneyline and the spread are scored. The card shows only the better one.
import { americanToDecimal } from './props/betGenerator.js'
import { coverProb } from './teamParlayPick.js'
import { favoriteWinEstimate } from './props/diversifiedParlays.js'
import { scatterAbbrev, scatterGameKey } from './props/scatterCheck.js'
import { gradePick } from './boardModel.js'

// Kelly fraction of a unit bankroll. Under 3% is inside a small NFL edge and is not shown.
// 10% is already a large full-Kelly stake. 20% means the model and the price are far apart.
export const KELLY_DOTS = [
  { dots: 3, min: 0.2 },
  { dots: 2, min: 0.1 },
  { dots: 1, min: 0.03 },
]

export function strengthDots(kelly) {
  if (!Number.isFinite(kelly)) return 0
  for (const band of KELLY_DOTS) if (kelly >= band.min) return band.dots
  return 0
}

// Same conversion the team-parlay board uses. A missing or zero price is not a probability.
export function americanImplied(price) {
  const a = Number(price)
  if (!Number.isFinite(a) || a === 0) return null
  return a < 0 ? (-a) / (-a + 100) : 100 / (a + 100)
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
  if (!Number.isFinite(prob)) return null
  const decimal = americanToDecimal(american)
  if (!Number.isFinite(decimal) || decimal <= 1) return null
  return (prob * decimal - 1) / (decimal - 1)
}

function winProbs(game) {
  if (!(game.margin >= 0.05) || !game.winner) return { away: 0.5, home: 0.5 }
  const favorite = favoriteWinEstimate(game.margin)
  return game.winner.id === game.away.id
    ? { away: favorite, home: 1 - favorite }
    : { away: 1 - favorite, home: favorite }
}

function coverProbs(game, spread) {
  const homeLine = Number(spread?.homeLine)
  if (!Number.isFinite(homeLine)) return null
  if (!Number.isFinite(game.homePoints) || !Number.isFinite(game.awayPoints)) return null
  const home = coverProb(game.homePoints - game.awayPoints, homeLine)
  if (!Number.isFinite(home)) return null
  return { home, away: 1 - home }
}

function evaluateMarket(market, model, awayQuote, homeQuote, awayTeam, homeTeam) {
  if (!model || !awayQuote || !homeQuote) return null
  const awayRaw = americanImplied(awayQuote.price)
  const homeRaw = americanImplied(homeQuote.price)
  if (awayRaw == null || homeRaw == null) return null
  const sum = awayRaw + homeRaw
  if (!(sum > 0)) return null
  const fair = { away: awayRaw / sum, home: homeRaw / sum }
  const sides = ['away', 'home'].map(side => {
    const quote = side === 'away' ? awayQuote : homeQuote
    const team = side === 'away' ? awayTeam : homeTeam
    const prob = model[side]
    return {
      side,
      abbr: team.abbr,
      teamId: team.id,
      price: quote.price,
      line: quote.line,
      book: quote.book,
      model: prob,
      fair: fair[side],
      edge: prob - fair[side],
      kelly: kellyFraction(prob, quote.price),
    }
  }).filter(side => Number.isFinite(side.kelly))
  if (!sides.length) return null
  sides.sort((a, b) => b.kelly - a.kelly || b.edge - a.edge)
  const best = sides[0]
  return { market, ...best, dots: strengthDots(best.kelly) }
}

const NONE = {
  noLine: true, show: false, rankScore: null, market: null, side: null, abbr: null,
  teamId: null, dots: 0, kelly: null, edge: null, price: null, line: null,
  ml: null, ats: null, spread: null, book: null, source: null, asOf: null,
}

export function scoreGame(game, odds) {
  if (!game?.away?.abbr || !game?.home?.abbr) return { ...NONE }
  const hasMarket = Boolean(odds?.moneyline || odds?.spread)
  if (!hasMarket) return { ...NONE }
  const ml = evaluateMarket(
    'ML', winProbs(game),
    quoteFor(odds.moneyline, game.away.abbr), quoteFor(odds.moneyline, game.home.abbr),
    game.away, game.home,
  )
  const ats = evaluateMarket(
    'ATS', coverProbs(game, odds.spread),
    quoteFor(odds.spread, game.away.abbr), quoteFor(odds.spread, game.home.abbr),
    game.away, game.home,
  )
  const ranked = [ml, ats].filter(Boolean).sort((a, b) => b.kelly - a.kelly || b.edge - a.edge)
  if (!ranked.length) {
    return { ...NONE, noLine: true, book: odds.book || null }
  }
  const best = ranked[0]
  const show = best.dots > 0
  return {
    noLine: false,
    show,
    rankScore: best.kelly,
    market: show ? best.market : null,
    side: show ? best.side : null,
    abbr: show ? best.abbr : null,
    teamId: show ? best.teamId : null,
    dots: show ? best.dots : 0,
    kelly: best.kelly,
    edge: best.edge,
    price: show ? best.price : null,
    line: show ? best.line : null,
    ml, ats,
    spread: odds.spread ? { homeLine: Number(odds.spread.homeLine), awayLine: Number(odds.spread.awayLine) } : null,
    book: best.book || odds.book || null,
    source: odds.source || null,
    asOf: odds.asOf || null,
  }
}

// Prefer the structured ESPN snapshot (moneyline and spread from one book).
// A game that snapshot skips can still use a structured moneyline on the parlay file.
// The parlay file's written-out spread sentence is not parsed.
export function moneylineFromParlay(game) {
  const quoted = game?.market?.moneyline
  if (!quoted || typeof quoted !== 'object') return null
  const moneyline = {}
  for (const [team, quote] of Object.entries(quoted)) {
    const price = Number(quote?.price)
    if (!Number.isFinite(price) || price === 0) continue
    moneyline[team] = { price, book: quote.book || '' }
  }
  if (Object.keys(moneyline).length < 2) return null
  return {
    moneyline,
    spread: null,
    source: 'Saved parlay moneyline',
    asOf: game.snapshot?.game_asof || game.snapshot?.props_asof || null,
    book: [...new Set(Object.values(moneyline).map(quote => quote.book).filter(Boolean))].join(', '),
  }
}

export function mergeOdds(teamOdds, parlays) {
  const games = {}
  if (teamOdds?.games) {
    for (const [key, game] of Object.entries(teamOdds.games)) {
      if (!game) continue
      games[key] = {
        ...game,
        source: game.source || teamOdds.source || null,
        asOf: game.asOf || teamOdds.asOf || null,
        book: game.book || teamOdds.book || null,
      }
    }
  }
  let parlayFills = 0
  if (parlays?.games) {
    for (const [key, game] of Object.entries(parlays.games)) {
      if (games[key]) continue
      const row = moneylineFromParlay(game)
      if (!row) continue
      games[key] = row
      parlayFills += 1
    }
  }
  const book = teamOdds?.book || Object.values(games).find(game => game?.book)?.book || null
  return {
    games,
    source: teamOdds?.source || (parlayFills ? 'Saved parlay moneyline' : null),
    asOf: teamOdds?.asOf || null,
    week: teamOdds?.week ?? parlays?.week ?? null,
    book,
    parlayFills,
  }
}

export function scoreMatchups(matchups, oddsFile) {
  const games = oddsFile?.games || {}
  const book = oddsFile?.book || Object.values(games).find(game => game?.book)?.book || null
  const byId = {}
  for (const game of matchups || []) {
    const row = games[scatterGameKey(game.away?.abbr, game.home?.abbr)] || null
    byId[game.id] = scoreGame(game, row)
  }
  return {
    byId,
    meta: {
      source: oddsFile?.source || null,
      asOf: oddsFile?.asOf || null,
      week: oddsFile?.week ?? null,
      book,
      matched: Boolean(oddsFile?.games),
    },
  }
}

// Numbers always sort around missing lines, and missing lines stay last in either direction.
export function compareValue(a, b, ascending) {
  const an = Number.isFinite(a?.rankScore)
  const bn = Number.isFinite(b?.rankScore)
  if (an !== bn) return an ? -1 : 1
  if (!an && !bn) return 0
  return (a.rankScore - b.rankScore) * (ascending ? 1 : -1)
}

export function resultClass(grade) {
  if (grade === 'win') return 'is-win'
  if (grade === 'loss') return 'is-loss'
  return ''
}

// Straight-up, using the same winner check as the pre-kickoff W/L mark.
export function gradeDisplayedPick(game) {
  if (!game?.final) return null
  const mark = gradePick({ winnerId: game.winner?.id ?? null, tie: !(game.margin >= 0.05) }, game.final)
  if (mark === 'W') return 'win'
  if (mark === 'L') return 'loss'
  return 'push'
}

// Best value is graded on the one line it shows: moneyline straight up, or that side of the spread.
export function gradeValuePick(value, game) {
  if (!value?.show || !game?.final) return null
  if (value.market === 'ML') {
    const mark = gradePick({ winnerId: value.teamId, tie: false }, game.final)
    if (mark === 'W') return 'win'
    if (mark === 'L') return 'loss'
    return 'push'
  }
  const line = value.side === 'home' ? value.spread?.homeLine : value.spread?.awayLine
  if (!Number.isFinite(line)) return null
  const margin = value.side === 'home'
    ? game.final.home.points - game.final.away.points
    : game.final.away.points - game.final.home.points
  const cover = margin + line
  if (!Number.isFinite(cover)) return null
  if (Math.abs(cover) < 1e-6) return 'push'
  return cover > 0 ? 'win' : 'loss'
}
