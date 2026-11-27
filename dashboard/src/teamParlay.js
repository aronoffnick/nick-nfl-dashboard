import { fileForWeek } from './data/weekFiles.js'
import { scatterAbbrev } from './props/scatterCheck.js'
import { americanToDecimal, decimalToAmerican } from './props/betGenerator.js'
import { chooseGroup } from './teamParlayPick.js'
import { favoriteWinEstimate } from './props/diversifiedParlays.js'

export function americanImplied(price) {
  const a = Number(price)
  if (!Number.isFinite(a) || a === 0) return null
  return a < 0 ? (-a) / (-a + 100) : 100 / (a + 100)
}

export function americanNumber(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1))
}

function moneylineIndex(week) {
  const file = fileForWeek('parlays', week)
  const games = file.data?.games || {}
  const byKey = new Map()
  for (const [key, game] of Object.entries(games)) {
    const prices = {}
    let asOf = game.snapshot?.game_asof || game.snapshot?.props_asof || null
    for (const leg of game.legs || []) {
      if (leg.market !== 'ML' || !leg.priced || leg.price == null) continue
      prices[leg.team] = { price: Number(leg.price), book: leg.book || '', asOf: leg.asof || asOf }
      if (leg.asof) asOf = leg.asof
    }
    byKey.set(key, { prices, asOf, source: 'getoddy snapshot' })
  }
  return { byKey, matched: file.matched }
}

export function teamCandidates(matchups, week) {
  const { byKey } = moneylineIndex(week)
  const legs = []
  for (const game of matchups || []) {
    if (game.started || game.final) continue
    const book = byKey.get(`${scatterAbbrev(game.away.abbr)}-${scatterAbbrev(game.home.abbr)}`)
    if (!book) continue
    const favorite = game.margin < 0.05 ? 0.5 : favoriteWinEstimate(game.margin)
    const model = {
      away: game.margin < 0.05 ? 0.5 : (game.winner.id === game.away.id ? favorite : 1 - favorite),
      home: game.margin < 0.05 ? 0.5 : (game.winner.id === game.home.id ? favorite : 1 - favorite),
    }
    for (const side of ['away', 'home']) {
      const team = game[side]
      const quote = book.prices[scatterAbbrev(team.abbr)] || book.prices[team.abbr]
      if (!quote) continue
      const implied = americanImplied(quote.price)
      if (implied == null) continue
      const edge = model[side] - implied
      if (edge <= 0) continue
      legs.push({
        gameId: game.id,
        team: team.abbr,
        teamName: team.name,
        side,
        bet: 'Moneyline',
        price: quote.price,
        book: quote.book,
        asOf: quote.asOf || book.asOf,
        source: book.source || 'getoddy snapshot',
        prob: model[side],
        edge,
        decimal: americanToDecimal(quote.price),
      })
    }
  }
  const best = new Map()
  for (const leg of legs) {
    const prior = best.get(leg.gameId)
    if (!prior || leg.edge > prior.edge) best.set(leg.gameId, leg)
  }
  return [...best.values()]
}

export function combinations(pool, size) {
  const found = []
  const walk = (start, picked) => {
    if (picked.length === size) {
      found.push(picked)
      return
    }
    for (let i = start; i <= pool.length - (size - picked.length); i++) walk(i + 1, picked.concat(pool[i]))
  }
  if (size >= 2 && size <= pool.length && size <= 8) walk(0, [])
  return found
}

export function buildTeamParlay(matchups, week, { legs = 2, minOdds, maxOdds } = {}) {
  const count = Number(legs)
  const bounds = [Number(minOdds), Number(maxOdds)].filter(Number.isFinite).sort((a, b) => a - b)
  if (!Number.isFinite(count) || count < 2 || count > 8) return { parlay: null, reason: 'Choose 2 to 8 legs.' }
  if (bounds.length < 2) return { parlay: null, reason: 'Enter a minimum and a maximum American price.' }
  const [lo, hi] = bounds
  const pool = teamCandidates(matchups, week)
  if (pool.length < count) {
    return { parlay: null, reason: pool.length ? `Only ${pool.length} unstarted game${pool.length === 1 ? '' : 's'} with a priced edge.` : 'No unstarted game has a saved moneyline the model likes.', pool }
  }
  const best = chooseGroup(pool, count, lo, hi)
  if (!best) return { parlay: null, reason: 'No parlay of that length lands inside the odds range.', pool }
  best.priceText = decimalToAmerican(best.legs.reduce((product, leg) => product * leg.decimal, 1))
  const times = [...new Set(best.legs.map(leg => leg.asOf).filter(Boolean))]
  return { parlay: { ...best, asOf: times.join('; '), source: 'getoddy snapshot' }, pool }
}
