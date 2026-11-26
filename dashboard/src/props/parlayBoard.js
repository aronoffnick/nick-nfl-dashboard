// Reads the game-day parlays-wkN.json (v2) written by parlays-pipeline/run.py.
// Every price comes from a saved getoddy.com snapshot; nothing here invents a price.
import { scatterGameKey } from './scatterCheck.js'

// file = fileForWeek('parlays', week) (kept out of this module so node tests can import it)
export function boardGame(file, awayAbbr, homeAbbr) {
  if (!file?.matched || !file.data || Number(file.data.version) < 2) return null
  const game = file.data.games?.[scatterGameKey(awayAbbr, homeAbbr)]
  return game && Array.isArray(game.legs) ? { ...game, meta: file.data } : null
}

export function legsById(game) {
  return new Map((game?.legs || []).map(leg => [leg.id, leg]))
}

// Safe-overlap cards from the file, legs resolved to full objects.
export function fileCards(game) {
  const byId = legsById(game)
  return (game?.safe_overlap_cards || []).map(card => ({ ...card, id: card.legs.join('|'), legs: card.legs.map(id => byId.get(id)).filter(Boolean) }))
}

// A card leg that contradicts a live Top Safe-overlap table row (table rows are all overs).
export function tableConflict(leg, tableNames) {
  return leg.side === 'Under' && tableNames.has(normName(leg.player))
}

export function normName(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()
}

export function pctText(value) {
  return value == null || Number.isNaN(Number(value)) ? '—' : `${Math.round(Number(value) * 100)}%`
}
