import { scatterAbbrev } from './scatterCheck.js'

export function chanceText(prob) {
  const value = Number(prob)
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 1000) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

export function priceText(pick) {
  if (!pick?.price) return 'No price in the snapshot'
  return pick.book ? `${pick.price} ${pick.book}` : String(pick.price)
}

const FLAVOR_LABEL = {
  safer_2plus: 'Safer 2+',
  safer2plus: 'Safer 2+',
  safer_3plus: 'Safer 3+',
  safer3plus: 'Safer 3+',
  backup_1td: 'Backup',
  backup1: 'Backup',
}

export function flavorLabel(pick) {
  return FLAVOR_LABEL[pick?.kind] || FLAVOR_LABEL[pick?.flavor] || null
}

export function picksOf(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

export function allowedText(row) {
  const count = Number(row?.tdsAllowed)
  const noun = count === 1 ? 'TD' : 'TDs'
  const roles = Object.entries(row?.byRole || {}).map(([role, n]) => `${role} ${n}`).join(', ')
  return `${Number.isFinite(count) ? count : '—'} ${noun} allowed${roles ? `: ${roles}` : ''}`
}

export function sideCaption(side) {
  const rows = side?.rows || []
  const total = rows.reduce((sum, row) => sum + (Number(row.tdsAllowed) || 0), 0)
  const mix = rows.map(row => `${row.position} ${row.tdsAllowed}`).join(', ')
  const skipped = (side?.positionsSkipped || []).filter(Boolean)
  const skip = skipped.length ? ` ${skipped.join(' and ')} ${skipped.length === 1 ? 'is' : 'are'} not on this board.` : ''
  const implied = side?.impliedTeamPoints == null ? '' : ` Implied ${side.impliedTeamPoints} points.`
  return `${side?.defense || 'Defense'} allowed ${total} offensive ${total === 1 ? 'TD' : 'TDs'} in ${side?.defenseGames ?? '—'} games${mix ? `: ${mix}` : ''}.${skip}${implied}`
}

export function rulesText(rules) {
  if (!rules) return ''
  const parts = []
  if (rules.relativelySafeMinProb != null) parts.push(`Relatively safe names appear only at ${chanceText(rules.relativelySafeMinProb)} or higher`)
  if (rules.upside2plusMinProb != null) parts.push(`2+ looks appear only at ${chanceText(rules.upside2plusMinProb)} or higher`)
  if (rules.upside3plusMinProb != null) parts.push(`3+ looks appear only at ${chanceText(rules.upside3plusMinProb)} or higher`)
  return parts.length ? `${parts.join('. ')}.` : ''
}

export function snapshotText(game) {
  const bits = []
  if (game?.kickoff) bits.push(game.kickoff)
  if (game?.line?.spread) bits.push(game.line.spread)
  if (game?.line?.total != null) bits.push(`total ${game.line.total}`)
  if (game?.line?.provider) bits.push(game.line.provider)
  if (game?.priceSnapshot?.asOf) bits.push(`prices ${game.priceSnapshot.asOf}`)
  return bits.join(' · ')
}

export function safeNote(row, rules) {
  const notes = (row?.notes || []).filter(Boolean)
  if (notes.length) return notes.join(' ')
  if (row?.relativelySafe) return ''
  const min = rules?.relativelySafeMinProb
  return `No player at this position reaches ${min == null ? 'the cutoff' : chanceText(min)}.`
}

export function gameKey(awayAbbr, homeAbbr) {
  return `${scatterAbbrev(awayAbbr)}@${scatterAbbrev(homeAbbr)}`
}

export function findTdGame(data, awayAbbr, homeAbbr) {
  const key = gameKey(awayAbbr, homeAbbr)
  const games = Array.isArray(data?.games) ? data.games : []
  return games.find(game => game.key === key) || null
}
