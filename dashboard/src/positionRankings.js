// Position boards read the momentum week file. `adjusted` is already
// the pipeline pre-game projection times that player's net multiple.
// Nothing here computes a new stat.

export const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE']

const STAT_NAME = {
  passYds: 'passing yards',
  rushYds: 'rushing yards',
  recYds: 'receiving yards',
  rec: 'receptions',
}

export function statName(primary) {
  return STAT_NAME[primary] || null
}

export function basisSentence(primary) {
  const stat = statName(primary)
  if (!stat) return 'Ranked by the adjusted projection stored in this week’s file. Players without that number are left off the board.'
  return `Ranked by adjusted projected ${stat} this week. Adjusted is the pipeline pre-game projection times the net momentum and defense multiple stored in the week file.`
}

export function positionsFor(players) {
  const present = new Set(players.map(player => player.position).filter(Boolean))
  const extras = [...present].filter(position => !CORE_POSITIONS.includes(position)).sort()
  return [...CORE_POSITIONS, ...extras]
}

export function filterPlayers(players, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return players
  return players.filter(player => `${player.name || ''} ${player.team || ''} ${player.opponent || ''}`.toLowerCase().includes(q))
}

// Same tie rule as the team board: equal values share a rank, and the next rank skips.
export function rankGroup(players) {
  const ranked = []
  const missing = []
  for (const player of players) {
    if (Number.isFinite(player?.adjusted)) ranked.push(player)
    else missing.push(player)
  }
  ranked.sort((a, b) => b.adjusted - a.adjusted || String(a.name).localeCompare(String(b.name)))
  return {
    rows: ranked.map(player => ({
      ...player,
      rank: 1 + ranked.filter(other => other.adjusted > player.adjusted).length,
    })),
    missing,
  }
}

export function groupRankings(players, { position = 'All', query = '' } = {}) {
  const list = Array.isArray(players) ? players : []
  const order = position === 'All' ? positionsFor(list) : [position]
  return order.map(pos => {
    const inPosition = list.filter(player => player.position === pos)
    const shown = filterPlayers(inPosition, query)
    const primaries = [...new Set(inPosition.map(player => player.primary).filter(Boolean))]
    return {
      position: pos,
      primary: primaries.length === 1 ? primaries[0] : null,
      inFile: inPosition.length,
      ...rankGroup(shown),
    }
  })
}

export function rankingsFromFile(file, options) {
  if (!file?.matched || !Array.isArray(file.data?.players)) {
    return { status: 'missing', week: file?.week ?? null, throughWeek: null, method: '', groups: [] }
  }
  return {
    status: 'ready',
    week: file.data.week ?? file.week,
    throughWeek: file.data.throughWeek ?? null,
    method: file.data.method || '',
    groups: groupRankings(file.data.players, options),
  }
}
