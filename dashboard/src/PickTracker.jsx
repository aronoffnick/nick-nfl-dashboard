import { useEffect, useState } from 'react'

const storageKey = 'nfl-moneyline-picks-v1'

function StatsBlock({ title, children }) {
  return <details className="pick-accuracy">
    <summary><span className="pick-chevron" aria-hidden="true" />{title}</summary>
    {children}
  </details>
}

export default function PickTracker({ data, matchups, historicalPicks, props, saveProp }) {
  const currentWeek = data ? `${data.year} Week ${data.week}` : ''
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {} }
    catch { return {} }
  })
  const [storageError, setStorageError] = useState(false)
  const [week, setWeek] = useState('')
  const [showProps, setShowProps] = useState(false)
  const [gradeError, setGradeError] = useState('')
  const [team, setTeam] = useState('')
  const [filter, setFilter] = useState('All results')

  useEffect(() => {
    if (!data || !matchups) return
    setRecords(previous => {
      const next = { ...previous }
      for (const game of matchups) {
        if (next[game.id] || game.started || Date.now() >= Date.parse(game.date)) continue
        next[game.id] = {
          week: currentWeek, date: game.date, team: game.winner.abbr, teamId: game.winner.id,
          matchup: `${game.away.abbr} @ ${game.home.abbr}`, result: 'Pending', odds: '', margin: game.margin,
          teams: `${game.away.name} ${game.home.name}`,
        }
      }
      const finals = [...data.games, ...data.matchups.filter(game => game.final)]
      for (const game of finals) {
        const record = next[game.id]
        if (!record || record.result !== 'Pending') continue
        const scores = game.final || game
        const { away, home } = scores
        if (!Number.isFinite(away.points) || !Number.isFinite(home.points)) continue
        const winner = away.points > home.points ? away : home
        next[game.id] = {
          ...record,
          result: away.points === home.points ? 'Push' : winner.id === record.teamId ? 'Win' : 'Loss',
          finalScore: `${away.abbr || game.away?.abbr || 'Away'} ${away.points}–${home.abbr || game.home?.abbr || 'Home'} ${home.points}`,
          marginResult: (() => {
            const actualPickedMargin = record.teamId === away.id ? away.points - home.points : home.points - away.points
            return actualPickedMargin === record.margin ? 'Push' : actualPickedMargin > record.margin ? 'Covered' : 'Missed'
          })(),
        }
      }
      return next
    })
  }, [data, matchups, currentWeek])

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(records)); setStorageError(false) }
    catch { setStorageError(true) }
  }, [records])

  const entries = Object.entries({ ...Object.fromEntries(historicalPicks), ...records })
  const weeks = [...new Set([currentWeek, ...entries.map(([, item]) => item.week), ...Object.values(props).map(item => item.week)].filter(Boolean))]
  const selectedWeek = week || currentWeek
  const weekly = entries.filter(([, item]) => (selectedWeek === 'All weeks' || item.week === selectedWeek) &&
    `${item.matchup} ${item.teams || ''}`.toLowerCase().includes(team.trim().toLowerCase()))
  const count = result => weekly.filter(([, item]) => item.result === result).length
  const rows = weekly.filter(([, item]) => filter === 'All results' || item.result === filter)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date))
  const marginBands = [
    ['All picks', () => true],
    ['Under 3 pts', margin => margin < 3],
    ['3 to under 7 pts', margin => margin >= 3 && margin < 7],
    ['7+ pts', margin => margin >= 7],
  ]
  const decided = weekly.filter(([, item]) => ['Win', 'Loss'].includes(item.result))

  const propRows = Object.entries(props).filter(([, item]) =>
    (selectedWeek === 'All weeks' || selectedWeek === item.week) &&
    `${item.team} ${item.teamName}`.toLowerCase().includes(team.trim().toLowerCase()))
  const teamNames = [...new Set(decided.map(([, item]) => item.team))].sort()

  function accuracy(label, sample) {
    const graded = sample.filter(item => ['Win', 'Loss'].includes(item.result))
    const hits = graded.filter(item => item.result === 'Win').length
    const percent = graded.length ? Math.round(100 * hits / graded.length) : null
    return <div className="pick-accuracy-row" key={label}>
      <span>{label}</span>
      {percent === null ? <span>No graded picks</span> : <>
        <progress aria-label={label + ' accuracy'} value={percent} max="100" />
        <span>{percent}% ({hits}/{graded.length})</span>
      </>}
    </div>
  }

  function saveOdds(event, id) {
    event.preventDefault()
    const input = event.currentTarget.elements.price
    const odds = input.value.trim()
    if (odds && (!/^[+-][1-9][0-9]+$/.test(odds) || Math.abs(Number(odds)) < 100)) {
      input.setCustomValidity('Enter American odds such as +120 or -135.')
      input.reportValidity()
      return
    }
    setRecords(previous => Date.now() < Date.parse(previous[id].date)
      ? { ...previous, [id]: { ...previous[id], odds, oddsRecordedAt: new Date().toISOString() } }
      : previous)
  }

  return <section>
    <h2>Weekly picks</h2>
    <div className="tabs">
      <button aria-pressed={!showProps} onClick={() => setShowProps(false)}>Game winners</button>
      <button aria-pressed={showProps} onClick={() => setShowProps(true)}>Player props</button>
    </div>
    <p>One moneyline pick per game. Open the dashboard before kickoff to save picks on this browser. Enter DraftKings prices before kickoff. Backtests use prior box scores and the default model settings. Week 1 has no same-season history.</p>
    <p><small>Audit note: generated Bets, SGP and FLYERS cards are live views and are not archived automatically. Only saved game picks and manually tracked player props persist in this browser.</small></p>
    {storageError && <p role="alert">This browser could not save the pick history.</p>}
    <div className="controls">
      <label>Week<select value={selectedWeek} onChange={event => setWeek(event.target.value)}>
        <option>All weeks</option>
        {weeks.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>Find a team<input value={team} onChange={event => setTeam(event.target.value)} placeholder="Ravens or BAL" /></label>
      <label>Result<select value={filter} onChange={event => setFilter(event.target.value)}>
        {['All results', 'Pending', 'Win', 'Loss', 'Push'].map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    {showProps ? <>
      <p>Save a pick from Player projections before kickoff. After the game, record its settlement here.</p>
      <StatsBlock key="player-prop-accuracy" title="Player prop accuracy">
        {accuracy('All player props', propRows.map(([, item]) => item))}
        {['QB', 'RB', 'FB', 'WR', 'TE'].map(position =>
          accuracy(position, propRows.map(([, item]) => item).filter(item => item.position === position)))}
      </StatsBlock>
      {gradeError && <p role="alert">{gradeError}</p>}
      <ul>{propRows.filter(([, item]) => filter === 'All results' || filter === item.result).map(([id, item]) =>
        <li key={id}>{item.player} ({item.team} {item.position}) · {item.pick} {item.line} {item.metric} · {item.week}
          {Date.now() >= Date.parse(item.date) ? <select aria-label={`Result for ${item.player} ${item.metric}`}
            value={item.result} onChange={event => {
              try { saveProp(id, { ...item, result: event.target.value }); setGradeError('') }
              catch { setGradeError('This browser could not save the result.') }
            }}>
            {['Pending', 'Win', 'Loss', 'Push'].map(result => <option key={result}>{result}</option>)}
          </select> : ' · Pending'}
        </li>)}</ul>
    </> : <>
    <p>{count('Win')} wins · {count('Loss')} losses · {count('Push')} pushes · {count('Pending')} pending</p>
    <StatsBlock key="winner-accuracy" title="Winner accuracy by projected margin">
      {marginBands.map(([label, includes]) => {
        const sample = decided.filter(([, item]) => includes(item.margin))
        const hits = sample.filter(([, item]) => item.result === 'Win').length
        const percent = sample.length ? Math.round(100 * hits / sample.length) : null
        return <div className="pick-accuracy-row" key={label}>
          <span>{label}</span>
          {percent === null ? <span>No graded picks</span> : <>
            <progress aria-label={label + ' winner accuracy'} value={percent} max="100" />
            <span>{percent}% ({hits}/{sample.length})</span>
          </>}
        </div>
      })}
      <small>Hits are correct outright winners. Pushes and pending games are excluded.</small>
    </StatsBlock>
    <StatsBlock key="team-accuracy" title="Accuracy by picked team">
      {teamNames.map(name => accuracy(name, decided.map(([, item]) => item).filter(item => item.team === name)))}
    </StatsBlock>
    {rows.length ? <div className="table-wrap"><table>
      <thead><tr><th>Matchup</th><th>Model pick</th><th>Projected margin</th><th>DraftKings moneyline</th><th>Final score</th><th>Outright</th><th>Margin result</th></tr></thead>
      <tbody>{rows.map(([id, item]) => <tr key={id}>
        <td>{item.matchup}</td><td>{item.team}{item.backtested && <small>Backtested</small>}</td><td>{item.margin == null ? "—" : item.margin.toFixed(1)}</td>
        <td>{Date.now() < Date.parse(item.date) ? <form onSubmit={event => saveOdds(event, id)}>
          <input name="price" aria-label={`DraftKings odds for ${item.team}`} placeholder="+120 or -135"
            defaultValue={item.odds} onChange={event => event.target.setCustomValidity('')} />
          <button type="submit">Save price</button>
          {item.odds && <small>Saved {item.odds}</small>}
        </form> : item.odds || 'Unavailable'}</td>
        <td>{item.finalScore || '—'}</td><td>{item.result}</td><td>{item.marginResult || '—'}</td>
      </tr>)}</tbody>
    </table></div> : <p>No saved picks match these filters.</p>}
    </>}
  </section>
}
