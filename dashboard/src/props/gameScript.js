// Game-script adjustments on top of the existing player projection.
// The baseline is already the recency-weighted season rate times the defense
// factor. A script multiplies that number. It does not rebuild the model.
import { clamp, valid, weighted } from './model.js'

const MIN_MOVE = 0.04
const MOVE_CAP = 0.32

const STAT_LABEL = {
  passAtt: 'pass attempts',
  passYds: 'pass yards',
  passTD: 'pass TDs',
  carries: 'rush attempts',
  rushYds: 'rush yards',
  rushTD: 'rush TDs',
  rec: 'receptions',
  recYds: 'receiving yards',
  recTD: 'receiving TDs',
}

const MARKET_KEY = {
  'pass yds': 'passYds',
  'pass yards': 'passYds',
  'passing yards': 'passYds',
  'pass attempts': 'passAtt',
  'pass att': 'passAtt',
  'rush yds': 'rushYds',
  'rush yards': 'rushYds',
  'rush attempts': 'carries',
  'carries': 'carries',
  'rec yds': 'recYds',
  'receiving yards': 'recYds',
  'receptions': 'rec',
  'pass td': 'passTD',
  'pass tds': 'passTD',
  'rush td': 'rushTD',
  'rush tds': 'rushTD',
  'rec td': 'recTD',
  'receiving tds': 'recTD',
}

const roundHalf = value => Math.round(value * 2) / 2
function roundStat(value, key) {
  if (String(key).includes('TD')) return Math.round(value * 100) / 100
  return roundHalf(value)
}

export function emptyScript() {
  return { win: null, margin: null, early: null, rush: null, pass: null, scoring: null }
}

export function toggleScript(selection, action, teamId) {
  const next = { ...emptyScript(), ...selection }
  if (action === 'win') {
    if (next.win === teamId && next.margin == null) next.win = null
    else { next.win = teamId; next.margin = null }
  } else if (action === 'big' || action === 'close') {
    const margin = action === 'big' ? 'big' : 'close'
    if (next.win === teamId && next.margin === margin) { next.win = null; next.margin = null }
    else { next.win = teamId; next.margin = margin }
  } else if (action === 'early' || action === 'rush' || action === 'pass') {
    next[action] = next[action] === teamId ? null : teamId
  } else if (action === 'shootout' || action === 'low') {
    next.scoring = next.scoring === action ? null : action
  }
  return next
}

export function scriptActive(selection) {
  return Boolean(selection?.win || selection?.early || selection?.rush || selection?.pass || selection?.scoring)
}

function same(a, b) {
  return a != null && b != null && String(a) === String(b)
}

function teamById(matchup, teamId) {
  if (same(matchup?.away?.id, teamId)) return matchup.away
  if (same(matchup?.home?.id, teamId)) return matchup.home
  return null
}

function opponentId(matchup, teamId) {
  if (same(matchup?.away?.id, teamId)) return matchup.home?.id
  if (same(matchup?.home?.id, teamId)) return matchup.away?.id
  return null
}

export function scriptSummary(selection, matchup) {
  const name = teamId => teamById(matchup, teamId)?.abbr || 'Team'
  const bits = []
  if (selection?.win) {
    const how = selection.margin === 'big' ? 'wins big' : selection.margin === 'close' ? 'wins a close game' : 'wins'
    bits.push(`${name(selection.win)} ${how}`)
  }
  if (selection?.early) bits.push(`${name(selection.early)} leads at half`)
  if (selection?.rush) bits.push(`${name(selection.rush)} rushing success`)
  if (selection?.pass) bits.push(`${name(selection.pass)} passing success`)
  if (selection?.scoring === 'shootout') bits.push('shootout')
  if (selection?.scoring === 'low') bits.push('low-scoring')
  return bits.join(' · ')
}

function leadScale(selection, teamId) {
  let scale = 0
  if (same(selection.win, teamId)) {
    scale = selection.margin === 'big' ? 1.55 : selection.margin === 'close' ? 0.5 : 1
  }
  if (same(selection.early, teamId)) {
    scale = scale === 0 ? 0.9 : Math.max(scale, 0.9) + 0.25
  }
  return scale
}

function scaleKeys(keys, scale) {
  return Object.fromEntries(Object.entries(keys).map(([key, pct]) => [key, pct * scale]))
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()
}

function readStat(player, key, halfLife) {
  if (key === 'passAtt' || key === 'carries') {
    const baseline = weighted(player.logs || [], key, halfLife)
    const yard = key === 'passAtt' ? 'passYds' : 'rushYds'
    const defense = player.stats?.[yard]?.defense
    const factor = valid(defense?.factor) ? defense.factor : 1
    const sample = (player.logs || []).filter(log => valid(log[key])).length
    if (sample < 3 || !valid(baseline)) return null
    return {
      projection: roundHalf(baseline * factor),
      sample,
      defenseAdjusted: Boolean(defense?.adjusted),
    }
  }
  const stat = player.stats?.[key]
  if (!valid(stat?.projection)) return null
  return {
    projection: stat.projection,
    sample: stat.sample || 0,
    defenseAdjusted: Boolean(stat.defense?.adjusted),
  }
}

function roleRatio(value, top) {
  if (!(top > 0)) return 0.35
  const ratio = value / top
  if (ratio < 0.35) return ratio
  return clamp(ratio, 0.35, 0.8)
}

function ranked(players, teamId, positions, rankBy, halfLife) {
  return players
    .filter(player => same(player.team?.id, teamId) && positions.includes(player.position) && !player.unavailable)
    .map(player => ({ player, value: readStat(player, rankBy, halfLife)?.projection ?? null }))
    .filter(row => valid(row.value))
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name))
}

function roleName(position, index) {
  if (position === 'QB') return index === 0 ? 'QB' : `QB${index + 1}`
  if (position === 'RB' || position === 'FB') return `RB${index + 1}`
  if (position === 'WR') return `WR${index + 1}`
  if (position === 'TE') return index === 0 ? 'TE' : `TE${index + 1}`
  return position
}

function leadShort(selection, teamId) {
  const bits = []
  if (same(selection.win, teamId)) {
    if (selection.margin === 'big') bits.push('Wins big')
    else if (selection.margin === 'close') bits.push('Close win')
    else bits.push('Wins')
  }
  if (same(selection.early, teamId)) bits.push('Leads at half')
  return bits.join(', ')
}

function trailShort(selection, teamId, matchup) {
  const other = opponentId(matchup, teamId)
  const bits = []
  if (same(selection.win, other)) {
    if (selection.margin === 'big') bits.push('Trailing big')
    else if (selection.margin === 'close') bits.push('Trailing a close game')
    else bits.push('Trailing')
  }
  if (same(selection.early, other)) bits.push('Facing a halftime lead')
  return bits.join(', ')
}

function effectsFor(selection, matchup) {
  const effects = []
  const teams = [matchup.away, matchup.home].filter(team => team?.id != null)
  for (const team of teams) {
    const lead = leadScale(selection, team.id)
    if (lead > 0) {
      const short = leadShort(selection, team.id)
      effects.push({ teamId: team.id, positions: ['RB', 'FB'], rankBy: 'rushYds', short, keys: scaleKeys({ carries: 0.12, rushYds: 0.10, rushTD: 0.08 }, lead) })
      effects.push({ teamId: team.id, positions: ['QB'], rankBy: 'passYds', short, keys: scaleKeys({ passAtt: -0.10, passYds: -0.08, passTD: -0.05 }, lead) })
    }
    const other = opponentId(matchup, team.id)
    const trail = other == null ? 0 : leadScale(selection, other)
    if (trail > 0) {
      const short = trailShort(selection, team.id, matchup)
      effects.push({ teamId: team.id, positions: ['QB'], rankBy: 'passYds', short, keys: scaleKeys({ passAtt: 0.12, passYds: 0.12, passTD: 0.08 }, trail) })
      effects.push({ teamId: team.id, positions: ['WR', 'TE'], rankBy: 'recYds', short, keys: scaleKeys({ rec: 0.10, recYds: 0.12, recTD: 0.06 }, trail) })
      effects.push({ teamId: team.id, positions: ['RB', 'FB'], rankBy: 'rushYds', short, keys: scaleKeys({ carries: -0.12, rushYds: -0.12, rushTD: -0.06 }, trail) })
    }
    if (same(selection.rush, team.id)) {
      effects.push({ teamId: team.id, positions: ['RB', 'FB'], rankBy: 'rushYds', short: 'Rushing success', keys: { rushYds: 0.16, rushTD: 0.18, carries: 0.08 } })
      effects.push({ teamId: team.id, positions: ['QB'], rankBy: 'passYds', short: 'Rushing success', keys: { passAtt: -0.05, passYds: -0.04 } })
      if (other != null) {
        effects.push({ teamId: other, positions: ['QB'], rankBy: 'passYds', short: 'Opponent rushing success', keys: { passAtt: 0.10, passYds: 0.10, passTD: 0.06 } })
        effects.push({ teamId: other, positions: ['WR', 'TE'], rankBy: 'recYds', short: 'Opponent rushing success', keys: { rec: 0.06, recYds: 0.10 } })
      }
    }
    if (same(selection.pass, team.id)) {
      effects.push({ teamId: team.id, positions: ['QB'], rankBy: 'passYds', short: 'Passing success', keys: { passYds: 0.14, passTD: 0.16, passAtt: 0.08 } })
      effects.push({ teamId: team.id, positions: ['WR'], rankBy: 'recYds', short: 'Passing success', keys: { recYds: 0.14, rec: 0.08, recTD: 0.08 } })
      effects.push({ teamId: team.id, positions: ['TE'], rankBy: 'recYds', short: 'Passing success', keys: { recYds: 0.11, rec: 0.06, recTD: 0.06 } })
    }
  }
  if (selection.scoring === 'shootout' || selection.scoring === 'low') {
    const low = selection.scoring === 'low'
    const short = low ? 'Low-scoring' : 'Shootout'
    for (const team of teams) {
      effects.push({
        teamId: team.id, positions: ['QB'], rankBy: 'passYds', short,
        keys: low
          ? { passYds: -0.11, passTD: -0.14, passAtt: -0.07 }
          : { passYds: 0.12, passTD: 0.12, passAtt: 0.08 },
      })
      effects.push({
        teamId: team.id, positions: ['WR'], rankBy: 'recYds', short,
        keys: low ? { recYds: -0.10, rec: -0.06 } : { recYds: 0.13, rec: 0.07 },
      })
      effects.push({
        teamId: team.id, positions: ['TE'], rankBy: 'recYds', short,
        keys: low ? { recYds: -0.08 } : { recYds: 0.08, rec: 0.05 },
      })
      if (low) effects.push({ teamId: team.id, positions: ['RB', 'FB'], rankBy: 'rushYds', short, keys: { rushYds: -0.05, rushTD: -0.10 } })
    }
  }
  return effects
}

function combinePercents(parts) {
  const pos = parts.filter(part => part.pct > 0).sort((a, b) => b.pct - a.pct)
  const neg = parts.filter(part => part.pct < 0).sort((a, b) => a.pct - b.pct)
  const fold = list => list.reduce((sum, part, index) => sum + part.pct * (index === 0 ? 1 : 0.45), 0)
  return clamp(fold(pos) + fold(neg), -MOVE_CAP, MOVE_CAP)
}

export function scriptFit({ pct, roleWeight, sample, defenseAdjusted, stale }) {
  const move = Math.min(Math.abs(pct) / 0.12, 1)
  const role = 0.55 + 0.45 * roleWeight
  const sampleScore = Math.min((sample || 0) / 8, 1)
  const defense = defenseAdjusted ? 1 : 0.8
  const fresh = stale ? 0.85 : 1
  return Math.round(100 * move * role * (0.65 + 0.35 * sampleScore) * defense * fresh)
}

export function fitLabel(fit) {
  if (fit >= 70) return 'Strong'
  if (fit >= 45) return 'Moderate'
  return 'Light'
}

function formatStat(value, key) {
  if (!valid(value)) return '—'
  return value.toFixed(String(key).includes('TD') ? 2 : 1)
}

function whyText({ name, role, key, pct, baseline, scenario, parts }) {
  const dir = pct >= 0 ? 'up' : 'down'
  const points = Math.abs(Math.round(pct * 100))
  const ordered = parts.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
  const main = ordered[0]
  const rest = ordered.slice(1).map(part => part.short.toLowerCase())
  const also = rest.length ? ` Stacked with ${rest.join(' and ')}.` : ''
  return `${main.short}: ${name} is the ${role}, so ${STAT_LABEL[key]} move ${dir} ${points}% (${formatStat(baseline, key)} → ${formatStat(scenario, key)}) from the recency-weighted projection.${also}`
}

function lineFor(lines, player, key) {
  const name = normName(player.name)
  let found = null
  for (const leg of lines || []) {
    if (leg.kind && leg.kind !== 'prop') continue
    const market = MARKET_KEY[String(leg.market || '').toLowerCase()]
    if (market !== key || normName(leg.player) !== name || !valid(Number(leg.line))) continue
    const row = { line: Number(leg.line), priced: Boolean(leg.priced), source: leg.priced ? 'snapshot' : 'model' }
    if (!found || (row.priced && !found.priced)) found = row
  }
  return found
}

function directionFor(pct, scenario, line) {
  if (!valid(line)) return pct >= 0 ? 'over' : 'under'
  if (scenario > line) return 'over'
  if (scenario < line) return 'under'
  return pct >= 0 ? 'over' : 'under'
}

function rolesFor(players, halfLife) {
  const map = new Map()
  const teams = [...new Set(players.map(player => player.team?.id).filter(id => id != null))]
  const groups = [
    [['QB'], 'passYds', index => (index === 0 ? 'QB' : `QB${index + 1}`)],
    [['RB', 'FB'], 'rushYds', index => `RB${index + 1}`],
    [['WR'], 'recYds', index => `WR${index + 1}`],
    [['TE'], 'recYds', index => (index === 0 ? 'TE' : `TE${index + 1}`)],
  ]
  for (const teamId of teams) {
    for (const [positions, rankBy, label] of groups) {
      ranked(players, teamId, positions, rankBy, halfLife).forEach((row, index) => {
        map.set(row.player.id, label(index))
      })
    }
  }
  return map
}

function moneyline(team, selection) {
  const how = selection.margin === 'big' ? 'big' : selection.margin === 'close' ? ' in a close game' : ''
  const fit = selection.margin === 'big' ? 72 : selection.margin === 'close' ? 46 : 64
  return {
    id: `ml:${team.id}`,
    kind: 'team',
    teamId: team.id,
    team,
    name: team.name,
    role: 'ML',
    key: 'win',
    statLabel: 'to win',
    direction: 'ml',
    line: null,
    lineSource: null,
    baseline: null,
    scenario: null,
    pct: null,
    arrow: null,
    fit,
    fitLabel: fitLabel(fit),
    why: `Moneyline: the script says ${team.abbr} wins${how}. The player props below are the stats that usually come with that result.`,
    playerId: null,
  }
}

function pushParlay(parlays, used, title, legs) {
  const clean = []
  const seenPlayers = new Set()
  for (const leg of legs) {
    if (!leg || used.has(leg.id) || clean.some(item => item.id === leg.id)) continue
    if (leg.playerId && seenPlayers.has(leg.playerId)) continue
    if (leg.playerId) seenPlayers.add(leg.playerId)
    clean.push(leg)
    if (clean.length === 3) break
  }
  if (clean.length < 2 || parlays.length >= 3) return
  for (const leg of clean) used.add(leg.id)
  parlays.push({ id: clean.map(leg => leg.id).join('|'), title, legs: clean })
}

function firstProp(props, used, pred) {
  return props.find(prop => !used.has(prop.id) && pred(prop)) || null
}

function buildParlays(props, selection, matchup) {
  const parlays = []
  const used = new Set()
  const winner = selection.win ? teamById(matchup, selection.win) : null
  if (winner) {
    const rush = firstProp(props, used, prop => same(prop.teamId, winner.id) && prop.key === 'rushYds' && prop.direction === 'over' && prop.role === 'RB1')
      || firstProp(props, used, prop => same(prop.teamId, winner.id) && prop.key === 'carries' && prop.direction === 'over')
      || firstProp(props, used, prop => same(prop.teamId, winner.id) && prop.direction === 'over')
    pushParlay(parlays, used, `${winner.abbr} win script`, [moneyline(winner, selection), rush])
  }

  const passTeams = []
  if (selection.pass) passTeams.push(selection.pass)
  else if (selection.win) passTeams.push(opponentId(matchup, selection.win))
  else if (selection.early) passTeams.push(opponentId(matchup, selection.early))
  else if (selection.scoring === 'shootout') passTeams.push(matchup.away?.id, matchup.home?.id)
  for (const teamId of passTeams.filter(Boolean)) {
    const team = teamById(matchup, teamId)
    const qb = firstProp(props, used, prop => same(prop.teamId, teamId) && prop.key === 'passYds' && prop.direction === 'over' && prop.role === 'QB')
    const catcher = firstProp(props, used, prop => same(prop.teamId, teamId) && prop.key === 'recYds' && prop.direction === 'over' && (prop.role === 'WR1' || prop.role === 'TE'))
      || firstProp(props, used, prop => same(prop.teamId, teamId) && (prop.key === 'recYds' || prop.key === 'rec') && prop.direction === 'over')
    if (team) pushParlay(parlays, used, `${team.abbr} pass stack`, [qb, catcher])
  }

  if (selection.scoring === 'shootout') {
    const qbs = [matchup.away, matchup.home].map(team => firstProp(props, used, prop => same(prop.teamId, team?.id) && prop.key === 'passYds' && prop.direction === 'over' && prop.role === 'QB'))
    pushParlay(parlays, used, 'Shootout overs', qbs)
  }
  if (selection.scoring === 'low') {
    const qbs = [matchup.away, matchup.home].map(team => firstProp(props, used, prop => same(prop.teamId, team?.id) && prop.key === 'passYds' && prop.direction === 'under' && prop.role === 'QB'))
    pushParlay(parlays, used, 'Low-scoring unders', qbs)
  }

  const leaderId = selection.win || selection.early
  const trailerId = leaderId ? opponentId(matchup, leaderId) : null
  if (leaderId && trailerId && parlays.length < 3) {
    const lead = firstProp(props, used, prop => same(prop.teamId, leaderId) && (prop.key === 'rushYds' || prop.key === 'carries') && prop.direction === 'over')
    const trail = firstProp(props, used, prop => same(prop.teamId, trailerId) && (prop.key === 'passYds' || prop.key === 'recYds' || prop.key === 'rec') && prop.direction === 'over')
    pushParlay(parlays, used, 'Lead and trail', [lead, trail])
  }

  if (selection.pass && parlays.length < 3) {
    const team = teamById(matchup, selection.pass)
    const receiver = firstProp(props, used, prop => same(prop.teamId, selection.pass) && String(prop.role).startsWith('WR') && (prop.key === 'recYds' || prop.key === 'rec') && prop.direction === 'over')
    const tight = firstProp(props, used, prop => same(prop.teamId, selection.pass) && prop.role === 'TE' && (prop.key === 'recYds' || prop.key === 'rec') && prop.direction === 'over')
    if (team) pushParlay(parlays, used, `${team.abbr} receivers`, [receiver, tight])
  }
  if (selection.pass && parlays.length < 3) {
    const team = teamById(matchup, selection.pass)
    const score = firstProp(props, used, prop => same(prop.teamId, selection.pass) && prop.role === 'QB' && prop.key === 'passTD' && prop.direction === 'over')
    const catcher = firstProp(props, used, prop => same(prop.teamId, selection.pass) && (prop.key === 'rec' || prop.key === 'recYds') && prop.direction === 'over')
    if (team) pushParlay(parlays, used, `${team.abbr} passing game`, [score, catcher])
  }
  if (parlays.length < 2) {
    const leftovers = props.filter(prop => !used.has(prop.id))
    const second = leftovers.slice(1).find(prop => prop.playerId !== leftovers[0]?.playerId)
    if (second) pushParlay(parlays, used, 'Script pair', [leftovers[0], second])
  }
  return parlays.slice(0, 3)
}

export function buildGameScript({ matchup, players = [], selection = emptyScript(), halfLife = 3, lines = [] } = {}) {
  const note = 'Model scenario estimate, not a guarantee.'
  const summary = scriptSummary(selection, matchup)
  if (!matchup?.away || !matchup?.home || !scriptActive(selection)) {
    return { active: false, summary, props: [], parlays: [], note }
  }
  const usable = players.filter(player => player && !player.unavailable && player.team?.id != null)
  const roles = rolesFor(usable, halfLife)
  const buckets = new Map()
  for (const effect of effectsFor(selection, matchup)) {
    const group = ranked(usable, effect.teamId, effect.positions, effect.rankBy, halfLife)
    group.forEach((row, index) => {
      const weight = index === 0 ? 1 : roleRatio(row.value, group[0].value)
      for (const [key, pct] of Object.entries(effect.keys)) {
        if (!pct) continue
        const id = `${row.player.id}:${key}`
        const bucket = buckets.get(id) || { player: row.player, key, parts: [], weight: 0 }
        bucket.parts.push({ pct: pct * weight, short: effect.short })
        bucket.weight = Math.max(bucket.weight, weight)
        buckets.set(id, bucket)
      }
    })
  }

  const props = []
  for (const bucket of buckets.values()) {
    const pct = combinePercents(bucket.parts)
    if (Math.abs(pct) < MIN_MOVE) continue
    const stat = readStat(bucket.player, bucket.key, halfLife)
    if (!stat) continue
    const scenario = roundStat(stat.projection * (1 + pct), bucket.key)
    if (formatStat(stat.projection, bucket.key) === formatStat(scenario, bucket.key)) continue
    const book = lineFor(lines, bucket.player, bucket.key)
    const role = roles.get(bucket.player.id) || roleName(bucket.player.position, 0)
    const fit = scriptFit({
      pct, roleWeight: bucket.weight, sample: stat.sample,
      defenseAdjusted: stat.defenseAdjusted, stale: bucket.player.stale,
    })
    props.push({
      id: `${bucket.player.team.id}:${bucket.player.id}:${bucket.key}`,
      kind: 'player',
      playerId: bucket.player.id,
      teamId: bucket.player.team.id,
      team: bucket.player.team,
      name: bucket.player.name,
      position: bucket.player.position,
      role,
      key: bucket.key,
      statLabel: STAT_LABEL[bucket.key],
      direction: directionFor(pct, scenario, book?.line ?? null),
      line: book?.line ?? null,
      lineSource: book?.source ?? null,
      baseline: stat.projection,
      scenario,
      pct,
      arrow: pct >= 0 ? 'up' : 'down',
      fit,
      fitLabel: fitLabel(fit),
      why: whyText({
        name: bucket.player.name, role, key: bucket.key, pct,
        baseline: stat.projection, scenario, parts: bucket.parts,
      }),
      sample: stat.sample,
    })
  }
  props.sort((a, b) => b.fit - a.fit || Math.abs(b.pct) - Math.abs(a.pct) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  const rankedProps = props.slice(0, 24)
  return {
    active: true,
    summary,
    props: rankedProps,
    parlays: buildParlays(rankedProps, selection, matchup),
    note,
  }
}
