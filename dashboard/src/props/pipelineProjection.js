import { nameKey } from './roleEligibility.js'

const SCATTER_TO_MODEL = { passYds: 'passYds', rushYds: 'rushYds', rec: 'rec', recYds: 'recYds', td: 'totalTD' }

/** Replace browser projections with the week file when that player is in it. */
export function applyScatter(players, scatterPlayers) {
  const byName = new Map((scatterPlayers || []).map(row => [nameKey(row.n), row]))
  let used = 0
  for (const player of players) {
    const row = byName.get(nameKey(player.name))
    if (!row?.s) continue
    let hit = false
    for (const [scatterKey, modelKey] of Object.entries(SCATTER_TO_MODEL)) {
      const triple = row.s[scatterKey]
      if (!triple || triple[1] == null || !player.stats?.[modelKey]) continue
      player.stats[modelKey] = { ...player.stats[modelKey], projection: triple[1], pipeline: true }
      hit = true
    }
    if (player.position === 'QB' && row.s.td?.[1] != null && player.stats?.rushTD) {
      player.stats.rushTD = { ...player.stats.rushTD, projection: row.s.td[1], pipeline: true }
      hit = true
    }
    if (hit) used += 1
  }
  return used
}
