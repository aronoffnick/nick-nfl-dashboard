import { useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
import './coverage.css'

const COLORS = { QB: '#b388ff', RB: '#4fd1b5', WR: '#ff8a65', TE: '#90a4ae' }
const ORDER = ['QB', 'RB', 'WR', 'TE']

function lastName(name) {
  const parts = String(name).split(' ').filter(part => !/^(jr|sr|ii|iii|iv)\.?$/i.test(part))
  return parts.at(-1) || name
}

function Chart({ view, coverages }) {
  const players = view.players.filter(player => ORDER.includes(player.pos))
  const skill = players.filter(player => player.pos !== 'QB')
  const W = 860, H = 480, left = 78, right = 156, top = 16, bottom = 68
  const plotW = W - left - right, plotH = H - top - bottom
  const maxY = Math.max(1, ...players.flatMap(player => coverages.map(coverage => player.coverage[coverage.key] || 0))) * 1.2
  const totals = coverages.map(coverage => skill.reduce((sum, player) => sum + (player.coverage[coverage.key] || 0), 0))
  const weighted = skill.reduce((sum, player) => sum + player.proj, 0)
  const maxT = Math.max(weighted, ...totals, 1) * 1.18
  const x = index => left + (coverages.length === 1 ? plotW / 2 : (index / (coverages.length - 1)) * plotW)
  const y = value => top + plotH - (value / maxY) * plotH
  const yRight = value => top + plotH - (value / maxT) * plotH
  const yTicks = 5
  const labels = players.map(player => ({ player, yy: y(player.coverage[coverages.at(-1).key] || 0) })).sort((a, b) => a.yy - b.yy)
  let last = -999
  for (const label of labels) {
    if (label.yy < last + 13) label.yy = last + 13
    last = label.yy
  }
  return <svg className="coverage-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Coverage projections. Estimates.">
    {Array.from({ length: yTicks + 1 }, (_, tick) => {
      const value = maxY * tick / yTicks
      const yy = y(value)
      const rightValue = maxT * tick / yTicks
      return <g key={tick}>
        <line x1={left} x2={W - right} y1={yy} y2={yy} stroke="#24323d" />
        <text x={left - 8} y={yy + 3} textAnchor="end" className="coverage-tick">{value.toFixed(0)}</text>
        <text x={W - right + 8} y={yy + 3} className="coverage-tick coverage-tick-right">{rightValue.toFixed(0)}</text>
      </g>
    })}
    <line x1={left} x2={W - right} y1={yRight(weighted)} y2={yRight(weighted)} stroke="#7eb6ff" strokeDasharray="4 4" />
    <text x={left + 6} y={yRight(weighted) - 6} className="coverage-total-label">weighted team total {weighted.toFixed(1)} ESTIMATE</text>
    <polyline fill="none" stroke="#7eb6ff" strokeWidth="1.6" strokeDasharray="6 4" points={totals.map((total, index) => `${x(index)},${yRight(total)}`).join(' ')} />
    {players.map((player, index) => <polyline key={player.name} fill="none" stroke={COLORS[player.pos]} strokeWidth="1.2" opacity="0.55" points={coverages.map((coverage, point) => `${x(point) + (index % 5 - 2) * 4},${y(player.coverage[coverage.key] || 0)}`).join(' ')} />)}
    {players.map((player, index) => coverages.map((coverage, point) => {
      const radius = 4 + Math.min(player.usage || 0, 40) * 0.16
      return <circle key={`${player.name}-${coverage.key}`} cx={x(point) + (index % 5 - 2) * 4} cy={y(player.coverage[coverage.key] || 0)} r={radius} fill={COLORS[player.pos]} fillOpacity="0.9" stroke="#0d141b" strokeWidth="1"><title>{`${player.name} (${player.pos}) ${coverage.label}: ${(player.coverage[coverage.key] || 0).toFixed(1)} PPR · weighted ${player.proj.toFixed(1)}`}</title></circle>
    }))}
    {labels.map(label => <text key={label.player.name} x={W - right + 46} y={label.yy} className="coverage-name" fill={COLORS[label.player.pos]}>{lastName(label.player.name)} {label.player.proj.toFixed(1)}</text>)}
    {coverages.map((coverage, index) => <text key={coverage.key} x={x(index)} y={H - bottom + 16} textAnchor="middle" className="coverage-xlabel">
      <tspan x={x(index)} dy="0">{coverage.label}</tspan>
      <tspan x={x(index)} dy="12">({coverage.scheme})</tspan>
      <tspan x={x(index)} dy="12">{Math.round((view.mix?.[coverage.key] || 0) * 100)}% of calls</tspan>
    </text>)}
    <text x="14" y={top + plotH / 2} transform={`rotate(-90 14 ${top + plotH / 2})`} className="coverage-axis">Projected PPR if this coverage were played all game (ESTIMATE)</text>
    <text x={W - 8} y={top + plotH / 2} transform={`rotate(90 ${W - 8} ${top + plotH / 2})`} className="coverage-axis">Team skill total, RB+WR+TE (ESTIMATE)</text>
  </svg>
}

export default function CoverageTab({ away, home, week }) {
  const file = fileForWeek('coverage', week)
  const key = `${scatterAbbrev(away.abbr)}-${scatterAbbrev(home.abbr)}`
  const game = file.data?.games?.[key]
  const sides = [
    { abbr: scatterAbbrev(away.abbr), name: away.name },
    { abbr: scatterAbbrev(home.abbr), name: home.name },
  ]
  const [offense, setOffense] = useState(sides[0].abbr)
  if (!file.matched) return <p className="coverage-empty">No Week {week} coverage file. Add coverage-wk{week}.json to show this breakdown.</p>
  if (!game) return <p className="coverage-empty">No Week {week} coverage file for this matchup.</p>
  const view = game.offenses?.[offense]
  const offenseName = sides.find(side => side.abbr === offense)?.name || offense
  const defense = sides.find(side => side.abbr !== offense)
  const rows = ORDER.map(pos => view?.players?.find(player => player.pos === pos)).filter(Boolean)
  const weighted = (view?.players || []).filter(player => player.pos !== 'QB').reduce((sum, player) => sum + player.proj, 0)
  return <section className="coverage-tab" aria-label="Coverage breakdown">
    <div className="prop-section-title"><h3>Coverage breakdown · ESTIMATE</h3><span>Not a betting line</span></div>
    <div className="coverage-switch" role="group" aria-label="Offense">
      {sides.map(side => <button key={side.abbr} type="button" aria-pressed={offense === side.abbr} onClick={() => setOffense(side.abbr)}>{side.name}</button>)}
    </div>
    {!view ? <p className="coverage-empty">No coverage rows for {offenseName} in this file.</p> : <>
      <h4 className="coverage-heading">{offenseName} offense vs {defense?.name} defense</h4>
      <div className="coverage-layout">
        <div className="coverage-card">
          <Chart view={view} coverages={file.data.coverages} />
          <div className="coverage-legend">{ORDER.map(pos => <span key={pos}><i style={{ background: COLORS[pos] }} />{pos}</span>)}<span>Dot size = projected targets + carries</span><span>Number by the name = coverage-weighted PPR</span></div>
        </div>
        <aside className="coverage-side">
          <h4>What the {defense?.name} allowed, 2026</h4>
          <p>Season average by position. Black in the original chart was the NFL average; the factor is the matchup multiplier used in the projection.</p>
          <table>
            <thead><tr><th>Pos</th><th>Allowed</th><th>NFL avg</th><th>Factor</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.pos}><td>{row.pos}</td><td>{row.allowed?.toFixed(1) ?? '—'}</td><td>{row.league?.toFixed(1) ?? '—'}</td><td>{row.factor == null ? '—' : `x${row.factor.toFixed(2)}`}</td></tr>)}</tbody>
          </table>
          <p className="coverage-skill">RB+WR+TE weighted total <b>{weighted.toFixed(1)}</b> ESTIMATE</p>
        </aside>
      </div>
      <p className="coverage-note">ESTIMATE. Each dot is that player’s projected PPR if the defense played one coverage for the whole game. The number beside the name weights those dots by this defense’s coverage mix. The mix is the one implied by these projections; the Sharp shell file and 2025 charting used to build it are not stored in the app. Per-game dots from the original chart are not in the weekly file, so the side panel shows the season average only. O-line is excluded. A later week stays blank until coverage-wkN.json is added.</p>
    </>}
  </section>
}
