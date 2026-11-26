import { useState } from 'react'
import { buildDiversifiedParlays } from './diversifiedParlays.js'

function pct(value) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}
function initials(name) {
  return String(name || '').split(' ').filter(part => part && !/^(jr|sr|ii|iii|iv)\.?$/i.test(part)).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
}
function headshotUrl(id) {
  return /^\d+$/.test(String(id || '')) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : null
}
function Avatar({ id, name, logo }) {
  const [failed, setFailed] = useState(false)
  const src = !failed && (logo || headshotUrl(id))
  if (!src) return <span className="mix-avatar mix-initials" aria-hidden="true">{initials(name)}</span>
  return <img className="mix-avatar" src={src} alt="" onError={() => setFailed(true)} />
}
function lineText(leg) {
  if (leg.kind === 'team') return `${leg.team.abbr} to win`
  if (leg.key === 'totalTD') return `${leg.player.name} anytime TD`
  const shown = Number.isInteger(leg.line) ? String(leg.line) : leg.line.toFixed(1)
  return `${leg.player.name} over ${shown} ${leg.label}`
}

function MixCard({ card }) {
  const joint = card.joint == null ? null : pct(card.joint)
  return <article className="mix-card">
    <header>
      <div><small>ESTIMATE</small><h4>{card.title}</h4></div>
      {joint && <strong title="Legs multiplied as if independent">{joint}</strong>}
    </header>
    {card.legs.length ? <ol>
      {card.legs.map(leg => <li key={leg.id}>
        <Avatar id={leg.player?.id} name={leg.kind === 'team' ? leg.team.name : leg.player.name} logo={leg.kind === 'team' ? leg.team.logo : null} />
        <div>
          <strong>{lineText(leg)}</strong>
          <span>{leg.kind === 'team' ? `Model favorite by ${leg.margin.toFixed(1)}` : `Projection ${leg.projection.toFixed(leg.key === 'totalTD' ? 2 : 1)}`}</span>
          <span>Hit chance {pct(leg.hit)}{leg.kind === 'player' && leg.n >= 3 ? ` · recent ${leg.recent == null ? '—' : pct(leg.recent)} of ${leg.n}` : ''}</span>
          {leg.why && <em>{leg.why}</em>}
        </div>
      </li>)}
    </ol> : <p className="mix-empty">{card.why}</p>}
    {card.legs.length > 0 && <>
      <p className="mix-why">{card.why}</p>
      <p className="mix-joint">Combined {joint}. The legs are multiplied as if independent. Same-game legs are not independent, so this is not a true parlay probability.</p>
    </>}
  </article>
}

export default function DiversifiedParlays({ matchup, players, window }) {
  const cards = buildDiversifiedParlays({ matchup, players, window })
  return <section className="mix-board" aria-label="Diversified parlay estimates">
    <div className="prop-section-title"><h3>Diversified parlays</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="mix-intro">Four ways to read this game. Lines are model rungs under the projection, not a DraftKings snapshot. The dashboard does not store sportsbook prop lines. Hit chances mix how often the player recently cleared the rung with how far the projection sits past it.</p>
    <div className="mix-grid">{cards.map(card => <MixCard key={card.title} card={card} />)}</div>
  </section>
}
