import { useState } from 'react'
import { calibrationBefore } from '../data/accuracy.js'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
import { applyCoverage, DEFAULT_TOUCHDOWN_VIEW, mergeTouchdownSides } from './tdCoverage.js'
import { allowedText, chanceText, findTdGame, flavorLabel, picksOf, priceText, rulesText, sideCaption, snapshotText } from './tdRiskBoard.js'
import './touchdowns.css'

function nameKey(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
}
function headshotUrl(id) {
  return /^\d+$/.test(String(id || '')) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : null
}
function initials(name) {
  const base = String(name || '').split(',')[0]
  return base.split(' ').filter(part => part && !/^(jr|sr|ii|iii|iv)\.?$/i.test(part)).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
}
function findId(ids, name) {
  const raw = String(name || '').split(',')[0]
  const key = nameKey(raw)
  if (ids.get(key)) return ids.get(key)
  const last = nameKey(raw.split(' ').at(-1) || '')
  if (last.length < 4) return null
  for (const [candidate, id] of ids) if (candidate === last || candidate.endsWith(` ${last}`)) return id
  return null
}
function Avatar({ id, name }) {
  const [failed, setFailed] = useState(false)
  const src = !failed && headshotUrl(id)
  if (!src) return <span className="td-avatar td-initials" aria-hidden="true">{initials(name)}</span>
  return <img className="td-avatar" src={src} alt="" onError={() => setFailed(true)} />
}
function idsByName(roster) {
  const map = new Map()
  for (const player of Object.values(roster || {})) {
    const key = nameKey(player.name)
    if (key && !map.has(key)) map.set(key, player.id)
  }
  return map
}
function nickname(team) {
  return String(team?.name || team?.abbr || '').split(' ').filter(Boolean).at(-1) || team?.abbr || ''
}
function teamByAbbr(abbr, away, home) {
  return [away, home].find(team => scatterAbbrev(team?.abbr) === abbr) || null
}
function PickCard({ pick, ids, showTeam }) {
  const flavor = flavorLabel(pick)
  return <div className="td-pick">
    <Avatar id={findId(ids, pick.player)} name={pick.player} />
    <div>
      <div className="td-pick-top"><b>{pick.player}</b><b>{chanceText(pick.modelProb)}</b></div>
      <span>{[showTeam ? pick.team : null, pick.prop, pick.role, flavor, priceText(pick)].filter(Boolean).join(' · ')}</span>
      {(pick.estimate || pick.status) && <span className="td-flags">
        {pick.estimate ? <i className="td-flag">Estimate</i> : null}
        {pick.status ? <i className="td-status">{pick.status}</i> : null}
      </span>}
      {pick.reason && <em>{pick.reason}</em>}
    </div>
  </div>
}
function Slot({ title, picks, ids, showTeam }) {
  return <div className="td-slot">
    <h5>{title}</h5>
    {picks.map(pick => <PickCard key={`${pick.team}:${pick.player}:${pick.prop}:${pick.modelProb}`} pick={pick} ids={ids} showTeam={showTeam} />)}
  </div>
}
function RiskRow({ row, ids, showTeam }) {
  const allowed = row.sources ? row.sources.map(source => `${source.defense}: ${allowedText(source.row)}`).join(' · ') : allowedText(row)
  return <article className="td-row">
    <header><h4>{row.position}</h4><span>{allowed}</span></header>
    <div className="td-scale" aria-hidden="true" />
    <div className="td-scale-labels"><span>More confident</span><span>More risk</span></div>
    <div className="td-slots">
      <Slot title="Confident" picks={picksOf(row.confident)} ids={ids} showTeam={showTeam} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Relatively safe" picks={picksOf(row.relativelySafe)} ids={ids} showTeam={showTeam} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Upside" picks={picksOf(row.upside)} ids={ids} showTeam={showTeam} />
    </div>
  </article>
}

export default function Touchdowns({ away, home, week, roster }) {
  const file = fileForWeek('tdRisk', week)
  const coverage = fileForWeek('coverage', week)
  const tdCoverage = fileForWeek('tdCoverage', week)
  const prior = calibrationBefore(week)
  const game = applyCoverage(findTdGame(file.data, away?.abbr, home?.abbr), coverage.matched ? coverage.data : null, tdCoverage.matched ? tdCoverage.data : null, file.data?.rules, { coverageDamp: prior?.adjustments?.coverageDamp ?? 1 })
  const ids = idsByName(roster)
  const matchKey = game?.key || `${away?.abbr}@${home?.abbr}`
  const [selection, setSelection] = useState({ key: matchKey, mode: DEFAULT_TOUCHDOWN_VIEW })
  const mode = selection.key === matchKey ? selection.mode : DEFAULT_TOUCHDOWN_VIEW
  const chooseSide = next => setSelection({ key: matchKey, mode: next })
  if (!file.matched || !game) return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="td-empty">Touchdown board for {file.matched ? 'this matchup' : `Week ${week}`} is coming soon.</p>
  </section>
  const combined = mode === 'both'
  const side = combined ? null : game.sides?.[mode]
  const rules = rulesText(file.data?.rules)
  return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    {file.data?.disclaimer && <p className="td-intro">{file.data.disclaimer}</p>}
    {rules && <p className="td-intro">{rules} An Estimate tag is a rough season-usage figure. Injury status is shown when the file has one.{game.coverageApplied ? ' Chances are coverage-adjusted: 2025 TD rate vs man/zone, weighted by this defense\'s 2026 coverage mix, capped ±10%. Estimates.' : ''}</p>}
    {snapshotText(game) && <p className="td-caption">{snapshotText(game)}</p>}
    <div className="td-switch" role="group" aria-label="Offense">
      <button type="button" aria-pressed={combined} onClick={() => chooseSide('both')}>Both teams</button>
      {(game.sides || []).map((item, index) => {
        const offense = nickname(teamByAbbr(item.offense, away, home)) || item.offense
        const defense = nickname(teamByAbbr(item.defense, away, home)) || item.defense
        return <button key={`${item.offense}-${item.defense}`} type="button" aria-pressed={mode === index} onClick={() => chooseSide(index)}>{offense} offense vs {defense} defense</button>
      })}
    </div>
    {combined ? (game.sides || []).map(item => <p className="td-caption" key={`${item.offense}-${item.defense}`}>{sideCaption(item)}</p>) : side && <p className="td-caption">{sideCaption(side)}</p>}
    {(combined ? mergeTouchdownSides(game.sides) : (side?.rows || [])).map(row => <RiskRow key={row.position} row={row} ids={ids} showTeam={combined} />)}
  </section>
}
