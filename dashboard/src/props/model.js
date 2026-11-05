export const METRICS = [
  ['passYds', 'Pass yd'], ['passTD', 'Pass TD'], ['rushYds', 'Rush yd'],
  ['rushTD', 'Rush TD'], ['rec', 'Rec'], ['recYds', 'Rec yd'], ['recTD', 'Rec TD'],
]
const FIELDS = {
  passing: { passingYards:'passYds', passingTouchdowns:'passTD' },
  rushing: { rushingYards:'rushYds', rushingTouchdowns:'rushTD', rushingAttempts:'carries' },
  receiving: { receptions:'rec', receivingYards:'recYds', receivingTouchdowns:'recTD', receivingTargets:'targets' },
}
export const VALUE_KEYS = [...METRICS.map(([k]) => k), 'carries', 'targets', 'passAtt']
export const GROUP = { passYds:'passing', passTD:'passing', passAtt:'passing', rushYds:'rushing', rushTD:'rushing', carries:'rushing', rec:'receiving', recYds:'receiving', recTD:'receiving', targets:'receiving' }
export const valid = x => typeof x === 'number' && Number.isFinite(x)
export const number = x => {
  if (x == null || String(x).trim() === '' || String(x).trim() === '--' || String(x).trim() === '-') return null
  const n = Number(String(x).replaceAll(',', ''))
  return Number.isFinite(n) ? n : null
}
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
export const weighted = (rows, key, halfLife) => {
  let sum = 0, total = 0
  rows.forEach((r, i) => {
    if (valid(r[key])) {
      const w = 2 ** (-(rows.length - 1 - i) / halfLife)
      sum += r[key] * w; total += w
    }
  })
  return total ? sum / total : null
}

// Missing categories stay null. A player appearing in a complete offensive category
// gets zero in the other complete categories, never a fabricated missing-data zero.
export function parsePlayers(detail, teamId) {
  const box = detail.boxscore?.players?.find(t => String(t.team?.id) === String(teamId))
  if (!box) return { players:[], available:[], error:'Player box score unavailable' }
  const categories = (box.statistics || []).filter(s => FIELDS[s.name])
  const available = categories.filter(s => Array.isArray(s.athletes) && s.athletes.length > 0 && Array.isArray(s.keys)).map(s => s.name)
  const all = new Map()
  for (const cat of categories) {
    for (const row of cat.athletes || []) {
      if (!row.athlete?.id || row.didNotPlay) continue
      const id = String(row.athlete.id)
      let p = all.get(id)
      if (!p) {
        p = { id, name:row.athlete.displayName, position:row.athlete.position?.abbreviation || null,
          source:row.athlete.links?.find(l => l.href)?.href,
          ...Object.fromEntries(VALUE_KEYS.map(k => [k, available.includes(GROUP[k]) ? 0 : null])) }
        all.set(id,p)
      }
      for (const [raw,key] of Object.entries(FIELDS[cat.name])) {
        const idx = cat.keys?.indexOf(raw) ?? -1
        p[key] = idx < 0 ? null : number(row.stats?.[idx])
      }
      if (cat.name === 'passing') {
        const idx = cat.keys?.indexOf('completions/passingAttempts') ?? -1
        p.passAtt = idx < 0 ? null : number(row.stats?.[idx]?.split('/')[1])
      }
    }
  }
  return { players:[...all.values()], available }
}

export function rosterPlayers(payload, teamId) {
  const groups = payload.athletes || []
  return groups.flatMap(group => group.items || (group.id ? [group] : [])).map(a => ({
    id:String(a.id), name:a.displayName, teamId:String(teamId), position:a.position?.abbreviation || '?',
    status:a.status?.name || 'Unknown',
    injury:(a.injuries || []).map(i => i.status || i.type?.description || '').filter(Boolean).join(', '),
    source:a.links?.find(l => l.href)?.href,
  }))
}

export const historyFor = (data, teamId) => data.games.filter(g => g.away.id === teamId || g.home.id === teamId)
  .sort((a,b) => new Date(a.date) - new Date(b.date))
export const sides = (g, id) => g.away.id === id ? [g.away,g.home] : [g.home,g.away]
export const positionOf = (p, roster) => p.position || roster[p.id]?.position || '?'

export function positionTotal(side, position, key, roster) {
  const box = side.playerBox
  if (!box || !box.available.includes(GROUP[key])) return null
  const relevant = box.players.filter(p => {
    // Unknown skill positions make positional totals incomplete; never guess WR/RB/TE.
    return (GROUP[key] === 'receiving' ? (p.targets || p.rec || p.recYds || p.recTD) :
      GROUP[key] === 'rushing' ? (p.carries || p.rushYds || p.rushTD) : (p.passAtt || p.passYds || p.passTD))
  })
  if (relevant.some(p => positionOf(p,roster) === '?')) return null
  const players = box.players.filter(p => positionOf(p,roster) === position)
  if (players.some(p => !valid(p[key]))) return null
  return players.reduce((sum,p) => sum + p[key],0)
}

export function defenseProfile(data, defenseId, position, key, roster, halfLife, window=4) {
  const games = historyFor(data, defenseId).slice(-window)
  const rows = games.map(g => {
    const [,opponent] = sides(g,defenseId)
    const allowed = positionTotal(opponent,position,key,roster)
    const baselineRows = historyFor(data,opponent.id).filter(other => other.id !== g.id)
      .map(other => ({ value:positionTotal(sides(other,opponent.id)[0],position,key,roster) }))
    const baseline = weighted(baselineRows,'value',halfLife)
    return { gameId:g.id, allowed, baseline }
  })
  const eligible = rows.filter(r => valid(r.allowed) && valid(r.baseline))
  const observed = weighted(eligible,'allowed',halfLife)
  const expected = weighted(eligible,'baseline',halfLife)
  const sample = eligible.length
  // Stabilize small positional samples and prevent extreme extrapolation.
  const factor = sample >= 3 && expected > 0
    ? clamp(1 + sample / (sample + 4) * (observed / expected - 1), .75, 1.25) : 1
  return { factor, sample, observed, expected,
    adjusted:sample >= 3 && expected > 0,
    allowed:weighted(rows.map(r => ({ value:r.allowed })),'value',halfLife),
    games:rows.filter(r => valid(r.allowed)).length,
  }
}

export function playerLogs(data, teamId, playerId) {
  return historyFor(data,teamId).flatMap(g => {
    const [self,opponent] = sides(g,teamId)
    const p = self.playerBox?.players.find(p => p.id === playerId)
    return p ? [{ ...p, gameId:g.id, date:g.date, opponent:opponent.abbr }] : []
  })
}

export function projectTeam(data, team, opponent, roster, halfLife, window=4) {
  const latestGames = historyFor(data,team.id).slice(-2)
  const recentIds = new Set(latestGames.flatMap(g => sides(g,team.id)[0].playerBox?.players.map(p=>p.id) || []))
  const eligible = Object.values(roster).filter(p => p.teamId === team.id && ['QB','RB','FB','WR','TE'].includes(p.position) && recentIds.has(p.id))
  const profiles = new Map()
  return eligible.map(player => {
    const logs = playerLogs(data,team.id,player.id)
    const stats = {}
    for (const [key] of METRICS) {
      const baseline = weighted(logs,key,halfLife)
      const profileKey = `${player.position}:${key}`
      if (!profiles.has(profileKey)) profiles.set(profileKey,defenseProfile(data,opponent.id,player.position,key,roster,halfLife,window))
      const defense = profiles.get(profileKey)
      const sample = logs.filter(l => valid(l[key])).length
      const values = logs.slice(-window).map(l=>l[key]).filter(valid)
      stats[key] = { baseline, projection:sample >= 3 && valid(baseline) ? Math.max(0,baseline*defense.factor) : null,
        sample, defense, min:values.length ? Math.min(...values):null, max:values.length ? Math.max(...values):null }
    }
    const unavailable = /inactive|injured|reserve|suspended|retired|out|doubtful/i.test(`${player.status} ${player.injury}`)
    return { ...player, logs, stats, unavailable,
      lastFour:logs.slice(-window), limited:logs.length < 3,
      stale:logs.at(-1)?.gameId !== latestGames.at(-1)?.id,
    }
  })
}

export function historicalComparison(data, teamId, player, key, gameId, halfLife) {
  const prior = playerLogs(data,teamId,player.id).filter(l => new Date(l.date) < new Date(data.games.find(g=>g.id===gameId)?.date))
  return prior.filter(l=>valid(l[key])).length >= 3 ? weighted(prior,key,halfLife) : null
}
