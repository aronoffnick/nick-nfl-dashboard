import { useMemo, useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
import './ScatterTab.css'

const METRICS = [
  ['meanExcess', 'Mean excess'],
  ['volatility', 'Volatility'],
  ['sharpe', 'Sharpe'],
  ['upsideCapture', 'Upside capture'],
  ['downsideCapture', 'Downside capture'],
  ['beta', 'Beta'],
  ['skew', 'Skew'],
  ['tailRate', 'Tail rate'],
  ['qbCorrelation', 'QB correlation'],
]

const NUDGES = [
  ['momentumMultiple', 'Momentum', 'Momentum: recent form versus his own season, in 1% steps, capped at 5%.'],
  ['defenseMultiple', 'Defense', 'Defense: the opponent yards factor and its recent trend, capped at 5%.'],
  ['netMultiple', 'Net', 'Net: momentum and defense together, capped at 8%, applied to the baseline.'],
  ['adjusted', 'Adjusted', 'Adjusted projection: the pre-game line times the net multiple. A model estimate.'],
]
const number = (value, key) => {
  if (!Number.isFinite(value)) return '—'
  if (key === 'tailRate') return `${Math.round(value * 100)}%`
  if (key === 'adjusted' || key === 'baseline') return value.toFixed(1)
  if (NUDGES.some(([name]) => name === key)) {
    const points = Math.round((value - 1) * 100)
    return points > 0 ? `+${points}%` : `${points}%`
  }
  const places = key === 'meanExcess' || key === 'volatility' ? 1 : 2
  return value.toFixed(places)
}
const joinKey = player => `${player.team}|${player.name}`

export default function Stocks({ week, away, home }) {
  const file = fileForWeek('stocks', week)
  const data = file.data
  const momentum = fileForWeek('momentum', week).data
  const breakout = fileForWeek('breakout', week).data
  const [position, setPosition] = useState('RB')
  const [scope, setScope] = useState('game')
  const [sortKey, setSortKey] = useState('sharpe')
  const [ascending, setAscending] = useState(false)
  const [picked, setPicked] = useState(null)
  const teams = new Set([scatterAbbrev(away), scatterAbbrev(home)])
  const rows = useMemo(() => {
    const stockRows = new Map((data?.players || []).map(player => [joinKey(player), player]))
    const scores = new Map((breakout?.players || []).map(player => [joinKey(player), player.score]))
    const merged = new Map()
    for (const player of data?.players || []) merged.set(joinKey(player), { ...player })
    for (const player of momentum?.players || []) {
      const key = joinKey(player)
      const prior = merged.get(key) || stockRows.get(key) || {}
      merged.set(key, { ...prior, ...player, sharpe: prior.sharpe, meanExcess: prior.meanExcess, volatility: prior.volatility, upsideCapture: prior.upsideCapture, downsideCapture: prior.downsideCapture, beta: prior.beta, skew: prior.skew, tailRate: prior.tailRate, qbCorrelation: prior.qbCorrelation, games: prior.games || player.games, breakoutScore: scores.get(key) })
    }
    for (const [key, player] of merged) if (player.breakoutScore == null) player.breakoutScore = scores.get(key)
    const source = [...merged.values()].filter(player => (position === 'All' || player.position === position) && (scope === 'all' || teams.has(player.team)))
    return source.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (!Number.isFinite(av)) return 1
      if (!Number.isFinite(bv)) return -1
      return (av - bv) * (ascending ? 1 : -1) || a.name.localeCompare(b.name)
    })
  }, [data, momentum, breakout, position, scope, sortKey, ascending, away, home])
  function header(key, label, tip = data?.tooltips?.[key] || '') {
    return <button className="sort" title={tip} onClick={() => { if (sortKey === key) setAscending(value => !value); else { setSortKey(key); setAscending(false) } }}>{label} {sortKey === key ? (ascending ? '↑' : '↓') : '↕'}</button>
  }
  if (!file.matched || !data) {
    return <section aria-label="RB Stocks"><div className="prop-section-title"><h3>RB Stocks</h3><span>Model estimates</span></div><p className="prop-warning">No stocks file for week {week}.</p></section>
  }
  const pickedRow = rows.find(row => row.name === picked) || rows[0]
  return <section aria-label="RB Stocks">
    <div className="prop-section-title"><h3>RB Stocks</h3><span>Model estimates · through week {data.throughWeek ?? '—'}</span></div>
    <p className="prop-help">{data.method} {momentum?.method} {momentum?.backtest ? `Weeks 9–12 absolute error, adjusted versus baseline: ${Object.entries(momentum.backtest).map(([pos, row]) => `${pos} ${row.testAdjustedMae} vs ${row.testBaselineMae}${row.helps ? '' : ', no help'}`).join('; ')}.` : ''}</p>
    <div className="projection-filters" aria-label="Stocks filters">
      <div className="projection-window"><strong>Position</strong>{['RB', 'WR', 'TE', 'QB', 'All'].map(value => <button key={value} type="button" aria-pressed={position === value} onClick={() => setPosition(value)}>{value}</button>)}</div>
      <div className="projection-window"><strong>Players</strong><button type="button" aria-pressed={scope === 'game'} onClick={() => setScope('game')}>This game</button><button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All players</button></div>
    </div>
    <RiskPlot rows={rows} picked={pickedRow} onPick={setPicked} />
    {!rows.length ? <p className="prop-warning">No player in this view has four scored games.</p> : <div className="table-wrap"><table>
      <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Games</th><th title="Validated running-back breakout score. Blank for other positions.">Breakout</th>{METRICS.map(([key, label]) => <th key={key}>{header(key, label)}</th>)}{NUDGES.map(([key, label, tip]) => <th key={key}>{header(key, label, tip)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.team}-${row.name}`} onClick={() => setPicked(row.name)}>{[
        <td key="name"><b>{row.name}</b></td>,
        <td key="pos">{row.position}</td>,
        <td key="team">{row.team}</td>,
        <td key="games">{row.games}</td>,
        <td key="breakout">{row.position === 'RB' && Number.isFinite(row.breakoutScore) ? row.breakoutScore : '—'}</td>,
        ...METRICS.map(([key]) => <td key={key} title={data.tooltips?.[key]}>{number(row[key], key)}</td>),
        ...NUDGES.map(([key, , tip]) => <td key={key} title={tip}>{number(row[key], key)}</td>),
      ]}</tr>)}</tbody>
    </table></div>}
  </section>
}

function RiskPlot({ rows, picked, onPick }) {
  const plotted = rows.filter(row => Number.isFinite(row.volatility) && Number.isFinite(row.meanExcess))
  if (!plotted.length) return null
  const width = 720
  const height = 360
  const margin = { l: 52, r: 16, t: 16, b: 44 }
  const maxX = Math.max(0.5, ...plotted.map(row => row.volatility)) * 1.15
  const maxY = Math.max(0.5, ...plotted.map(row => Math.abs(row.meanExcess))) * 1.2
  const x = value => margin.l + (value / maxX) * (width - margin.l - margin.r)
  const y = value => height - margin.b - ((value + maxY) / (maxY * 2)) * (height - margin.t - margin.b)
  const color = { RB: '#4fd1b5', WR: '#ff8a65', TE: '#90a4ae' }
  return <div className="scatter-card">
    <h4>Risk versus return</h4>
    <div className="scatter-plot">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Volatility against mean excess">
        <line x1={margin.l} x2={width - margin.r} y1={y(0)} y2={y(0)} stroke="#a5e6bd" strokeDasharray="5 5" />
        <text x={margin.l - 6} y={y(maxY) + 4} fontSize="10" fill="#8b9ba8" textAnchor="end">{maxY.toFixed(1)}</text>
        <text x={margin.l - 6} y={y(0) + 4} fontSize="10" fill="#8b9ba8" textAnchor="end">0</text>
        <text x={margin.l - 6} y={y(-maxY) + 4} fontSize="10" fill="#8b9ba8" textAnchor="end">{(-maxY).toFixed(1)}</text>
        <text x={x(maxX)} y={height - 12} fontSize="10" fill="#8b9ba8" textAnchor="end">Volatility</text>
        <text x="14" y={margin.t + 70} fontSize="10" fill="#8b9ba8" transform={`rotate(-90 14 ${margin.t + 70})`}>Mean excess</text>
        {plotted.map(row => <circle key={`${row.team}-${row.name}`} cx={x(row.volatility)} cy={y(row.meanExcess)} r={picked?.name === row.name ? 6 : 4} fill={color[row.position] || '#c9d6df'} opacity={picked && picked.name !== row.name ? 0.45 : 1} style={{ cursor: 'pointer' }} onClick={() => onPick(row.name)}><title>{`${row.name}: excess ${number(row.meanExcess, 'meanExcess')}, volatility ${number(row.volatility, 'volatility')}`}</title></circle>)}
      </svg>
    </div>
    <p className="scatter-note">Each dot is a model estimate. Further right is a wider week-to-week swing. Higher is more points above the pre-game line.</p>
  </div>
}
