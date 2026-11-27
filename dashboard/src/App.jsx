import { useEffect, useMemo, useState } from 'react'
import './App.css'
import PickTracker from './PickTracker.jsx'
import WeeklyGames from './WeeklyGames.jsx'
import { bundledHistory, remember } from './data/historyFile.js'
import { fileForWeek } from './data/weekFiles.js'
import { boardSnapshot, compute, gradePick, preKickoffPick, usableSnapshot } from './boardModel.js'
import { compareValue, gradeDisplayedPick, gradeValuePick, mergeOdds, resultClass, scoreMatchups } from './matchupValue.js'
import { ValueBadge, ValueHelp } from './MatchupValue.jsx'
import TeamParlay from './TeamParlay.jsx'
import PositionRankings from './PositionRankings.jsx'
import AccuracyNote from './props/AccuracyNote.jsx'
import MatchupExplorer from './props/MatchupExplorer.jsx'
import { parsePlayers } from './props/model.js'

let YEAR
let WEEK
const API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
const SUMMARY_CACHE = 'nick-nfl-boxscore-v1-'
const metrics = [
  ['passO', 'Pass offense', false],
  ['rushO', 'Rush offense', false],
  ['passD', 'Pass defense', true],
  ['rushD', 'Rush defense', true],
]
const num = x => Number(String(x).replaceAll(',', ''))
const fmt = x => Number.isFinite(x) ? x.toFixed(1) : '—'
const easternDay = d => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(d))
  return ['year', 'month', 'day']
    .map(key => parts.find(p => p.type === key).value).join('-')
}
const kickoff = d => new Date(d).toLocaleString('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short',
  day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const kickoffHeading = d => {
  const when = new Date(d)
  const day = when.toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  })
  const time = when.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).replace(':00', '')
  return `${day}, ${time}`
}
function matchupStatus(row) {
  if (row.final) return null
  if (row.started) return 'In progress'
  const text = String(row.status || '')
  if (/delay|postpon|suspend|cancel/i.test(text)) return text
  return row.neutral ? 'Scheduled · Neutral site' : 'Scheduled'
}

async function get(path) {
  const cacheKey = path.startsWith('summary?') ? SUMMARY_CACHE + path : null
  if (cacheKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey))
      if (saved && Date.now() - saved.time < 86400000) return saved.data
    } catch {}
  }
  const res = await fetch(`${API}/${path}`, {
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`ESPN returned HTTP ${res.status}. Try Refresh data.`)
  const payload = await res.json()
  if (cacheKey) remember(cacheKey, JSON.stringify({ time: Date.now(), data: payload }))
  return payload
}

function competition(event) {
  const c = event.competitions?.[0]
  if (!c || c.competitors?.length !== 2) throw new Error('Incomplete matchup data.')
  const away = c.competitors.find(t => t.homeAway === 'away')
  const home = c.competitors.find(t => t.homeAway === 'home')
  if (!away || !home) throw new Error('Missing home/away designation.')
  return { c, away, home }
}

async function loadData(progress) {
  progress('Finding the current NFL week…')
  let schedule = await get('scoreboard?limit=100')
  YEAR = Number(schedule.season?.year)
  WEEK = Number(schedule.week?.number)
  if (Number(schedule.season?.type) !== 2 ||
      !Number.isInteger(YEAR) ||
      !Number.isInteger(WEEK) ||
      WEEK < 1 || WEEK > 18 ||
      !schedule.events?.length) {
    throw new Error('ESPN is not currently returning an active regular-season week. This model supports regular-season games only.')
  }
  const currentWeekComplete = schedule.events.every(event => {
    try { return Boolean(competition(event).c.status?.type?.completed) }
    catch { return false }
  })
  if (currentWeekComplete && WEEK < 18) {
    progress(`Week ${WEEK} is complete. Checking Week ${WEEK + 1}…`)
    const nextWeek = await get(`scoreboard?dates=${YEAR}&seasontype=2&week=${WEEK + 1}&limit=100`)
    if (Number(nextWeek.season?.year) === YEAR &&
        Number(nextWeek.season?.type) === 2 &&
        Number(nextWeek.week?.number) === WEEK + 1 &&
        nextWeek.events?.length) {
      schedule = nextWeek
      WEEK += 1
    }
  }
  if (WEEK === 1) {
    throw new Error('Week 1 has no prior games in this season. Predictions will begin once Week 1 is complete and ESPN advances to Week 2.')
  }
  progress(`Loading ${YEAR} Week ${WEEK}…`)
  const firstKickoff = Math.min(...schedule.events.map(e => +new Date(e.date)))
  const history = bundledHistory(YEAR)
  const teams = {}
  const games = []
  const historicalWeeks = []
  if (history?.games?.length) {
    progress(`Using saved weeks 1–${history.throughWeek}…`)
    for (const game of history.games) {
      if (game.week >= WEEK || Date.parse(game.date) >= firstKickoff) continue
      games.push(game)
      for (const side of [game.away, game.home]) teams[side.id] = side
    }
    const byWeek = new Map()
    for (const game of games) {
      const bucket = byWeek.get(game.week) || []
      bucket.push({ id: game.id, date: game.date })
      byWeek.set(game.week, bucket)
    }
    for (const [week, events] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
      historicalWeeks.push({ week, events })
    }
  } else {
    const events = new Map()
    for (let week = 1; week < WEEK; week++) {
      progress(`Loading completed games: week ${week} of ${WEEK - 1}…`)
      const board = await get(`scoreboard?dates=${YEAR}&seasontype=2&week=${week}&limit=100`)
      if (Number(board.season?.year) !== YEAR || Number(board.week?.number) !== week) {
        throw new Error(`Historical schedule validation failed for week ${week}.`)
      }
      historicalWeeks.push({ week, events: board.events || [] })
      for (const e of board.events || []) {
        const { c } = competition(e)
        if (c.status?.type?.completed && +new Date(e.date) < firstKickoff) events.set(e.id, e)
      }
    }
    if (!events.size) throw new Error('No completed prior games were returned.')
    const list = [...events.values()].sort((a, b) => new Date(a.date) - new Date(b.date))
    for (let offset = 0; offset < list.length; offset += 4) {
      progress(`Reading box scores ${offset + 1}–${Math.min(offset + 4, list.length)} of ${list.length}…`)
      const batch = await Promise.all(list.slice(offset, offset + 4).map(async event => {
        const detail = await get(`summary?event=${event.id}`)
        const { c, away, home } = competition(event)
        const sides = [away, home].map(side => {
          const box = detail.boxscore?.teams?.find(t => String(t.team.id) === String(side.team.id))
          const stat = key => {
            const item = box?.statistics?.find(s => s.name === key)
            return item ? num(item.displayValue) : NaN
          }
          const passing = stat('netPassingYards')
          const rushing = stat('rushingYards')
          const points = num(side.score)
          if (![passing, rushing, points].every(Number.isFinite)) {
            throw new Error(`Missing net passing/rushing yards or score for ${event.name}. No partial rankings were generated.`)
          }
          return {
            id: String(side.team.id), name: side.team.displayName,
            abbr: side.team.abbreviation, logo: side.team.logo,
            pass: passing, rush: rushing, points,
            playerBox: parsePlayers(detail, String(side.team.id)),
          }
        })
        return { id: event.id, date: event.date, neutral: Boolean(c.neutralSite), away: sides[0], home: sides[1] }
      }))
      for (const g of batch) {
        games.push(g)
        for (const side of [g.away, g.home]) teams[side.id] = side
      }
    }
  }
  if (!games.length) throw new Error('No completed prior games were returned.')
  if (Object.keys(teams).length !== 32) throw new Error('Validation failed: historical data must include all 32 NFL teams.')
  const matchups = schedule.events.map(e => {
    const { c, away, home } = competition(e)
    if (!teams[String(away.team.id)] || !teams[String(home.team.id)]) throw new Error('A matchup team is missing historical data.')
    return {
      id: e.id, date: e.date, away: String(away.team.id), home: String(home.team.id),
      started: c.status?.type?.state !== 'pre',
      final: c.status?.type?.name === 'STATUS_FINAL' && away.score != null && home.score != null ? {
        away: { id: String(away.team.id), points: num(away.score) },
        home: { id: String(home.team.id), points: num(home.score) },
      } : null,
      neutral: Boolean(c.neutralSite), status: c.status?.type?.description || 'Scheduled',
      source: e.links?.find(l => l.href)?.href || 'https://www.espn.com/nfl/scoreboard',
    }
  })
  const data = {
    year: YEAR, week: WEEK,
    teams, games, matchups, historicalWeeks, updated: new Date().toISOString(),
    cutoff: new Date(firstKickoff).toISOString(),
  }
  // Schedule is fetched fresh; completed box scores are cached for 24 hours.
  return data
}

function backtest(data) {
  if (!data) return []
  const finals = new Map(data.games.map(game => [game.id, game]))
  return data.historicalWeeks.flatMap(({ week, events }) => {
    const cutoff = Math.min(...events.map(event => Date.parse(event.date)))
    const games = data.games.filter(game => Date.parse(game.date) + 8 * 3600_000 < cutoff)
    if (games.length === 0) return []
    const matchups = events.flatMap(event => {
      const final = finals.get(event.id)
      if (!final) return []
      return [{ ...final, away: final.away.id, home: final.home.id }]
    })
    const estimates = compute({ ...data, games, matchups }, 3, 2, 'season')
    return estimates.matchups.filter(game => Number.isFinite(game.margin)).map(game => {
      const final = finals.get(game.id)
      const { away, home } = final
      const winner = away.points > home.points ? away : home
      const actualPickedMargin = game.winner.id === away.id ? away.points - home.points : home.points - away.points
      return [game.id, {
        week: `${data.year} Week ${week}`, date: game.date, team: game.winner.abbr,
        matchup: `${game.away.abbr} @ ${game.home.abbr}`, odds: '', backtested: true, margin: game.margin,
        teams: `${game.away.name} ${game.home.name}`,
        result: away.points === home.points ? 'Push' : winner.id === game.winner.id ? 'Win' : 'Loss',
        finalScore: `${game.away.abbr} ${away.points}–${game.home.abbr} ${home.points}`,
        marginResult: actualPickedMargin === game.margin ? 'Push' : actualPickedMargin > game.margin ? 'Covered' : 'Missed',
      }]
    })
  })
}

function Team({ team }) {
  return <span className="team">{team.logo && <img src={team.logo} alt="" />}<span>{team.name}<small>{team.wins}–{team.losses}{team.ties ? `–${team.ties}` : ''} · {team.n} games</small></span></span>
}
function Rank({ value }) {
  return <span className={`rank ${value <= 10 ? 'good' : value >= 23 ? 'weak' : ''}`}>#{value}</span>
}

export default function App() {
  const [data, setData] = useState(null)
  const [message, setMessage] = useState('Preparing data…')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [query, setQuery] = useState('')
  const [day, setDay] = useState('all')
  const [mode, setMode] = useState('season')
  const [halfLife, setHalfLife] = useState(3)
  const [advantage, setAdvantage] = useState(2)
  const [view, setView] = useState('matchups')
  const [sort, setSort] = useState({ key: 'date', ascending: true })
  const [selected, setSelected] = useState(null)
  const [props, setProps] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nfl-tracked-props-v1')) || {} }
    catch { return {} }
  })
  function saveProp(key, record) {
    const next = { ...props, [key]: record }
    remember('nfl-tracked-props-v1', JSON.stringify(next))
    setProps(next)
  }


  async function refresh() {
    setBusy(true); setError('')
    try { setData(await loadData(setMessage)) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let running = false
    async function update() {
      if (running) return
      running = true
      try { await refresh() }
      finally { running = false }
    }
    update()
    const timer = setInterval(update, 30 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const result = useMemo(() => compute(data, halfLife, advantage, mode), [data, halfLife, advantage, mode])
  const [snapshots, setSnapshots] = useState({})
  useEffect(() => {
    if (!result || !data) return
    const key = 'nick-nfl-board-picks-v1'
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch { saved = {} }
    let changed = false
    for (const game of result.matchups) {
      if (!game.started && !game.final) {
        const next = boardSnapshot(game)
        const prior = saved[game.id]
        if (!prior || prior.winnerId !== next.winnerId || prior.margin !== next.margin || prior.tie !== next.tie) {
          saved[game.id] = next
          changed = true
        }
      } else if (game.final && !usableSnapshot(saved[game.id], game)) {
        const pick = preKickoffPick(data, game)
        if (pick) {
          saved[game.id] = { ...pick, savedAt: new Date(Date.parse(game.date) - 1000).toISOString() }
          changed = true
        }
      }
    }
    if (changed) remember(key, JSON.stringify(saved))
    setSnapshots(saved)
  }, [result, data])
  const card = useMemo(() => {
    const marks = {}
    let wins = 0, losses = 0
    for (const game of result?.matchups || []) {
      const pick = usableSnapshot(snapshots[game.id], game) || (game.final ? preKickoffPick(data, game) : null)
      const mark = gradePick(pick, game.final)
      marks[game.id] = mark
      if (mark === 'W') wins += 1
      if (mark === 'L') losses += 1
    }
    return { marks, wins, losses }
  }, [result, data, snapshots])
  const historicalPicks = useMemo(() => backtest(data), [data])
  const trackedPicks = useMemo(() => compute(data, 3, 2, 'season')?.matchups, [data])
  const days = [...new Set((data?.matchups || []).map(g => easternDay(g.date)))].sort()
  const values = useMemo(() => {
    const week = data?.week
    if (week == null) return scoreMatchups(result?.matchups || [], null)
    const teamOdds = fileForWeek('teamOdds', week)
    const parlays = fileForWeek('parlays', week)
    return scoreMatchups(
      result?.matchups || [],
      mergeOdds(teamOdds.matched ? teamOdds.data : null, parlays.matched ? parlays.data : null),
    )
  }, [result, data])
  function changeSort(key) {
    setSort(s => ({ key, ascending: s.key === key ? !s.ascending : key !== 'value' }))
  }
  const rows = useMemo(() => {
    if (!result) return []
    const q = query.toLowerCase()
    const source = view === 'matchups' ? result.matchups.filter(g =>
      `${g.away.name} ${g.home.name} ${g.away.abbr} ${g.home.abbr}`.toLowerCase().includes(q) &&
      (day === 'all' || easternDay(g.date) === day)
    ) : result.teams.filter(t => `${t.name} ${t.abbr}`.toLowerCase().includes(q))
    function value(row) {
      if (sort.key === 'date') return row.date || row.name
      if (sort.key === 'name') return row.name || row.away.name
      if (sort.key === 'margin') return row.margin || 0
      if (sort.key.includes('.')) {
        const [side, key] = sort.key.split('.')
        return row[side]?.ranks[key] || 0
      }
      return row.ranks?.[sort.key] || 0
    }
    return [...source].sort((a, b) => {
      if (sort.key === 'value') return compareValue(values.byId[a.id], values.byId[b.id], sort.ascending)
      const av = value(a), bv = value(b)
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * (sort.ascending ? 1 : -1)
    })
  }, [result, query, day, view, sort, values])

  function header(label, key) {
    return <button className="sort" onClick={() => changeSort(key)}>{label} {sort.key === key ? (sort.ascending ? '↑' : '↓') : '↕'}</button>
  }
  const detail = result?.matchups.find(g => g.id === selected)

  return <main>
    <header className="masthead"><div className="brand">NA<span> / NFL LAB</span></div><span className="edition">{data ? `${data.year} · WEEK ${String(data.week).padStart(2, '0')}` : 'CURRENT NFL WEEK'}</span></header>
    {busy && <p role="status" className="notice">{message} First load may take a few minutes.</p>}
    {error && <div role="alert" className="error"><strong>Data could not be validated.</strong><p>{error}</p><button onClick={refresh}>Retry data load</button></div>}
    <section className="hero">
      <div><p className="eyebrow">NICK'S MATCHUP DASHBOARD</p><h1>Find the edge.<br /><span>Know the matchup.</span></h1>
      <p>{data ? `${data.year} regular season · Week ${data.week}` : 'Finding the current week…'} · All kickoff times Eastern</p></div>
      <div className="hero-card"><small>INDEPENDENT MODEL</small><strong>Recent form.<br />Both sides of the ball.</strong><p>Exponential weighting + venue adjustment.<br />No sportsbook lines used.</p></div>
    </section>
    <section className="summary">
      <div><strong>{data?.matchups.length ?? '—'}</strong><span>{data ? `Week ${data.week} matchups` : 'Current matchups'}</span></div>
      <div><strong>{data?.games.length ?? '—'}</strong><span>Prior games analyzed</span></div>
      <div><strong>{halfLife} games</strong><span>Weight half-life</span></div>
      <div><strong>+{advantage.toFixed(1)} pts</strong><span>Home advantage · neutral = 0</span></div>
    </section>
    {result && <TeamParlay matchups={result.matchups} week={data.week} />}
    <AccuracyNote />
    <section className="controls">
      <div className="tabs">
        <button className={view === 'matchups' ? 'active' : ''} onClick={() => { setView('matchups'); setSort({ key: 'date', ascending: true }) }}>Matchups</button>
        <button className={view === 'teams' ? 'active' : ''} onClick={() => { setView('teams'); setSort({ key: 'passO', ascending: true }) }}>Team Rankings</button>
        <button className={view === 'positions' ? 'active' : ''} onClick={() => setView('positions')}>Position Rankings</button>
      </div>
      <label>{view === 'positions' ? 'Find a player' : 'Find a team'}<input placeholder={view === 'positions' ? 'Name or team…' : 'Giants, Jets, Chiefs…'} value={query} onChange={e => setQuery(e.target.value)} /></label>
      {view === 'matchups' && <label>Game day<select value={day} onChange={e => setDay(e.target.value)}><option value="all">All days</option>{days.map(d => <option key={d} value={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</option>)}</select></label>}
      {view === 'matchups' && <label>Order<select value={sort.key === 'value' ? 'value' : 'kickoff'} onChange={e => setSort(e.target.value === 'value' ? { key: 'value', ascending: false } : { key: 'date', ascending: true })}><option value="kickoff">Kickoff</option><option value="value">Best value first</option></select></label>}
      {view !== 'positions' && <label>Statistics<select value={mode} onChange={e => setMode(e.target.value)}><option value="season">Season averages</option><option value="recent">Recent weighted averages</option></select></label>}
      <button disabled={busy} onClick={refresh}>{busy ? 'Loading…' : 'Refresh data'}</button>
    </section>
    {view === 'positions'
      ? <PositionRankings week={data?.week} query={query} />
      : <>
    <div className="table-note">Yards per game · #1 = most yards on offense / fewest allowed on defense · click column headings to sort{result ? ` · Pre-kickoff card ${card.wins}–${card.losses}` : ''}
      {view === 'matchups' && result && <ValueHelp meta={values.meta} matchups={result.matchups} byId={values.byId} />}
    </div>
    {result && <div className="table-wrap"><table>
      <thead>{view === 'matchups' ? <tr>
        <th>{header('Away pass O', 'away.passO')}</th><th>{header('Away rush O', 'away.rushO')}</th>
        <th>{header('Away pass D', 'away.passD')}</th><th>{header('Away rush D', 'away.rushD')}</th>
        <th>{header('Away team', 'name')}</th><th>{header('Kickoff ET', 'date')}</th><th>Home team</th>
        <th>{header('Home pass D', 'home.passD')}</th><th>{header('Home rush D', 'home.rushD')}</th>
        <th>{header('Home pass O', 'home.passO')}</th><th>{header('Home rush O', 'home.rushO')}</th>
        <th>{header('Model pick / margin', 'margin')}</th>
        <th>Explore</th>
        <th>{header('Best value', 'value')}</th>
      </tr> : <tr><th>{header('Team', 'name')}</th>{metrics.map(([k, name]) => <th key={k}>{header(name, k)}</th>)}<th>Points / game</th><th>Allowed / game</th></tr>}</thead>
      <tbody>{rows.map(row => {
        if (view !== 'matchups') return <tr key={row.id}><td><Team team={row} /></td>{metrics.map(([k]) => <td key={k}><Rank value={row.ranks[k]} /><small>{fmt(row.display[k])} yd</small></td>)}<td>{fmt(row.ppg)}</td><td>{fmt(row.papg)}</td></tr>
        const pickClass = resultClass(gradeDisplayedPick(row))
        const value = values.byId[row.id]
        const valueClass = resultClass(gradeValuePick(value, row))
        return <tr key={row.id}>
        {['passO', 'rushO'].map(k => <td key={k}><Rank value={row.away.ranks[k]} /><small>{fmt(row.away.display[k])} yd</small></td>)}
        {['passD', 'rushD'].map(k => <td key={k}><Rank value={row.away.ranks[k]} /><small>{fmt(row.away.display[k])} yd</small></td>)}
        <td><Team team={row.away} /></td>
        <td className="date"><span className="kickoff-time">{kickoffHeading(row.date)}</span>{row.final ? <span className="final-score-line">{row.away.abbr} {row.final.away.points} – {row.home.abbr} {row.final.home.points}</span> : <small>{matchupStatus(row)}</small>}</td>
        <td><Team team={row.home} /></td>
        {['passD', 'rushD'].map(k => <td key={k}><Rank value={row.home.ranks[k]} /><small>{fmt(row.home.display[k])} yd</small></td>)}
        {['passO', 'rushO'].map(k => <td key={k}><Rank value={row.home.ranks[k]} /><small>{fmt(row.home.display[k])} yd</small></td>)}
        <td className={pickClass}><span className={`pick-readout ${pickClass}`}>{row.margin < .05 ? 'Toss-up' : `${row.winner.abbr} by ${fmt(row.margin)}`}</span></td>
        <td className={pickClass}><button type="button" className={`pick ${pickClass}`} onClick={() => setSelected(row.id)}>Explore matchup</button></td>
        <td className={`value-cell ${valueClass}`}><ValueBadge value={value} game={row} /></td>
      </tr>})}</tbody>
    </table>{!rows.length && <p className="notice">No teams or games match these filters.</p>}</div>}
    </>}
    <section className="method">
      <div><p className="eyebrow">MODEL SETTINGS</p><h2>Recent games count more.</h2>
        <label>Weight half-life: {halfLife} games<input type="range" min="1" max="6" step=".5" value={halfLife} onChange={e => setHalfLife(Number(e.target.value))} /></label>
        <label>Home advantage: {advantage.toFixed(1)} points<input type="range" min="0" max="4" step=".5" value={advantage} onChange={e => setAdvantage(Number(e.target.value))} /></label>
      </div>
      <div><h3>How predictions work</h3>
        <p>Each game's weight is 2^(−games ago / half-life), normalized across available games. At a three-game half-life, a game three appearances ago counts half as much as the latest game. Byes do not count as games.</p>
        <p>We remove the configured venue advantage from historical scoring, blend each team's weighted points scored with its opponent's weighted points allowed (80%), and add a yardage-based scoring estimate (20%). The yardage estimate starts at league-average scoring and adds 0.06 points per expected yard above league average. Expected yards average the offense and opposing defense.</p>
        <p>The configured home advantage is split equally between projected scores; neutral games receive zero. Predictions always use weighted data, even when the table displays season averages.</p>
        <p className="muted">This is a transparent, uncalibrated heuristic, not a backtested betting model. No injury, starting-quarterback, weather, or opponent-strength adjustments. Decimal margins express model output, not certainty.</p>
      </div>
    </section>
    <details className="landing-more">
      <summary><span className="pick-chevron" aria-hidden="true" />Weekly favorites, picks, and sources</summary>
      {result&&<WeeklyGames matchups={result.matchups} onOpen={setSelected}/>}
      <PickTracker data={data} matchups={trackedPicks} historicalPicks={historicalPicks} props={props} saveProp={saveProp} />
      <footer><strong>Sources & validation</strong><p>Schedule, scores and team box scores: <a href="https://www.espn.com/nfl/scoreboard" target="_blank" rel="noreferrer">ESPN</a>, fetched through its public Site API. Passing = net passing yards, including sack losses. Defense = the opponent's yards. Rankings cover all 32 teams, with equal values sharing a rank.</p>
        <p>Only completed {data?.year || 'current-season'} regular-season games from earlier weeks, before the first kickoff of Week {data?.week || '—'}, enter the model. All required box scores and 32-team coverage must pass validation before results display.</p>
        <p>Last fetched: {data ? kickoff(data.updated) + ' ET' : 'Not yet loaded'} · Schedule and rankings refresh on opening and every 30 minutes while open. Completed box scores are cached for 24 hours. After every current-week game is final, the dashboard advances to ESPN's next valid schedule; this is a pregame model and excludes the displayed week's results.</p>
      </footer>
    </details>
    {detail && <MatchupExplorer key={detail.id} data={data} matchup={detail} saveProp={saveProp} halfLife={halfLife} advantage={advantage} onClose={() => setSelected(null)} />}
  </main>
}
