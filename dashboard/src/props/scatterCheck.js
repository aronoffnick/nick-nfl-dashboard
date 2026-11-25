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
  return /td/i.test(statKey)
}
/** Lines are whole numbers or halves, matching the numbers printed on the cards. */
export function roundPropLine(value) {
  if (!Number.isFinite(value)) return null
  return Math.round(value * 2) / 2
}
export function formatLine(value) {
  if (!Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : String(value)
}
/** RB/WR breakout card: max(sheet threshold, scatter projection rounded to 0.5). */
export function raisedBreakoutLine(threshold, scatter) {
  if (scatter == null) return {line:threshold, note:'No scatter data', raised:false, scatter:null}
  const rounded = roundPropLine(scatter)
  const line = Math.max(threshold, rounded)
  const raised = line > threshold
  return {line, note:raised ? 'Line raised to scatter proj' : null, raised, scatter:rounded}
}
/** Compare one parlay line with the scatter projection. Touchdown legs are not checked. A pass may raise the line to the live projection; it never lowers it. */
export function decideScatterLine({line, statKey, projection, liveProjection}) {
  if (isTouchdown(statKey)) return {action:'skip', kind:'skipped', line, projection, mark:'Scatter check skipped (TD leg)'}
  if (projection == null) return {action:'keep', kind:'no-data', line, mark:'No scatter data'}
  if (projection >= line) {
    const live = roundPropLine(liveProjection)
    if (live != null && live > line) {
      const above = live > projection
      const flag = above ? 'live proj above scatter' : null
      return {action:'bump', kind:'bump', from:line, line:live, projection, flag, mark:`Raised to live projection: ${formatLine(line)}+ -> ${formatLine(live)}+${flag ? ` · ${flag}` : ''}`}
    }
    return {action:'keep', kind:'pass', line, projection, mark:`Scatter check ✓ (proj ${formatScatter(projection)})`}
  }
  const lowered = Math.floor(projection)
  if (lowered < minimumLine(statKey)) return {action:'remove', kind:'removed', from:line, line:lowered, projection, mark:`Removed by scatter check: ${line}+ would drop below ${minimumLine(statKey)}`}
  return {action:'lower', kind:'changed', from:line, line:lowered, projection, mark:`Lowered by scatter check: ${line}+ -> ${lowered}+`}
}
