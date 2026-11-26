// Favorite skill position for one team on the Parlays tab.
//
// Rule: among RB (fullbacks included), WR, and TE, pick the group with the
// largest share of that team's projected rush yards plus receiving yards.
// Those projections are the Player Projections model (projectTeam): a weighted
// baseline from current-team appearances, times the opponent's position
// adjustment. Quarterbacks are not a candidate group. Passing yards describe
// the same plays as receiving yards, so including them would count the passing
// game twice and would not show a split workload. Quarterback rush yards stay
// out of the pool for the same reason: the display is a skill-group comparison.
//
// A player counts only when both of these are true:
//   - the roster does not mark them unavailable (inactive, injured reserve,
//     suspended, retired, out, or doubtful)
//   - roleDecision says they are eligible, with no stat key, so the weekly
//     WR1–WR3 and RB out / depth-minimal gate applies and a rushing back is
//     not dropped for lacking a pass-catching tag
// A projection needs three recorded appearances. Rush and receiving are summed
// only where a projection exists. A total of zero is not a split of the work,
// so that player is left off the list and out of the share.
//
// Players are ordered by that yard total. An exact tie uses the weekly RB
// carry share, then RB target share, then name. Those shares are a tie-break
// only: they measure usage inside the running-back group, and the WR and TE
// sheets do not publish a target share. At most three players are returned.
//
// If two groups have the same yard total, the group with the higher opponent
// adjustment on its main stat wins (rush yards for RB, receiving yards for
// WR and TE). A remaining tie goes RB, then WR, then TE.

import { valid } from './model.js'
import { findRb, roleDecision } from './roleEligibility.js'

export const FAVORITE_NOTE = 'Each row is that team’s RB, WR, or TE group with the largest share of projected rush plus receiving yards. The names are the top three at that position by those yards. Quarterbacks are omitted so passing yards are not counted twice. Unavailable players and players removed by the weekly role gate are left out.'

export const FAVORITE_RULE = 'The yards are the same Player Projections numbers for this matchup: recent current-team appearances, weighted by the dashboard half-life, times the opponent position adjustment. A projection exists only after three recorded appearances. Receiver rush yards are included here; the Player Projections card does not show a rush column for WR or TE. Fullbacks count in the RB group. If two groups tie on yards, the one facing the higher opponent adjustment on its main stat (rush for RB, receiving for WR and TE) is shown. An exact player tie uses the weekly RB carry share, then RB target share, then name. Those sheet shares are not the ranking number, because they only describe the running-back room and the WR and TE sheets have no target share. One or two projected players are shown as-is. This describes the projection model. It is not a probability or a sportsbook price.'

const POSITIONS = ['RB', 'WR', 'TE']
const POSITION_ORDER = { RB: 0, WR: 1, TE: 2 }

function listedPosition(position) {
  return position === 'FB' ? 'RB' : position
}

function statProjection(player, key) {
  const value = player.stats?.[key]?.projection
  return valid(value) ? value : null
}

export function skillYards(player) {
  const rush = statProjection(player, 'rushYds')
  const rec = statProjection(player, 'recYds')
  if (rush == null && rec == null) return null
  return (rush || 0) + (rec || 0)
}

function matchupFactor(player, position) {
  const key = position === 'RB' ? 'rushYds' : 'recYds'
  const factor = player.stats?.[key]?.defense?.factor
  return valid(factor) ? factor : 1
}

function nameKey(name) {
  return String(name || '').trim().toLowerCase()
}

function prefer(next, prev) {
  if (Boolean(next.unavailable) !== Boolean(prev.unavailable)) return next.unavailable ? prev : next
  const nextYards = skillYards(next)
  const prevYards = skillYards(prev)
  if ((nextYards ?? -1) !== (prevYards ?? -1)) return (nextYards ?? -1) > (prevYards ?? -1) ? next : prev
  return (next.logs?.length || 0) >= (prev.logs?.length || 0) ? next : prev
}

function dedupePlayers(players) {
  const byId = new Map()
  for (const player of players) {
    const prev = byId.get(player.id)
    byId.set(player.id, prev ? prefer(player, prev) : player)
  }
  const byName = new Map()
  for (const player of byId.values()) {
    const key = nameKey(player.name)
    const prev = byName.get(key)
    byName.set(key, prev ? prefer(player, prev) : player)
  }
  return [...byName.values()]
}

function emptyReason() {
  return 'No eligible skill player has projected rush or receiving yards. A projection needs three appearances, and unavailable or role-gated players are excluded.'
}

export function favoriteForTeam(team, players, book) {
  const excluded = { unavailable: 0, role: 0, noYards: 0 }
  const considered = []
  for (const player of dedupePlayers(players)) {
    const position = listedPosition(player.position)
    if (!POSITIONS.includes(position)) continue
    if (player.unavailable) {
      excluded.unavailable += 1
      continue
    }
    const gate = roleDecision({ ...player, team }, { book })
    if (!gate.eligible) {
      excluded.role += 1
      continue
    }
    const yards = skillYards(player)
    if (yards == null || yards <= 0) {
      excluded.noYards += 1
      continue
    }
    const rb = position === 'RB' ? findRb(player.name, book) : null
    considered.push({
      id: player.id,
      name: player.name,
      rosterPosition: player.position,
      position,
      rush: statProjection(player, 'rushYds'),
      rec: statProjection(player, 'recYds'),
      yards,
      factor: matchupFactor(player, position),
      flag: gate.flag || null,
      carryShare: rb?.recentCarryShare ?? null,
      targetShare: rb?.targetShare ?? null,
    })
  }

  const groups = POSITIONS.map(position => {
    const members = considered.filter(player => player.position === position)
    const yards = members.reduce((sum, player) => sum + player.yards, 0)
    return { position, members, yards, factor: members.length ? members[0].factor : 1 }
  })
  const teamYards = groups.reduce((sum, group) => sum + group.yards, 0)
  if (teamYards <= 0) {
    return { team, position: null, share: null, yards: 0, players: [], available: 0, teamYards: 0, excluded, reason: emptyReason() }
  }

  const [favorite] = [...groups].sort((a, b) => b.yards - a.yards || b.factor - a.factor || POSITION_ORDER[a.position] - POSITION_ORDER[b.position])
  const ranked = [...favorite.members].sort((a, b) => {
    if (b.yards !== a.yards) return b.yards - a.yards
    if ((b.carryShare ?? -1) !== (a.carryShare ?? -1)) return (b.carryShare ?? -1) - (a.carryShare ?? -1)
    if ((b.targetShare ?? -1) !== (a.targetShare ?? -1)) return (b.targetShare ?? -1) - (a.targetShare ?? -1)
    return a.name.localeCompare(b.name)
  })
  const playersShown = ranked.slice(0, 3).map((player, index) => ({
    ...player,
    rank: index + 1,
    positionShare: favorite.yards > 0 ? player.yards / favorite.yards : null,
  }))
  return {
    team,
    position: favorite.position,
    yards: favorite.yards,
    share: favorite.yards / teamYards,
    factor: favorite.factor,
    players: playersShown,
    available: ranked.length,
    teamYards,
    excluded,
    reason: null,
    groups: groups.map(group => ({ position: group.position, yards: group.yards, share: teamYards > 0 ? group.yards / teamYards : 0 })),
  }
}
