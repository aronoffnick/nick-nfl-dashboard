// Week 12 scatter value is [season average, projection vs this defense, factor]. Index 1 is the projection.
const SCATTER_STAT = {rushYds:'rushYds', recYds:'recYds', rec:'rec', passYds:'passYds', totalTD:'td'}

export function scatterAbbrev(abbr) {
  return ({WSH:'WAS', LA:'LAR'}[abbr] || abbr)
}
export function scatterGameKey(awayAbbr, homeAbbr) {
  return `${scatterAbbrev(awayAbbr)}-${scatterAbbrev(homeAbbr)}`
}
function nameKey(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
}
export function formatScatter(value) {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 100) / 100)
}
export function scatterProjection(games, {awayAbbr, homeAbbr, playerName, statKey}) {
  const scatterKey = SCATTER_STAT[statKey]
  if (!scatterKey) return null
  const players = games?.[scatterGameKey(awayAbbr, homeAbbr)]?.players
  if (!players) return null
  const want = nameKey(playerName)
  const player = players.find(row => nameKey(row.n) === want)
  const projection = player?.s?.[scatterKey]?.[1]
  return Number.isFinite(projection) ? projection : null
}
function minimumLine(statKey) {
  return statKey === 'rec' ? 1 : 5
}
function isTouchdown(statKey) {
  return /td$/i.test(statKey)
}
/** Compare one parlay line with the scatter projection. Does not change other players' Safe thresholds. */
export function decideScatterLine({line, statKey, projection}) {
  if (projection == null) return {action:'keep', kind:'no-data', line, mark:'No scatter data'}
  if (projection >= line) return {action:'keep', kind:'pass', line, projection, mark:`Scatter check ✓ (proj ${formatScatter(projection)})`}
  if (isTouchdown(statKey)) return {action:'remove', kind:'removed', from:line, line, projection, mark:`Removed by scatter check: TD line is ${line}+ and cannot go lower`}
  const lowered = Math.floor(projection)
  if (lowered < minimumLine(statKey)) return {action:'remove', kind:'removed', from:line, line:lowered, projection, mark:`Removed by scatter check: ${line}+ would drop below ${minimumLine(statKey)}`}
  return {action:'lower', kind:'changed', from:line, line:lowered, projection, mark:`Lowered by scatter check: ${line}+ -> ${lowered}+`}
}
