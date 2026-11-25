// Shared Week 12 role gate for Flyers, Player Projections, Parlays, and Scatter Plot.
// RB shares come from rb-usage-week12.json (parsed from rb-starters-2026-wk12.csv):
// targetShare = "N% of team RB targets", recentCarryShare = "Wks 8-11 RB carry share",
// inside5Share = the percent inside "Inside-5 carries (share)".
// WR rows have rank and alignment only. A WR3 under 10% team target share is not
// treated as fringe, because the WR sheet has no target shares and the logs are
// not a second source of truth for this gate.

import rbRows from './rb-starters-week12.json' with { type: 'json' }
import usageRows from './rb-usage-week12.json' with { type: 'json' }
import wrRows from './wr-starters-week12.json' with { type: 'json' }

export function nameKey(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
}
function teamKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

export function bookFrom(rbSource = [], usageSource = [], wrSource = [], { matched = true, week = null } = {}) {
  const usageByName = new Map(usageSource.map(row => [nameKey(row.name), row]))
  const rbByName = new Map()
  for (const row of rbSource) {
    const usage = usageByName.get(nameKey(row.name)) || usageByName.get(nameKey(row.sheetName)) || {}
    const merged = { ...row, targetShare: usage.targetShare ?? null, recentCarryShare: usage.recentCarryShare ?? null, inside5Share: usage.inside5Share ?? null, injury: row.injury || usage.injury || '' }
    rbByName.set(nameKey(row.name), merged)
    if (row.sheetName) rbByName.set(nameKey(row.sheetName), merged)
  }
  const wrByName = new Map()
  for (const row of wrSource) {
    const key = nameKey(row.name)
    wrByName.set(key, [...(wrByName.get(key) || []), row])
  }
  return { matched, week, rbByName, wrByName }
}
const defaultBook = bookFrom(rbRows, usageRows, wrRows, { matched: true, week: 12 })
const activeBook = book => book || defaultBook

export function findRb(name, book = defaultBook) {
  const rows = activeBook(book)
  if (!rows.matched) return null
  return rows.rbByName.get(nameKey(name)) || null
}
export function findWr(name, teamName, book = defaultBook) {
  const rows = activeBook(book)
  if (!rows.matched) return null
  const list = rows.wrByName.get(nameKey(name)) || []
  if (!teamName) return list[0] || null
  const team = teamKey(teamName)
  return list.find(row => teamKey(row.team) === team) || null
}

export function injuryInfo(text) {
  const raw = String(text || '').trim()
  const match = /^(Questionable|Doubtful|Out)\b/i.exec(raw)
  if (!match) return { state: 'ok', label: null }
  const titled = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
  const detail = raw.match(/\(([^)]+)\)/)
  return { state: titled === 'Questionable' ? 'questionable' : 'out', label: detail ? `${titled} (${detail[1]})` : titled }
}

export function isMinimalRb(rb) { return /depth|minimal/i.test(rb?.primary || '') }
export function hasReceivingRole(rb) { return /pass-catching|3rd-down|third-down/i.test([rb?.primary, ...(rb?.secondary || [])].join(' ')) }

// Receiving themes: >=25% of team RB targets, or a pass-catching / 3rd-down tag.
// A back missing from the sheet stays eligible and is marked "No role data".
export function receivingEligible(rb) {
  if (!rb) return true
  if (rb.targetShare != null && rb.targetShare >= 0.25) return true
  return hasReceivingRole(rb)
}

// Rush favorite score × clamp(Wks 8-11 carry share / 0.50, 0.40, 1.20).
export function rushWeight(rb) {
  if (!rb || rb.recentCarryShare == null) return 1
  return clamp(rb.recentCarryShare / 0.5, 0.4, 1.2)
}

// TD favorite score × goal-line weight × inside-5 weight.
// Goal line: Primary 1.25, Shares 1.05, Occasional 0.80, none 0.55.
// Inside-5: clamp(share / 0.25, 0.60, 1.25). Missing sheet data stays at 1.
const GL_WEIGHT = { primary: 1.25, shared: 1.05, occasional: 0.8, none: 0.55 }
export function tdWeight(rb) {
  if (!rb) return 1
  const gl = GL_WEIGHT[rb.glRole] ?? 1
  const inside = rb.inside5Share == null ? 1 : clamp(rb.inside5Share / 0.25, 0.6, 1.25)
  return gl * inside
}

function teamName(player) {
  const team = player.team
  if (!team) return player.teamName || ''
  return typeof team === 'string' ? team : team.name || ''
}

const noSheet = { eligible: true, weight: 1, flag: null, note: 'No role sheet this week', reason: null, sheet: false }
export function roleDecision(player, { statKey = null, book = null } = {}) {
  const rows = activeBook(book)
  if (!rows.matched) return noSheet
  const position = player.position || player.pos
  if (position === 'QB' || position === 'TE' || (position !== 'RB' && position !== 'FB' && position !== 'WR')) {
    return { eligible: true, weight: 1, flag: null, note: null, reason: null, sheet: true }
  }
  if (position === 'WR') {
    const wr = findWr(player.name, teamName(player), rows)
    const label = rows.week ? `Week ${rows.week}` : 'this week'
    if (!wr || !/^WR[123]$/.test(wr.rank || '')) return { eligible: false, weight: 1, flag: null, note: 'No role', reason: `Not WR1, WR2, or WR3 for this team on the ${label} sheet`, sheet: true }
    return { eligible: true, weight: 1, flag: null, note: null, reason: null, rank: wr.rank, sheet: true }
  }
  const rb = findRb(player.name, rows)
  if (!rb) return { eligible: true, weight: 1, flag: null, note: 'No role data', reason: null, sheet: true }
  const injury = injuryInfo(rb.injury)
  const flag = injury.state === 'questionable' ? injury.label : null
  if (injury.state === 'out') return { eligible: false, weight: 1, flag: injury.label, note: null, reason: `${injury.label} excluded`, sheet: true }
  if (isMinimalRb(rb)) return { eligible: false, weight: 1, flag, note: null, reason: 'Depth / minimal-use role', sheet: true }
  if ((statKey === 'rec' || statKey === 'recYds') && !receivingEligible(rb)) {
    return { eligible: false, weight: 1, flag, note: null, reason: 'Under 25% of team RB targets, with no pass-catching or 3rd-down tag', sheet: true }
  }
  const weight = statKey === 'rushYds' ? rushWeight(rb) : statKey === 'totalTD' || statKey === 'rushTD' ? tdWeight(rb) : 1
  return { eligible: true, weight, flag, note: null, reason: null, carryShare: rb.recentCarryShare ?? null, sheet: true }
}

export function scatterNoRole(player, book = null) {
  const decision = roleDecision(player, { book })
  if (!decision.sheet) return { dim: false, mark: null, decision }
  const dim = !decision.eligible || decision.note === 'No role data' || decision.note === 'No role'
  const week = activeBook(book).week
  return { dim, mark: dim ? `No role per ${week ? `Week ${week}` : 'this week'} sheet` : null, decision }
}
