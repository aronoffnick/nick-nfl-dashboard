import { nameKey } from './roleEligibility.js'

/** Point nflverse player ids at the current ESPN roster when the names match. */
export function bindHistoryPlayers(data, roster) {
  if (!data?.games || !roster) return
  const byName = new Map()
  for (const player of Object.values(roster)) {
    const key = `${player.teamId}|${nameKey(player.name)}`
    if (!byName.has(key)) byName.set(key, player.id)
  }
  for (const game of data.games) {
    if (game.source !== 'nflverse') continue
    for (const side of [game.away, game.home]) {
      for (const player of side.playerBox?.players || []) {
        const id = byName.get(`${side.id}|${nameKey(player.name)}`)
        if (id) player.id = id
      }
    }
  }
}
