import { useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
import { allowedText, chanceText, findTdGame, flavorLabel, picksOf, priceText, rulesText, safeNote, sideCaption, snapshotText } from './tdRiskBoard.js'
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
function PickCard({ pick, ids }) {
  const flavor = flavorLabel(pick)
  return <div className="td-pick">
    <Avatar id={findId(ids, pick.player)} name={pick.player} />
    <div>
      <div className="td-pick-top"><b>{pick.player}</b><b>{chanceText(pick.modelProb)}</b></div>
      <span>{[pick.prop, pick.role, flavor, priceText(pick)].filter(Boolean).join(' · ')}</span>
      {(pick.estimate || pick.status) && <span className="td-flags">
        {pick.estimate ? <i className="td-flag">Estimate</i> : null}
        {pick.status ? <i className="td-status">{pick.status}</i> : null}
      </span>}
      {pick.reason && <em>{pick.reason}</em>}
    </div>
  </div>
}
function Slot({ title, picks, note, ids }) {
  return <div className="td-slot">
    <h5>{title}</h5>
    {picks.map(pick => <PickCard key={`${pick.player}:${pick.prop}:${pick.modelProb}`} pick={pick} ids={ids} />)}
    {!picks.length && note ? <p>{note}</p> : null}
    {!!picks.length && note ? <p>{note}</p> : null}
  </div>
}
function RiskRow({ row, ids, rules }) {
  const upside = picksOf(row.upside)
  return <article className="td-row">
    <header><h4>{row.position}</h4><span>{allowedText(row)}</span></header>
    <div className="td-scale" aria-hidden="true" />
    <div className="td-scale-labels"><span>More confident</span><span>More risk</span></div>
    <div className="td-slots">
      <Slot title="Confident" picks={picksOf(row.confident)} note={row.confident ? '' : 'No confident pick in this snapshot.'} ids={ids} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Relatively safe" picks={picksOf(row.relativelySafe)} note={safeNote(row, rules)} ids={ids} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Upside" picks={upside} note={upside.length ? '' : 'No 2+ or backup pick in this snapshot.'} ids={ids} />
    </div>
  </article>
}

export default function Touchdowns({ away, home, week, roster }) {
  const file = fileForWeek('tdRisk', week)
  const game = findTdGame(file.data, away?.abbr, home?.abbr)
  const ids = idsByName(roster)
  const matchKey = game?.key || `${away?.abbr}@${home?.abbr}`
  const [selection, setSelection] = useState({ key: matchKey, index: 0 })
  const sideIndex = selection.key === matchKey ? selection.index : 0
  const chooseSide = index => setSelection({ key: matchKey, index })
  if (!file.matched || !game) return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="td-empty">Touchdown board for {file.matched ? 'this matchup' : `Week ${week}`} is coming soon.</p>
  </section>
  const side = game.sides?.[sideIndex] || game.sides?.[0]
  const rules = rulesText(file.data?.rules)
  return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    {file.data?.disclaimer && <p className="td-intro">{file.data.disclaimer}</p>}
    {rules && <p className="td-intro">{rules} An Estimate tag is a rough season-usage figure. Injury status is shown when the file has one.</p>}
    {snapshotText(game) && <p className="td-caption">{snapshotText(game)}</p>}
    <div className="td-switch" role="group" aria-label="Offense">
      {(game.sides || []).map((item, index) => {
        const offense = nickname(teamByAbbr(item.offense, away, home)) || item.offense
        const defense = nickname(teamByAbbr(item.defense, away, home)) || item.defense
        return <button key={`${item.offense}-${item.defense}`} type="button" aria-pressed={index === sideIndex} onClick={() => chooseSide(index)}>{offense} offense vs {defense} defense</button>
      })}
    </div>
    {side && <p className="td-caption">{sideCaption(side)}</p>}
    {(side?.rows || []).map(row => <RiskRow key={row.position} row={row} ids={ids} rules={file.data?.rules} />)}
  </section>
}
