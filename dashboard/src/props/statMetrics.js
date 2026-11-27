import { scatterAbbrev } from './scatterCheck.js'

export function teamsInGame(away, home) {
  return new Set([away, home].map(scatterAbbrev).filter(Boolean))
}

// Stat Metrics opens inside one game. "All players" is every player on the
// two teams in that game. It is not the rest of the league.
export function statMetricPlayers(players, { away, home, position = 'All' } = {}) {
  const teams = teamsInGame(away, home)
  return (players || []).filter(player => teams.has(player.team) && (position === 'All' || player.position === position))
}
