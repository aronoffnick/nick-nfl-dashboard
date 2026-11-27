import { useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'

const number = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—'
const share = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
const nudge = value => {
  if (!Number.isFinite(value)) return '—'
  const points = Math.round((value - 1) * 100)
  return points > 0 ? `+${points}%` : `${points}%`
}

export default function BreakoutWatch({ week, away, home }) {
  const file = fileForWeek('breakout', week)
  const data = file.data
  const momentum = new Map((fileForWeek('momentum', week).data?.players || []).filter(player => player.position === 'RB').map(player => [`${player.team}|${player.name}`, player]))
  const [scope, setScope] = useState('watch')
  const teams = new Set([scatterAbbrev(away), scatterAbbrev(home)])
  if (!file.matched || !data) {
    return <section aria-label="Breakout watch"><div className="prop-section-title"><h3>Breakout watch</h3><span>Model estimates</span></div><p className="prop-warning">No breakout file for week {week}.</p></section>
  }
  const pool = scope === 'game' ? (data.players || []).filter(player => teams.has(player.team)) : (data.candidates || [])
  const rows = [...pool].sort((a, b) => b.score - a.score || (b.implied || 0) - (a.implied || 0) || a.name.localeCompare(b.name))
  const flags = (data.unvalidated || []).filter(player => teams.has(player.team))
  const study = data.study || {}
  return <section aria-label="Breakout watch">
    <div className="prop-section-title"><h3>Breakout watch</h3><span>{data.label}</span></div>
    <p className="prop-help">Running backs at {data.weights?.rb?.minScore ?? 3} or more broke out {Math.round((study.rbHitRate || 0.247) * 1000) / 10}% of the time against {Math.round((study.rbComparisonRate || 0.077) * 1000) / 10}% otherwise, on the weeks 9–12 check ({study.testBreakouts || 57} breakouts). There is no route data, so snap share stands in. Books may already price goal-line roles. Prices are blank.</p>
    <div className="projection-window"><strong>Running backs</strong><button type="button" aria-pressed={scope === 'watch'} onClick={() => setScope('watch')}>Watch list</button><button type="button" aria-pressed={scope === 'game'} onClick={() => setScope('game')}>This game</button></div>
    {!rows.length ? <p className="prop-warning">No running back clears the validated line in this view.</p> : <div className="table-wrap"><table>
      <thead><tr><th>Player</th><th>Team</th><th>Score</th><th title="Share of the offense's red-zone touches. 20% or more is worth 2.">Red zone</th><th title="Share of the offense's inside-10 touches. 25% or more is worth 1.">Inside 10</th><th title="Last three games' snap share is above the earlier games.">Snap rising</th><th title="Last three games' targets plus carries are above the earlier games.">Opportunities rising</th><th title="Underdog by 3 or more, a prior spike game, or a quarterback change. These cut the historical rate. They do not change the score.">Flags</th><th title="Recent form versus his own season, capped at 5%.">Momentum</th><th title="Opponent yards factor and its recent trend, capped at 5%.">Defense</th><th title="Momentum and defense together, capped at 8%.">Net</th><th>Adjusted rush yds</th></tr></thead>
      <tbody>{rows.map(row => {
        const form = momentum.get(`${row.team}|${row.name}`)
        return <tr key={`${row.team}-${row.name}`}>
          <td><b>{row.name}</b></td><td>{row.team}</td><td>{row.score}</td>
          <td>{share(row.signals?.redZoneShare)}</td><td>{share(row.signals?.inside10Share)}</td>
          <td>{row.signals?.snapShareRising ? 'Yes' : 'No'}</td><td>{row.signals?.opportunitiesRising ? 'Yes' : 'No'}</td>
          <td>{row.flags?.length ? row.flags.join(', ') : '—'}</td>
          <td>{nudge(form?.momentumMultiple)}</td><td>{nudge(form?.defenseMultiple)}</td><td>{nudge(form?.netMultiple)}</td><td>{number(form?.adjusted)}</td>
        </tr>
      })}</tbody>
    </table></div>}
    <div className="prop-section-title"><h3>Unvalidated game-environment flags</h3><span>Wide receivers and tight ends · not a ranking</span></div>
    <p className="prop-help">Those rules failed the weeks 9–12 check (AUC about 0.51 and 0.47). A flag is a game-environment note, not a score to bet.</p>
    {!flags.length ? <p className="prop-warning">No unvalidated flags in this view.</p> : <div className="table-wrap"><table>
      <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Flags</th></tr></thead>
      <tbody>{flags.map(row => <tr key={`${row.team}-${row.name}`}><td><b>{row.name}</b></td><td>{row.position}</td><td>{row.team}</td><td>{row.flags.join(', ')}</td></tr>)}</tbody>
    </table></div>}
  </section>
}
