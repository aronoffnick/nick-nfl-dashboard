import starters from '../data/qb-starters.json' with { type: 'json' }
import { valid } from './model.js'

export function starterFor(abbr, week) {
  return starters.weeks?.[String(week)]?.[abbr] || null
}

export function applyTeamStarter(team, week) {
  const spec = starterFor(team?.abbr, week)
  if (!spec) return team
  const total = (team.recent?.passO || 0) + (team.recent?.rushO || 0)
  const passShare = total > 0 ? team.recent.passO / total : 0
  const scoringFactor = 1 - passShare * (1 - spec.efficiency)
  return {
    ...team,
    pf: team.pf * scoringFactor,
    recent: { ...team.recent, passO: team.recent.passO * spec.efficiency },
    qbOverride: spec,
  }
}

function scaled(value, ratio, places) {
  if (!valid(value)) return value
  const factor = 10 ** places
  return Math.round(value * ratio * factor) / factor
}

export function applyQbStarter(players, week) {
  const list = players.map(player => ({ ...player, stats: { ...player.stats } }))
  const specs = new Map()
  for (const player of list) {
    const spec = starterFor(player.team?.abbr || player.offense?.abbr, week)
    if (spec) specs.set(player.team?.abbr || player.offense?.abbr, { spec, sample: player })
  }
  for (const player of list) {
    const abbr = player.team?.abbr || player.offense?.abbr
    const spec = starterFor(abbr, week)
    if (!spec) continue
    if (player.position === 'QB' && player.name !== spec.qb) {
      player.unavailable = true
      if (player.stats.passYds) player.stats.passYds = { ...player.stats.passYds, projection: null }
      if (player.stats.passTD) player.stats.passTD = { ...player.stats.passTD, projection: null }
      continue
    }
    if (player.position === 'QB' && player.name === spec.qb) {
      player.stats.passYds = { ...(player.stats.passYds || {}), projection: spec.passYds, baseline: spec.passYdsBeforeDefense, sample: spec.careerAttempts }
      continue
    }
    if (['WR', 'TE', 'RB'].includes(player.position) && !player.stats.recYds?.pipeline && player.stats.recYds) {
      player.stats.recYds = { ...player.stats.recYds, projection: scaled(player.stats.recYds.projection, spec.efficiency, 1) }
    }
    if (['WR', 'TE', 'RB'].includes(player.position) && player.stats.totalTD && !player.stats.totalTD.pipeline) {
      player.stats.totalTD = { ...player.stats.totalTD, projection: scaled(player.stats.totalTD.projection, spec.efficiency, 2) }
    }
  }
  for (const [abbr, { spec, sample }] of specs) {
    if (list.some(player => (player.team?.abbr || player.offense?.abbr) === abbr && player.name === spec.qb)) continue
    const team = sample.team || sample.offense
    list.push({
      id: `qb-override-${abbr}`,
      name: spec.qb,
      position: 'QB',
      team, offense: team, opponent: sample.opponent,
      teamId: team.id,
      status: 'Active',
      injury: '',
      logs: [],
      lastFour: [],
      limited: true,
      stale: false,
      unavailable: false,
      stats: {
        passYds: { baseline: spec.passYdsBeforeDefense, projection: spec.passYds, sample: spec.careerAttempts, defense: { factor: spec.defenseFactor, adjusted: true }, min: null, max: null },
        passTD: { baseline: null, projection: null, sample: 0, defense: null, min: null, max: null },
        rushYds: { baseline: null, projection: null, sample: 0, defense: null, min: null, max: null },
      },
    })
  }
  return list
}
