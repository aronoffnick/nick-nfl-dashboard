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
function depthRank(rb) {
  const match = /^RB(\d+)/.exec(rb?.depth || '')
  return match ? Number(match[1]) : null
}
export function isBackupRb(rb) {
  const rank = depthRank(rb)
  return isMinimalRb(rb) || (rank != null && rank >= 3)
}

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

const noSheet = { eligible: true, weight: 1, flag: null, note: 'No role sheet this week', reason: null, sheet: false, sharedRole: false, backup: false, signals: [] }

function teamSheetRbs(book, teamAbbr) {
  const seen = new Set()
  const rows = []
  for (const rb of book.rbByName.values()) {
    if (seen.has(rb)) continue
    seen.add(rb)
    if (rb.team === teamAbbr) rows.push(rb)
  }
  return rows
}
function listedStarter(mates) {
  return mates.filter(rb => rb.depth === 'RB1' && injuryInfo(rb.injury).state !== 'out')
    .sort((a, b) => (b.recentCarryShare ?? -1) - (a.recentCarryShare ?? -1))[0] || null
}
function closeToStarter(value, starterValue, gap, floor) {
  return value != null && starterValue != null && value >= floor && value >= starterValue - gap
}

// A third-string or depth/minimal back overlaps the listed RB1 when any recorded
// signal clears an absolute floor or sits near that starter. Null and "uncertain"
// fields are skipped rather than treated as a match.
export function sharedRbSignals(rb, book = defaultBook) {
  const rows = activeBook(book)
  if (!rows.matched || !rb || !isBackupRb(rb) || injuryInfo(rb.injury).state === 'out') return []
  const starter = listedStarter(teamSheetRbs(rows, rb.team).filter(row => row !== rb))
  const signals = []
  if (rb.glRole === 'shared' || rb.glRole === 'primary') signals.push(`goal-line role ${rb.glRole}`)
  if (rb.inside5Share != null && rb.inside5Share >= 0.2) signals.push(`inside-5 share ${Math.round(rb.inside5Share * 100)}%`)
  if (rb.targetShare != null && rb.targetShare >= 0.2) signals.push(`target share ${Math.round(rb.targetShare * 100)}%`)
  else if (closeToStarter(rb.targetShare, starter?.targetShare ?? null, 0.08, 0.12)) signals.push(`target share within 8 points of ${starter.name}`)
  if (rb.recentCarryShare != null && rb.recentCarryShare >= 0.25) signals.push(`carry share ${Math.round(rb.recentCarryShare * 100)}%`)
  else if (closeToStarter(rb.recentCarryShare, starter?.recentCarryShare ?? null, 0.12, 0.15)) signals.push(`carry share within 12 points of ${starter.name}`)
  if (hasReceivingRole(rb) && rb.targetShare != null && rb.targetShare >= 0.15) signals.push('pass-catching or 3rd-down tag with at least 15% of team RB targets')
  return signals
}
function signalsForStat(signals, statKey) {
  if (!statKey || statKey === 'totalTD' || statKey === 'rushTD') return signals
  if (statKey === 'rec' || statKey === 'recYds') return signals.filter(signal => /target|pass-catching|3rd-down/.test(signal))
  if (statKey === 'rushYds') return signals.filter(signal => /carry|goal-line|inside-5/.test(signal))
  return signals
}

// WR4-or-lower is absent from the starter sheet, which has no target, red-zone,
// or route-depth fields. Overlap uses ESPN target counts on the supplied logs.
export function sharedWrSignals(player, teammates = [], book = defaultBook) {
  const rows = activeBook(book)
  if (!rows.matched || !teammates?.length) return []
  const logs = (player.logs || []).slice(-4)
  if (logs.length < 3) return []
  const ids = new Set(logs.map(log => log.gameId))
  const group = teammates.filter(mate => (mate.position || mate.pos) === 'WR')
  if (!group.some(mate => mate === player || mate.id === player.id)) group.push(player)
  let teamTargets = 0
  const shares = []
  for (const mate of group) {
    const targets = (mate.logs || []).reduce((sum, log) => ids.has(log.gameId) && Number.isFinite(log.targets) ? sum + log.targets : sum, 0)
    teamTargets += targets
    const wr = findWr(mate.name, teamName(mate) || teamName(player), rows)
    shares.push({ mate, targets, rank: wr?.rank || '' })
  }
  const mine = shares.find(row => row.mate === player || row.mate.id === player.id)
  if (!mine || mine.targets < 10 || teamTargets <= 0) return []
  const share = mine.targets / teamTargets
  const starters = shares.filter(row => /^WR[123]$/.test(row.rank) && row.targets > 0)
  const nearStarter = starters.some(row => share >= 0.12 && share >= row.targets / teamTargets - 0.08)
  if (share >= 0.18) return [`${Math.round(share * 100)}% of team WR targets over the last ${logs.length} games`]
  if (nearStarter) return [`target share within 8 points of a listed WR1–WR3 (${Math.round(share * 100)}% of team WR targets)`]
  return []
}

function kept(extra) {
  return { eligible: true, weight: extra.weight ?? 1, flag: extra.flag ?? null, note: extra.note ?? null, reason: extra.reason ?? null, sheet: true, sharedRole: !!extra.sharedRole, backup: !!extra.backup, signals: extra.signals || [], ...(extra.rest || {}) }
}
export function roleDecision(player, { statKey = null, book = null, includeBackups = false, teammates = null } = {}) {
  const rows = activeBook(book)
  if (!rows.matched) return noSheet
  const position = player.position || player.pos
  if (position === 'QB' || position === 'TE' || (position !== 'RB' && position !== 'FB' && position !== 'WR')) {
    return { eligible: true, weight: 1, flag: null, note: null, reason: null, sheet: true, sharedRole: false, backup: false, signals: [] }
  }
  if (position === 'WR') {
    const wr = findWr(player.name, teamName(player), rows)
    const label = rows.week ? `Week ${rows.week}` : 'this week'
    if (wr && /^WR[123]$/.test(wr.rank || '')) return kept({ rest: { rank: wr.rank } })
    const reason = `Not WR1, WR2, or WR3 for this team on the ${label} sheet`
    const heldOut = !!(player.unavailable || player.stale)
    const signals = heldOut ? [] : sharedWrSignals(player, teammates, rows)
    if (signals.length) return kept({ note: 'Shared role', reason: signals.join('; '), sharedRole: true, signals })
    if (includeBackups && !heldOut) return kept({ note: 'Backup', reason, backup: true })
    return { eligible: false, weight: 1, flag: null, note: 'No role', reason, sheet: true, sharedRole: false, backup: false, signals: [] }
  }
  const rb = findRb(player.name, rows)
  if (!rb) return { eligible: true, weight: 1, flag: null, note: 'No role data', reason: null, sheet: true, sharedRole: false, backup: false, signals: [] }
  const injury = injuryInfo(rb.injury)
  const flag = injury.state === 'questionable' ? injury.label : null
  if (injury.state === 'out') return { eligible: false, weight: 1, flag: injury.label, note: null, reason: `${injury.label} excluded`, sheet: true, sharedRole: false, backup: false, signals: [] }
  const signals = signalsForStat(sharedRbSignals(rb, rows), statKey)
  const blockedMinimal = isMinimalRb(rb)
  const blockedReceiving = (statKey === 'rec' || statKey === 'recYds') && !receivingEligible(rb)
  const weight = statKey === 'rushYds' ? rushWeight(rb) : statKey === 'totalTD' || statKey === 'rushTD' ? tdWeight(rb) : 1
  const rest = { carryShare: rb.recentCarryShare ?? null }
  if (!blockedMinimal && !blockedReceiving) return kept({ weight, flag, rest })
  const heldOut = !!(player.unavailable || player.stale)
  if (signals.length && !heldOut) return kept({ weight, flag, note: 'Shared role', reason: signals.join('; '), sharedRole: true, signals, rest })
  if (includeBackups && !heldOut) return kept({ weight, flag, note: 'Backup', reason: blockedMinimal ? 'Depth / minimal-use role' : 'Under 25% of team RB targets, with no pass-catching or 3rd-down tag', backup: true, rest })
  if (blockedMinimal) return { eligible: false, weight: 1, flag, note: null, reason: 'Depth / minimal-use role', sheet: true, sharedRole: false, backup: false, signals: [] }
  return { eligible: false, weight: 1, flag, note: null, reason: 'Under 25% of team RB targets, with no pass-catching or 3rd-down tag', sheet: true, sharedRole: false, backup: false, signals: [] }
}

export function scatterNoRole(player, book = null, includeBackups = false) {
  const decision = roleDecision(player, { book, includeBackups })
  if (!decision.sheet) return { dim: false, mark: null, decision }
  if (decision.note === 'Shared role' || decision.note === 'Backup') return { dim: false, mark: decision.note, decision }
  const dim = !decision.eligible || decision.note === 'No role data' || decision.note === 'No role'
  const week = activeBook(book).week
  return { dim, mark: dim ? `No role per ${week ? `Week ${week}` : 'this week'} sheet` : null, decision }
}
