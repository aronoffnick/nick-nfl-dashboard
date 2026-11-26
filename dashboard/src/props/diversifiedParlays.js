import { valid } from './model.js'

const LADDERS = {
  passYds: [150, 175, 200, 225, 250, 275, 300, 325],
  rushYds: [25, 40, 50, 60, 75, 90, 100, 110],
  recYds: [15, 25, 40, 50, 60, 75, 90, 100],
  rec: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  totalTD: [0.5],
}
const LABELS = {
  passYds: 'pass yards',
  rushYds: 'rush yards',
  recYds: 'receiving yards',
  rec: 'receptions',
  totalTD: 'anytime TD',
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))

function statValue(log, key) {
  if (key !== 'totalTD') return log[key]
  return valid(log.rushTD) && valid(log.recTD) ? log.rushTD + log.recTD : null
}
function projectionFor(player, key) {
  if (key !== 'totalTD') return player.stats?.[key]?.projection
  const rush = player.stats?.rushTD?.projection
  const rec = player.stats?.recTD?.projection
  return valid(rush) && valid(rec) ? rush + rec : null
}

/** Highest standard rung the projection still clears. Not a sportsbook line. */
export function modelLine(projection, key) {
  const ladder = LADDERS[key]
  if (!ladder || !valid(projection)) return null
  const cushion = key === 'rec' ? 0.4 : key === 'totalTD' ? 0 : Math.max(key === 'passYds' ? 12 : 6, projection * 0.08)
  const choices = ladder.filter(line => projection >= line + cushion)
  return choices.length ? choices.at(-1) : null
}

/**
 * 60% of recent games clearing the line, 40% a sketch from how far the projection sits past it.
 * Touchdowns use 1 - e^(-expected) for the sketch. This is not a market price.
 */
export function legHitEstimate({ logs = [], key, line, projection, window = 4 }) {
  const values = logs.slice(-Math.max(window, 8)).map(log => statValue(log, key)).filter(valid)
  const cleared = value => key === 'totalTD' ? value >= 1 : value > line
  const recent = values.length >= 3 ? values.filter(cleared).length / values.length : null
  const scale = key === 'passYds' ? 40 : key === 'rec' ? 1.5 : key === 'totalTD' ? 0.5 : 15
  const sketch = key === 'totalTD'
    ? clamp(1 - Math.exp(-(projection || 0)), 0.08, 0.85)
    : clamp(0.5 + ((projection || 0) - line) / scale, 0.12, 0.88)
  const hit = recent == null ? sketch : 0.6 * recent + 0.4 * sketch
  return { hit, recent, sketch, n: values.length }
}

/** A 7-point model favorite is about 73%. From the team-model margin only. */
export function favoriteWinEstimate(margin) {
  return 1 / (1 + Math.exp(-margin / 7))
}

export function independentJoint(legs) {
  return legs.reduce((product, leg) => product * leg.hit, 1)
}

function makePlayerLeg(player, key, window) {
  const projection = projectionFor(player, key)
  const line = modelLine(projection, key)
  if (line == null) return null
  const estimate = legHitEstimate({ logs: player.logs, key, line, projection, window })
  return {
    id: `${player.team.id}:${player.id}:${key}`,
    kind: 'player',
    player,
    team: player.team,
    key,
    label: LABELS[key],
    line,
    projection,
    ...estimate,
  }
}

function teamLeg(matchup) {
  if (!(matchup.margin >= 0.5) || !matchup.winner) return null
  const hit = favoriteWinEstimate(matchup.margin)
  return {
    id: `team:${matchup.winner.id}`,
    kind: 'team',
    team: matchup.winner,
    key: 'win',
    label: 'to win',
    line: null,
    projection: null,
    hit,
    recent: null,
    sketch: hit,
    n: 0,
    margin: matchup.margin,
    why: `${matchup.winner.abbr} is the team-model favorite by ${matchup.margin.toFixed(1)}. The chance is a curve of that margin, not a moneyline price.`,
  }
}

function anytimeLeg(player, window) {
  const projection = projectionFor(player, 'totalTD')
  if (!valid(projection) || projection < 0.35) return null
  const estimate = legHitEstimate({ logs: player.logs, key: 'totalTD', line: 0.5, projection, window })
  return { id: `${player.team.id}:${player.id}:totalTD`, kind: 'player', player, team: player.team, key: 'totalTD', label: LABELS.totalTD, line: 0.5, projection, ...estimate }
}

function bestLeg(player, keys, window) {
  return keys.map(key => makePlayerLeg(player, key, window)).filter(Boolean).sort((a, b) => b.hit - a.hit || b.projection - a.projection)[0] || null
}

const TYPICAL = { passYds: 220, rushYds: 55, recYds: 45, rec: 4, totalTD: 0.45, win: 1 }
function quality(leg) {
  const size = leg.kind === 'team' ? 1 : Math.min((leg.projection || 0) / (TYPICAL[leg.key] || 1), 1.4)
  return leg.hit * size
}

function overallParlay(playerLegs, favorite) {
  const bestByPlayer = new Map()
  for (const leg of playerLegs) {
    const current = bestByPlayer.get(leg.player.id)
    if (!current || quality(leg) > quality(current)) bestByPlayer.set(leg.player.id, leg)
  }
  const props = [...bestByPlayer.values()].sort((a, b) => quality(b) - quality(a)).slice(0, favorite ? 2 : 3)
  const legs = favorite ? [favorite, ...props] : props
  if (legs.length < 2) return { title: 'Overall favorite', legs: [], why: 'Not enough projected props to build a 2- or 3-leg parlay.', joint: null }
  const why = favorite
    ? `${favorite.team.abbr} to win, plus the player props with the strongest mix of hit chance and projection size.`
    : 'The team model is a toss-up, so this is the strongest player-prop group in the game.'
  return { title: 'Overall favorite', legs, why, joint: independentJoint(legs) }
}

function correlatedParlay(team, players, window) {
  const title = `${team.abbr} correlated`
  const qb = players.filter(player => player.team.id === team.id && player.position === 'QB')
    .sort((a, b) => (projectionFor(b, 'passYds') ?? -1) - (projectionFor(a, 'passYds') ?? -1))[0]
  const pass = qb && makePlayerLeg(qb, 'passYds', window)
  if (!pass) return { title, legs: [], why: `${team.abbr} has no quarterback with a pass-yards projection.`, joint: null }
  const catchers = players.filter(player => player.team.id === team.id && player.id !== qb.id && ['WR', 'TE', 'RB', 'FB'].includes(player.position))
    .map(player => ({ player, recYds: projectionFor(player, 'recYds') }))
    .filter(row => valid(row.recYds))
    .sort((a, b) => b.recYds - a.recYds)
  const receivers = catchers.filter(row => row.player.position === 'WR' || row.player.position === 'TE')
  const alpha = receivers[0]?.player
  const yards = alpha && makePlayerLeg(alpha, 'recYds', window)
  const catches = alpha && makePlayerLeg(alpha, 'rec', window)
  const td = alpha && anytimeLeg(alpha, window)
  const legs = [pass, yards, catches, td].filter(Boolean)
  if (legs.length < 2) return { title, legs, why: `${team.abbr} does not have a pass-catcher with a projection next to ${qb.name.split(' ').at(-1)}.`, joint: legs.length ? independentJoint(legs) : null }
  const alphaName = alpha.name.split(' ').at(-1)
  return {
    title,
    legs,
    why: `Same throws. ${qb.name.split(' ').at(-1)}'s passing yards and ${alphaName}'s yards, catches, and touchdown chance move together.`,
    joint: independentJoint(legs),
  }
}

function scriptParlay(matchup, players, window) {
  const title = 'Game-script mix'
  if (!(matchup.margin >= 0.05) || !matchup.winner) return { title, legs: [], why: 'The team model is a toss-up, so neither side is a script favorite.', joint: null }
  const favorite = matchup.winner
  const dog = matchup.away.id === favorite.id ? matchup.home : matchup.away
  const back = players.filter(player => player.team.id === favorite.id && (player.position === 'RB' || player.position === 'FB'))
    .sort((a, b) => (projectionFor(b, 'rushYds') ?? -1) - (projectionFor(a, 'rushYds') ?? -1))[0]
  const catcher = players.filter(player => player.team.id === dog.id && (player.position === 'WR' || player.position === 'TE' || player.position === 'RB'))
    .sort((a, b) => (projectionFor(b, 'rec') ?? -1) - (projectionFor(a, 'rec') ?? -1) || (projectionFor(b, 'recYds') ?? -1) - (projectionFor(a, 'recYds') ?? -1))[0]
  const rush = back && bestLeg(back, ['rushYds'], window)
  const receiving = catcher && bestLeg(catcher, catcher.position === 'RB' ? ['rec', 'recYds'] : ['rec', 'recYds'], window)
  if (rush) rush.why = `${favorite.abbr} is favored by ${matchup.margin.toFixed(1)}. A lead usually means more carries for ${back.name.split(' ').at(-1)}.`
  if (receiving) receiving.why = `${dog.abbr} is the underdog by ${matchup.margin.toFixed(1)}. A deficit usually means more passes, and ${catcher.name.split(' ').at(-1)} is the top projected pass catcher.`
  const legs = [rush, receiving].filter(Boolean)
  if (legs.length < 2) return { title, legs, why: 'One side is missing a projected back or pass catcher.', joint: legs.length ? independentJoint(legs) : null }
  return {
    title,
    legs,
    why: `If ${favorite.abbr} leads, their back should see the carries, and ${dog.abbr} should throw more.`,
    joint: independentJoint(legs),
  }
}

export function buildDiversifiedParlays({ matchup, players, window = 4 }) {
  const usable = (players || []).filter(player => !player.unavailable && !player.stale)
  const keysFor = player => player.allowedKeys || (player.position === 'QB' ? ['passYds']
    : player.position === 'RB' || player.position === 'FB' ? ['rushYds', 'rec', 'recYds', 'totalTD']
    : ['recYds', 'rec', 'totalTD'])
  const playerLegs = usable.flatMap(player => keysFor(player).map(key => makePlayerLeg(player, key, window)).filter(Boolean))
  const favorite = teamLeg(matchup)
  return [
    overallParlay(playerLegs, favorite, window),
    correlatedParlay(matchup.away, usable, window),
    correlatedParlay(matchup.home, usable, window),
    scriptParlay(matchup, usable, window),
  ]
}
