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

function legPlayerName(leg) {
  if (typeof leg?.player === 'string') return leg.player
  return leg?.player?.name || ''
}

function legStat(leg) {
  return String(leg?.market || leg?.theme?.spec?.key || leg?.theme?.spec?.title || '').toLowerCase()
}

/** One player, one stat, one line. Side is not part of the identity. */
export function propKey(leg) {
  return `${normName(legPlayerName(leg))}|${legStat(leg)}|${leg?.line}`
}

/**
 * Hit chance the parlay builder already stores.
 * File legs use `p` (rating is round(p * 100)). Live Safe-overlap legs use concentration / 100.
 */
export function legHit(leg) {
  const hit = Number(leg?.p)
  if (Number.isFinite(hit)) return hit
  const concentration = Number(leg?.concentration)
  if (Number.isFinite(concentration)) return concentration / 100
  const rating = Number(leg?.rating)
  if (Number.isFinite(rating)) return rating / 100
  return null
}

/** Keep the higher hit chance when the same player, stat, and line appears more than once. Highest hit chance first. */
export function uniqueProps(legs) {
  const best = new Map()
  for (const leg of legs || []) {
    if (!leg) continue
    const key = propKey(leg)
    const current = best.get(key)
    if (!current || (legHit(leg) ?? -1) > (legHit(current) ?? -1)) best.set(key, leg)
  }
  return [...best.values()].sort((a, b) => {
    const diff = (legHit(b) ?? -1) - (legHit(a) ?? -1)
    if (diff) return diff
    return legPlayerName(a).localeCompare(legPlayerName(b)) || legStat(a).localeCompare(legStat(b))
  })
}

export function filePropCandidates(game) {
  return uniqueProps((game?.legs || []).filter(leg => leg.kind === 'prop'))
}
