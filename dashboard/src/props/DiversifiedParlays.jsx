import { useState } from 'react'
import { buildDiversifiedParlays } from './diversifiedParlays.js'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'

function pct(value) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}
function pct1(value) {
  return value == null ? '—' : `${(Math.round(value * 1000) / 10).toFixed(1)}%`
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
  if (leg.market) {
    if (leg.market === 'anytime TD') return `${leg.name} anytime TD`
    const shown = Number.isInteger(leg.line) ? String(leg.line) : Number(leg.line).toFixed(1)
    return `${leg.name} ${leg.side === 'under' ? 'under' : 'over'} ${shown} ${leg.market}`
  }
  if (leg.kind === 'team') return `${leg.team.abbr} to win`
  if (leg.key === 'totalTD') return `${leg.player.name} anytime TD`
  const shown = Number.isInteger(leg.line) ? String(leg.line) : leg.line.toFixed(1)
  return `${leg.player.name} over ${shown} ${leg.label}`
}
function nameKey(value) {
  return String(value || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()
}
function findId(roster, name) {
  const key = nameKey(name)
  for (const player of Object.values(roster || {})) if (nameKey(player.name) === key) return player.id
  const last = key.split(' ').at(-1)
  if (!last || last.length < 4) return null
  for (const player of Object.values(roster || {})) {
    const candidate = nameKey(player.name)
    if (candidate === last || candidate.endsWith(` ${last}`)) return player.id
  }
  return null
}

function MixCard({ card, roster }) {
  const show = card.independent == null ? pct : pct1
  const joint = card.joint == null ? null : show(card.joint)
  return <article className="mix-card">
    <header>
      <div><small>ESTIMATE</small><h4>{card.title}</h4></div>
      {joint && <div className="mix-score"><strong title="Correlation-adjusted estimate">{joint}</strong>{card.payout && <small>{card.payout}</small>}</div>}
    </header>
    {card.legs.length ? <ol>
      {card.legs.map(leg => <li key={leg.id || `${leg.name}:${leg.market}:${leg.line}`}>
        <Avatar id={leg.player?.id || findId(roster, leg.name)} name={leg.kind === 'team' ? leg.team.name : (leg.player?.name || leg.name)} logo={leg.kind === 'team' ? leg.team.logo : null} />
        <div>
          <strong>{lineText(leg)}</strong>
          {leg.price ? <span>{leg.price} {leg.book} · model {leg.model}{leg.lean === 'under' ? ' · model leans under' : ''}</span> : <span>{leg.kind === 'team' ? `Model favorite by ${leg.margin.toFixed(1)}` : `Projection ${leg.projection.toFixed(leg.key === 'totalTD' ? 2 : 1)}`}</span>}
          <span>Hit chance {show(leg.hit)}{leg.marketHit ? ` · market ${leg.marketHit}` : ''}{leg.season ? ` · ${leg.season}` : ''}{leg.kind === 'player' && leg.n >= 3 ? ` · recent ${leg.recent == null ? '—' : pct(leg.recent)} of ${leg.n}` : ''}</span>
          {leg.why && <em>{leg.why}</em>}
        </div>
      </li>)}
    </ol> : <p className="mix-empty">{card.why}</p>}
    {card.legs.length > 0 && <>
      <p className="mix-why">{card.why}</p>
      <p className="mix-joint">{card.independent == null
        ? `Combined ${joint}. The legs are multiplied as if independent. Same-game legs are not independent, so this is not a true parlay probability.`
        : `Combined ${pct1(card.joint)} with the correlation adjustment, ${pct1(card.independent)} if the legs were independent. Snapshot payout ${card.payout} multiplies the leg prices; a real same-game parlay pays less.`}</p>
      {card.note && <p className="mix-joint">{card.note}</p>}
    </>}
  </article>
}

export default function DiversifiedParlays({ matchup, players, window, week, roster }) {
  const snap = fileForWeek('parlaySnap', week)
  const key = `${scatterAbbrev(matchup.away.abbr)}-${scatterAbbrev(matchup.home.abbr)}`
  const seeded = snap.data?.games?.[key]?.cards
  const cards = seeded || buildDiversifiedParlays({ matchup, players, window })
  return <section className="mix-board" aria-label="Diversified parlay estimates">
    <div className="prop-section-title"><h3>Diversified parlays</h3><span>Estimates · entertainment, not advice</span></div>
    <p className="mix-intro">{seeded
      ? 'Lines and prices are a getoddy snapshot from Nov 26, 11:10 AM ET, best price across books. The combined percent includes a correlation adjustment. The payout multiplies those prices; books price same-game parlays lower. Entertainment, not advice.'
      : 'Four ways to read this game. Lines are model rungs under the projection. This matchup has no sportsbook snapshot yet. Hit chances mix how often the player recently cleared the rung with how far the projection sits past it.'}</p>
    <div className="mix-grid">{cards.map(card => <MixCard key={card.title} card={card} roster={roster} />)}</div>
  </section>
}
