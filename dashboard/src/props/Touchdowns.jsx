import { useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
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
function Slot({ title, picks, note, ids }) {
  return <div className="td-slot">
    <h5>{title}</h5>
    {picks.map(pick => <div className="td-pick" key={`${pick.name}:${pick.chance}`}>
      <Avatar id={findId(ids, pick.name)} name={pick.name} />
      <div>
        <div className="td-pick-top"><b>{pick.name}</b><b>{pick.chance}</b></div>
        <span>{pick.role} · {pick.price}</span>
        <em>{pick.why}</em>
      </div>
    </div>)}
    {!picks.length && note && <p>{note}</p>}
    {!!picks.length && note && <p>{note}</p>}
  </div>
}
function RiskRow({ row, ids }) {
  return <article className="td-row">
    <header><h4>{row.pos}</h4><span>{row.allowed}</span></header>
    <div className="td-scale" aria-hidden="true" />
    <div className="td-scale-labels"><span>More confident</span><span>More risk</span></div>
    <div className="td-slots">
      <Slot title="Confident" picks={row.confident || []} note={row.confidentNote} ids={ids} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Relatively safe" picks={row.safe || []} note={(row.safe || []).length ? null : (row.safeNote || 'No player at this position reaches 15%.')} ids={ids} />
      <span className="td-arrow" aria-hidden="true">→</span>
      <Slot title="Upside" picks={row.upside || []} note={row.upsideNote} ids={ids} />
    </div>
  </article>
}

export default function Touchdowns({ away, home, week, roster }) {
  const file = fileForWeek('tdRisk', week)
  const key = `${scatterAbbrev(away.abbr)}-${scatterAbbrev(home.abbr)}`
  const game = file.data?.games?.[key]
  const ids = idsByName(roster)
  const [sideIndex, setSideIndex] = useState(0)
  if (!file.matched || !game) return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="td-empty">Touchdown board for {file.matched ? 'this matchup' : `Week ${week}`} is coming soon.</p>
  </section>
  const side = game.sides[sideIndex] || game.sides[0]
  return <section className="td-board" aria-label="Touchdowns">
    <div className="prop-section-title"><h3>Touchdowns</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="td-intro">One row per position, ordered by how many touchdowns that position has scored on this defense. Prices are a snapshot, not live. A relatively safe name appears only at 15% or more. A 3+ look appears only at 5% or more.</p>
    <div className="td-switch" role="group" aria-label="Offense">
      {game.sides.map((item, index) => <button key={item.title} type="button" aria-pressed={index === sideIndex} onClick={() => setSideIndex(index)}>{item.title}</button>)}
    </div>
    <p className="td-caption">{side.caption}</p>
    {side.rows.map(row => <RiskRow key={row.pos} row={row} ids={ids} />)}
  </section>
}
