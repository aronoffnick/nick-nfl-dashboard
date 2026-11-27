import { useState } from 'react'
import { fileForWeek } from './data/weekFiles.js'
import { basisSentence, rankingsFromFile, statName } from './positionRankings.js'
import './PositionRankings.css'

const SHORT_STAT = {
  passYds: 'pass yds',
  rushYds: 'rush yds',
  recYds: 'rec yds',
  rec: 'receptions',
}

function yards(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

function netLabel(value) {
  if (!Number.isFinite(value)) return '—'
  const points = Math.round((value - 1) * 100)
  return points > 0 ? `+${points}%` : `${points}%`
}

function displayRows(rows, sort) {
  const copy = [...rows]
  const dir = sort.ascending ? 1 : -1
  copy.sort((a, b) => {
    const av = a[sort.key]
    const bv = b[sort.key]
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir || String(a.name).localeCompare(String(b.name))
    }
    if (!Number.isFinite(av)) return 1
    if (!Number.isFinite(bv)) return -1
    return (av - bv) * dir || String(a.name).localeCompare(String(b.name))
  })
  return copy
}

function Rank({ value }) {
  return <span className={`rank ${value <= 10 ? 'good' : ''}`}>#{value}</span>
}

export default function PositionRankings({ week, query }) {
  const [position, setPosition] = useState('All')
  const [sort, setSort] = useState({ key: 'adjusted', ascending: false })
  if (week == null) {
    return <p className="notice" role="status">Position rankings use this week’s file. They appear after the current week loads.</p>
  }
  const board = rankingsFromFile(fileForWeek('momentum', week), { query })
  const choices = board.status === 'ready'
    ? ['All', ...board.groups.map(group => group.position)]
    : ['All', 'QB', 'RB', 'WR', 'TE']
  function firstClickAscending(key) {
    return key === 'name' || key === 'team' || key === 'opponent' || key === 'rank'
  }
  function header(label, key, tip) {
    return <button className="sort" title={tip} onClick={() => setSort(current => ({ key, ascending: current.key === key ? !current.ascending : firstClickAscending(key) }))}>{label} {sort.key === key ? (sort.ascending ? '↑' : '↓') : '↕'}</button>
  }
  if (board.status === 'missing') {
    return <section className="position-rankings" aria-label="Position Rankings">
      <p className="notice" role="status">No position rankings for week {week}. That week’s file is not in this build, so this board stays empty.</p>
    </section>
  }
  const searching = String(query || '').trim().length > 0
  const selected = position === 'All' ? board.groups : board.groups.filter(group => group.position === position)
  const visible = position === 'All' && searching
    ? selected.filter(group => group.inFile === 0 || group.rows.length > 0)
    : selected
  return <section className="position-rankings" aria-label="Position Rankings">
    <p className="position-lead">Week {board.week}{board.throughWeek != null ? ` · stats through week ${board.throughWeek}` : ''}. Each position is ordered by the adjusted projection already stored for that week. This is not a fantasy-point total.</p>
    <div className="position-filters" role="group" aria-label="Position">
      <strong>Position</strong>
      {choices.map(value => <button key={value} type="button" aria-pressed={position === value} onClick={() => setPosition(value)}>{value}</button>)}
    </div>
    {board.method && <details className="position-method"><summary>How this number is built</summary><p>{board.method}</p></details>}
    {searching && !visible.length && <p className="notice" role="status">No players match this search.</p>}
    {visible.map(group => {
      const stat = statName(group.primary)
      const adjustedLabel = stat ? `Adjusted ${SHORT_STAT[group.primary]}` : 'Adjusted'
      const rows = displayRows(group.rows, sort)
      const empty = group.inFile === 0
        ? `No ${group.position} projections in the week ${board.week} file.`
        : searching
          ? `No ${group.position} players match this search.`
          : `No ${group.position} player in the week ${board.week} file has an adjusted projection.`
      return <section className="position-group" key={group.position} aria-label={`${group.position} rankings`}>
        <h3>{group.position}</h3>
        <p className="position-basis">{basisSentence(group.primary)}</p>
        {!rows.length ? <p className="notice" role="status">{empty}</p> : <div className="table-wrap"><table>
          <thead><tr>
            <th>{header('Rank', 'rank', 'Rank by adjusted projection. Equal values share a rank.')}</th>
            <th>{header('Player', 'name')}</th>
            <th>{header('Team', 'team')}</th>
            <th>{header('Opp', 'opponent')}</th>
            <th>{header('Games', 'games', 'Scored games already on the player row.')}</th>
            <th>{header('Baseline', 'baseline', 'Pipeline pre-game projection, before the net multiple.')}</th>
            <th>{header(adjustedLabel, 'adjusted', 'Baseline times the net multiple. This is the ranking.')}</th>
            <th>{header('Net', 'netMultiple', 'Momentum and defense together, from the week file.')}</th>
          </tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.team}-${row.position}-${row.name}`}>
            <td><Rank value={row.rank} /></td>
            <td><b>{row.name}</b></td>
            <td>{row.team}</td>
            <td>{row.opponent || '—'}</td>
            <td>{Number.isFinite(row.games) ? row.games : '—'}</td>
            <td>{yards(row.baseline)}</td>
            <td>{yards(row.adjusted)}</td>
            <td title={Number.isFinite(row.netMultiple) ? `${row.netMultiple.toFixed(2)}×` : undefined}>{netLabel(row.netMultiple)}</td>
          </tr>)}</tbody>
        </table></div>}
        {group.missing.length > 0 && <p className="position-basis">{group.missing.length} {group.position} {group.missing.length === 1 ? 'player has' : 'players have'} no adjusted projection in the file and {group.missing.length === 1 ? 'is' : 'are'} not ranked.</p>}
      </section>
    })}
  </section>
}
