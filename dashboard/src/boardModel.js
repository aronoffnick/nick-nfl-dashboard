import { applyTeamStarter } from './props/qbStarter.js'

const metrics = [
  ['passO', 'Pass offense', false],
  ['rushO', 'Rush offense', false],
  ['passD', 'Pass defense', true],
  ['rushD', 'Rush defense', true],
]

export function compute(data, halfLife, advantage, mode) {
  if (!data) return null
  const all = Object.values(data.teams).map(team => {
    const history = data.games.filter(g => g.away.id === team.id || g.home.id === team.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    const rows = history.map((g, i) => {
      const atHome = g.home.id === team.id
      const self = atHome ? g.home : g.away
      const opponent = atHome ? g.away : g.home
      const venue = g.neutral ? 0 : (atHome ? advantage / 2 : -advantage / 2)
      return {
        weight: 2 ** (-(history.length - 1 - i) / halfLife),
        passO: self.pass, rushO: self.rush, passD: opponent.pass, rushD: opponent.rush,
        pf: self.points - venue, pa: opponent.points + venue,
        rawPF: self.points, rawPA: opponent.points,
      }
    })
    const average = (key, weighted) => rows.reduce((s, r) => s + r[key] * (weighted ? r.weight : 1), 0) /
      rows.reduce((s, r) => s + (weighted ? r.weight : 1), 0)
    const season = Object.fromEntries(metrics.map(([k]) => [k, average(k, false)]))
    const recent = Object.fromEntries(metrics.map(([k]) => [k, average(k, true)]))
    return {
      ...team, season, recent, display: mode === 'recent' ? recent : season,
      pf: average('pf', true), pa: average('pa', true),
      ppg: average('rawPF', false), papg: average('rawPA', false), n: rows.length,
      wins: rows.filter(r => r.rawPF > r.rawPA).length,
      losses: rows.filter(r => r.rawPF < r.rawPA).length,
      ties: rows.filter(r => r.rawPF === r.rawPA).length, ranks: {},
    }
  })
  for (const [key, , lower] of metrics) {
    for (const t of all) {
      t.ranks[key] = 1 + all.filter(o => lower ? o.display[key] < t.display[key] : o.display[key] > t.display[key]).length
    }
  }
  const teams = Object.fromEntries(all.map(t => [t.id, t]))
  const pointMean = all.reduce((s, t) => s + t.pf, 0) / all.length
  const yardMean = all.reduce((s, t) => s + t.recent.passO + t.recent.rushO, 0) / all.length
  function expected(offense, defense) {
    const scoring = (offense.pf + defense.pa) / 2
    const yards = (offense.recent.passO + defense.recent.passD +
      offense.recent.rushO + defense.recent.rushD) / 2
    return .8 * scoring + .2 * (pointMean + .06 * (yards - yardMean))
  }
  const matchups = data.matchups.map(g => {
    const away = teams[g.away], home = teams[g.home]
    const awayScored = applyTeamStarter(away, data.week)
    const homeScored = applyTeamStarter(home, data.week)
    const hfa = g.neutral ? 0 : advantage
    const halfPoint = value => Math.round(value * 2) / 2
    const awayPoints = halfPoint(Math.max(0, expected(awayScored, home) - hfa / 2))
    const homePoints = halfPoint(Math.max(0, expected(homeScored, away) + hfa / 2))
    const signedMargin = homePoints - awayPoints
    return {
      ...g, away, home, awayPoints, homePoints,
      margin: halfPoint(Math.abs(signedMargin)),
      winner: signedMargin >= 0 ? home : away,
      qbOverride: awayScored.qbOverride || homeScored.qbOverride || null,
    }
  })
  return { teams: all, matchups }
}

/** The pick using only games already played before this kickoff. Defaults match the board. */
export function preKickoffPick(data, matchup) {
  const kick = Date.parse(matchup.date)
  const games = (data.games || []).filter(game => Date.parse(game.date) < kick)
  const away = matchup.away?.id || matchup.away
  const home = matchup.home?.id || matchup.home
  const result = compute({
    ...data,
    games,
    matchups: [{ id: matchup.id, date: matchup.date, away, home, neutral: matchup.neutral }],
  }, 3, 2, 'recent')
  const game = result?.matchups?.[0]
  if (!game?.winner) return null
  const tie = game.margin < 0.05
  return {
    winnerId: tie ? null : game.winner.id,
    winnerAbbr: tie ? null : game.winner.abbr,
    margin: game.margin,
    tie,
    source: 'pre-kickoff',
  }
}

export function boardSnapshot(game) {
  const tie = game.margin < 0.05
  return {
    winnerId: tie ? null : game.winner?.id,
    winnerAbbr: tie ? null : game.winner?.abbr,
    margin: game.margin,
    tie,
    source: 'board',
    savedAt: new Date().toISOString(),
  }
}

export function gradePick(pick, final) {
  if (!final) return null
  if (!pick || pick.tie || pick.winnerId == null) return '–'
  const awayPoints = final.away.points
  const homePoints = final.home.points
  if (awayPoints === homePoints) return '–'
  const winnerId = awayPoints > homePoints ? final.away.id : final.home.id
  return String(winnerId) === String(pick.winnerId) ? 'W' : 'L'
}

export function usableSnapshot(saved, game) {
  if (!saved) return null
  if (saved.source === 'board' && Date.parse(saved.savedAt) >= Date.parse(game.date)) return null
  return saved
}
