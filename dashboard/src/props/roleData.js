import rbStarterRows from './rb-starters-week12.json'
import wrRows from './wr-starters-week12.json'

export const nameKey = s => String(s || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
// The Week 12 sheet equates the depth-chart name with the nflverse name. ESPN often uses the longer form.
const ALIASES = {
  'nicholas singleton': 'nick singleton',
}
const keyOf = name => ALIASES[nameKey(name)] || nameKey(name)
const rbStarterMap = new Map(rbStarterRows.flatMap(row => [[keyOf(row.name), row], [keyOf(row.sheetName), row]]))
const wrMap = new Map(wrRows.map(row => [keyOf(row.name), row]))

export const rbStarter = name => rbStarterMap.get(keyOf(name)) || null
export const wrRole = name => wrMap.get(keyOf(name)) || null
/** Role tags for a player row: WR from the WR starters sheet, RB from the RB starters sheet. [] when not in either. */
export function roleTags(player) {
  const name = player.player || player.name, pos = player.pos || player.position
  if (pos === 'WR') { const w = wrRole(name); return w ? [w.rank, ...(w.slot ? ['slot'] : []), `${w.alignment}/${w.side}`] : [] }
  if (pos === 'RB' || pos === 'FB') {
    const r = rbStarter(name); if (!r) return []
    return [r.depth, r.primary, ...(r.glRole !== 'none' ? [r.glLabel] : []), ...r.secondary.filter(t => !/goal-line/i.test(t) || r.glRole === 'none')]
  }
  return []
}
