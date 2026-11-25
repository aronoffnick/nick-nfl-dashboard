import { roleBookForWeek } from '../data/weekFiles.js'

export const nameKey = s => String(s || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
// The Week 12 sheet equates the depth-chart name with the nflverse name. ESPN often uses the longer form.
const ALIASES = {
  'nicholas singleton': 'nick singleton',
}
const keyOf = name => ALIASES[nameKey(name)] || nameKey(name)

export const rbStarter = (name, week) => {
  const book = roleBookForWeek(week)
  if (!book.matched) return null
  return book.rbByName.get(keyOf(name)) || null
}
export const wrRole = (name, week) => {
  const book = roleBookForWeek(week)
  if (!book.matched) return null
  return book.wrByName.get(keyOf(name))?.[0] || null
}
/** Role tags for a player row. [] when this week's sheet is missing or the player is not on it. */
export function roleTags(player, week) {
  const name = player.player || player.name, pos = player.pos || player.position
  if (pos === 'WR') { const w = wrRole(name, week); return w ? [w.rank, ...(w.slot ? ['slot'] : []), `${w.alignment}/${w.side}`] : [] }
  if (pos === 'RB' || pos === 'FB') {
    const r = rbStarter(name, week); if (!r) return []
    return [r.depth, r.primary, ...(r.glRole !== 'none' ? [r.glLabel] : []), ...r.secondary.filter(t => !/goal-line/i.test(t) || r.glRole === 'none')]
  }
  return []
}
