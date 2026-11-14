import { useEffect, useState } from 'react'

const storageKey = 'nfl-moneyline-picks-v1'

export default function PickTracker({ data, matchups, historicalPicks }) {
  const currentWeek = data ? `${data.year} Week ${data.week}` : ''
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {} }
    catch { return {} }
  })
  const [storageError, setStorageError] = useState(false)
  const [week, setWeek] = useState('')
  const [filter, setFilter] = useState('All results')

  useEffect(() => {
    if (!data || !matchups) return
    setRecords(previous => {
      const next = { ...previous }
      for (const game of matchups) {
        if (next[game.id] || game.started || Date.now() >= Date.parse(game.date)) continue
        next[game.id] = {
          week: currentWeek, date: game.date, team: game.winner.abbr, teamId: game.winner.id,
          matchup: `${game.away.abbr} @ ${game.home.abbr}`, result: 'Pending', odds: '',
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
  const weeks = [...new Set([currentWeek, ...entries.map(([, item]) => item.week)].filter(Boolean))]
  const selectedWeek = week || currentWeek
  const weekly = entries.filter(([, item]) => item.week === selectedWeek)
  const count = result => weekly.filter(([, item]) => item.result === result).length
  const rows = weekly.filter(([, item]) => filter === 'All results' || item.result === filter)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date))
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
    <p>One moneyline pick per game. Open the dashboard before kickoff to save picks on this browser. Enter DraftKings prices before kickoff. Backtests use prior box scores and the default model settings. Week 1 has no same-season history.</p>
    {storageError && <p role="alert">This browser could not save the pick history.</p>}
    <div className="controls">
      <label>Week<select value={selectedWeek} onChange={event => setWeek(event.target.value)}>
        {weeks.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>Result<select value={filter} onChange={event => setFilter(event.target.value)}>
        {['All results', 'Pending', 'Win', 'Loss', 'Push'].map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <p>{count('Win')} wins · {count('Loss')} losses · {count('Push')} pushes · {count('Pending')} pending</p>
    {rows.length ? <div className="table-wrap"><table>
      <thead><tr><th>Matchup</th><th>Model pick</th><th>DraftKings moneyline</th><th>Result</th></tr></thead>
      <tbody>{rows.map(([id, item]) => <tr key={id}>
        <td>{item.matchup}</td><td>{item.team}{item.backtested && <small>Backtested</small>}</td>
        <td>{Date.now() < Date.parse(item.date) ? <form onSubmit={event => saveOdds(event, id)}>
          <input name="price" aria-label={`DraftKings odds for ${item.team}`} placeholder="+120 or -135"
            defaultValue={item.odds} onChange={event => event.target.setCustomValidity('')} />
          <button type="submit">Save price</button>
          {item.odds && <small>Saved {item.odds}</small>}
        </form> : item.odds || 'Unavailable'}</td>
        <td>{item.result}</td>
      </tr>)}</tbody>
    </table></div> : <p>No saved picks match these filters.</p>}
  </section>
}
