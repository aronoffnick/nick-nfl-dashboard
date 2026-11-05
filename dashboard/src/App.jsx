import { useEffect, useMemo, useState } from 'react'
import './App.css'

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
const kickoff = d => new Date(d).toLocaleString('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short',
  day: 'numeric', hour: 'numeric', minute: '2-digit',
})

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
  if (cacheKey) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data: payload }))
    } catch {}
  }
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
  const schedule = await get('scoreboard?limit=100')
  YEAR = Number(schedule.season?.year)
  WEEK = Number(schedule.week?.number)
  if (Number(schedule.season?.type) !== 2 ||
      !Number.isInteger(YEAR) ||
      !Number.isInteger(WEEK) ||
      WEEK < 1 || WEEK > 18 ||
      !schedule.events?.length) {
    throw new Error('ESPN is not currently returning an active regular-season week. This model supports regular-season games only.')
  }
  if (WEEK === 1) {
    throw new Error('Week 1 has no prior games in this season. Predictions will begin once Week 1 is complete and ESPN advances to Week 2.')
  }
  progress(`Loading ${YEAR} Week ${WEEK}…`)
  const firstKickoff = Math.min(...schedule.events.map(e => +new Date(e.date)))
  const events = new Map()
  for (let week = 1; week < WEEK; week++) {
    progress(`Loading completed games: week ${week} of ${WEEK - 1}…`)
    const board = await get(`scoreboard?dates=${YEAR}&seasontype=2&week=${week}&limit=100`)
    if (Number(board.season?.year) !== YEAR || Number(board.week?.number) !== week) {
      throw new Error(`Historical schedule validation failed for week ${week}.`)
    }
    for (const e of board.events || []) {
      const { c } = competition(e)
      if (c.status?.type?.completed && +new Date(e.date) < firstKickoff) events.set(e.id, e)
    }
  }
  if (!events.size) throw new Error('No completed prior games were returned.')
  const teams = {}
  const games = []
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
        }
      })
      return { id: event.id, date: event.date, neutral: Boolean(c.neutralSite), away: sides[0], home: sides[1] }
    }))
    for (const g of batch) {
      games.push(g)
      for (const side of [g.away, g.home]) teams[side.id] = side
    }
  }
  if (Object.keys(teams).length !== 32) throw new Error('Validation failed: historical data must include all 32 NFL teams.')
  const matchups = schedule.events.map(e => {
    const { c, away, home } = competition(e)
    if (!teams[String(away.team.id)] || !teams[String(home.team.id)]) throw new Error('A matchup team is missing historical data.')
    return {
      id: e.id, date: e.date, away: String(away.team.id), home: String(home.team.id),
      neutral: Boolean(c.neutralSite), status: c.status?.type?.description || 'Scheduled',
      source: e.links?.find(l => l.href)?.href || 'https://www.espn.com/nfl/scoreboard',
    }
  })
  const data = {
    year: YEAR, week: WEEK,
    teams, games, matchups, updated: new Date().toISOString(),
    cutoff: new Date(firstKickoff).toISOString(),
  }
  // Schedule is fetched fresh; completed box scores are cached for 24 hours.
  return data
}

function compute(data, halfLife, advantage, mode) {
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
    const hfa = g.neutral ? 0 : advantage
    const awayPoints = Math.max(0, expected(away, home) - hfa / 2)
    const homePoints = Math.max(0, expected(home, away) + hfa / 2)
    const signedMargin = homePoints - awayPoints
    return {
      ...g, away, home, awayPoints, homePoints,
      margin: Math.abs(signedMargin),
      winner: signedMargin >= 0 ? home : away,
    }
  })
  return { teams: all, matchups }
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
  const days = [...new Set((data?.matchups || []).map(g => g.date.slice(0, 10)))].sort()
  function changeSort(key) {
    setSort(s => ({ key, ascending: s.key === key ? !s.ascending : true }))
  }
  const rows = useMemo(() => {
    if (!result) return []
    const q = query.toLowerCase()
    const source = view === 'matchups' ? result.matchups.filter(g =>
      `${g.away.name} ${g.home.name} ${g.away.abbr} ${g.home.abbr}`.toLowerCase().includes(q) &&
      (day === 'all' || g.date.slice(0, 10) === day)
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
      const av = value(a), bv = value(b)
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * (sort.ascending ? 1 : -1)
    })
  }, [result, query, day, view, sort])

  function header(label, key) {
    return <button className="sort" onClick={() => changeSort(key)}>{label} {sort.key === key ? (sort.ascending ? '↑' : '↓') : '↕'}</button>
  }
  const detail = result?.matchups.find(g => g.id === selected)

  return <main>
    <header className="masthead"><div className="brand">NA<span> / NFL LAB</span></div><span className="edition">{data ? `${data.year} · WEEK ${String(data.week).padStart(2, '0')}` : 'CURRENT NFL WEEK'}</span></header>
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
    {busy && <p role="status" className="notice">{message} First load may take a few minutes.</p>}
    {error && <div role="alert" className="error"><strong>Data could not be validated.</strong><p>{error}</p><button onClick={refresh}>Retry data load</button></div>}
    <section className="controls">
      <div className="tabs">
        <button className={view === 'matchups' ? 'active' : ''} onClick={() => { setView('matchups'); setSort({ key: 'date', ascending: true }) }}>Matchups</button>
        <button className={view === 'teams' ? 'active' : ''} onClick={() => { setView('teams'); setSort({ key: 'passO', ascending: true }) }}>32-team rankings</button>
      </div>
      <label>Find a team<input placeholder="Giants, Jets, Chiefs…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {view === 'matchups' && <label>Game day<select value={day} onChange={e => setDay(e.target.value)}><option value="all">All days</option>{days.map(d => <option key={d} value={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</option>)}</select></label>}
      <label>Statistics<select value={mode} onChange={e => setMode(e.target.value)}><option value="season">Season averages</option><option value="recent">Recent weighted averages</option></select></label>
      <button disabled={busy} onClick={refresh}>{busy ? 'Loading…' : 'Refresh data'}</button>
    </section>
    <div className="table-note">Yards per game · #1 = most yards on offense / fewest allowed on defense · click column headings to sort</div>
    {result && <div className="table-wrap"><table>
      <thead>{view === 'matchups' ? <tr>
        <th>{header('Away pass D', 'away.passD')}</th><th>{header('Away rush D', 'away.rushD')}</th>
        <th>{header('Away team', 'name')}</th><th>{header('Kickoff ET', 'date')}</th><th>Home team</th>
        <th>{header('Home pass D', 'home.passD')}</th><th>{header('Home rush D', 'home.rushD')}</th>
        <th>{header('Away pass O', 'away.passO')}</th><th>{header('Away rush O', 'away.rushO')}</th>
        <th>{header('Home pass O', 'home.passO')}</th><th>{header('Home rush O', 'home.rushO')}</th>
        <th>{header('Model pick / margin', 'margin')}</th>
      </tr> : <tr><th>{header('Team', 'name')}</th>{metrics.map(([k, name]) => <th key={k}>{header(name, k)}</th>)}<th>Points / game</th><th>Allowed / game</th></tr>}</thead>
      <tbody>{rows.map(row => view === 'matchups' ? <tr key={row.id}>
        {['passD', 'rushD'].map(k => <td key={k}><Rank value={row.away.ranks[k]} /><small>{fmt(row.away.display[k])} yd</small></td>)}
        <td><Team team={row.away} /></td>
        <td className="date">{kickoff(row.date)}<small>{row.neutral ? 'Neutral site' : row.status}</small></td>
        <td><Team team={row.home} /></td>
        {['passD', 'rushD'].map(k => <td key={k}><Rank value={row.home.ranks[k]} /><small>{fmt(row.home.display[k])} yd</small></td>)}
        {[['away', 'passO'], ['away', 'rushO'], ['home', 'passO'], ['home', 'rushO']].map(([s, k]) => <td key={s + k}><Rank value={row[s].ranks[k]} /><small>{fmt(row[s].display[k])} yd</small></td>)}
        <td><button className="pick" onClick={() => setSelected(row.id)}>{row.margin < .05 ? 'Toss-up' : `${row.winner.abbr} by ${fmt(row.margin)}`}<small>Explore matchup →</small></button></td>
      </tr> : <tr key={row.id}><td><Team team={row} /></td>{metrics.map(([k]) => <td key={k}><Rank value={row.ranks[k]} /><small>{fmt(row.display[k])} yd</small></td>)}<td>{fmt(row.ppg)}</td><td>{fmt(row.papg)}</td></tr>)}</tbody>
    </table>{!rows.length && <p className="notice">No teams or games match these filters.</p>}</div>}
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
    <footer><strong>Sources & validation</strong><p>Schedule, scores and team box scores: <a href="https://www.espn.com/nfl/scoreboard" target="_blank" rel="noreferrer">ESPN</a>, fetched through its public Site API. Passing = net passing yards, including sack losses. Defense = the opponent's yards. Rankings cover all 32 teams, with equal values sharing a rank.</p>
      <p>Only completed {data?.year || 'current-season'} regular-season games from earlier weeks, before the first kickoff of Week {data?.week || '—'}, enter the model. All required box scores and 32-team coverage must pass validation before results display.</p>
      <p>Last fetched: {data ? kickoff(data.updated) + ' ET' : 'Not yet loaded'} · Schedule and rankings refresh on opening and every 30 minutes while open. Completed box scores are cached for 24 hours. The current week follows ESPN's season/week designation; this is a pregame model and excludes the current week's results.</p>
    </footer>
    {detail && <div className="overlay" onClick={() => setSelected(null)}><section className="modal" role="dialog" aria-modal="true" aria-label="Matchup analysis" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelected(null) }}>
      <button autoFocus className="close" onClick={() => setSelected(null)}>Close ✕</button>
      <p className="eyebrow">{kickoff(detail.date)} ET {detail.neutral && '· NEUTRAL SITE'}</p>
      <h2>{detail.away.name}<br /><span className="muted">at</span> {detail.home.name}</h2>
      <div className="score"><span>{detail.away.abbr}<strong>{fmt(detail.awayPoints)}</strong></span><span>{detail.home.abbr}<strong>{fmt(detail.homePoints)}</strong></span></div>
      <h3>{detail.margin < .05 ? 'Model toss-up' : `${detail.winner.name} by ${fmt(detail.margin)}`}</h3>
      <p>Weighted matchup estimates, yards per game:</p>
      <div className="table-wrap"><table><thead><tr><th>Offense vs defense</th><th>Pass yards</th><th>Rush yards</th></tr></thead><tbody>
        <tr><td>{detail.away.abbr} offense vs {detail.home.abbr}</td><td>{fmt((detail.away.recent.passO + detail.home.recent.passD) / 2)}</td><td>{fmt((detail.away.recent.rushO + detail.home.recent.rushD) / 2)}</td></tr>
        <tr><td>{detail.home.abbr} offense vs {detail.away.abbr}</td><td>{fmt((detail.home.recent.passO + detail.away.recent.passD) / 2)}</td><td>{fmt((detail.home.recent.rushO + detail.away.recent.rushD) / 2)}</td></tr>
      </tbody></table></div>
      <p className="muted">Uses {halfLife}-game half-life and {detail.neutral ? 'no' : `${advantage.toFixed(1)}-point`} home advantage. Review the methodology below the dashboard.</p>
      <a href={detail.source} target="_blank" rel="noreferrer">View ESPN game source ↗</a>
    </section></div>}
  </main>
}
