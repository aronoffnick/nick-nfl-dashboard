import { useMemo, useState } from 'react'
import { buildTeamParlay } from './teamParlay.js'

function nickname(name, abbr) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts.at(-1) || abbr || 'Team'
}

function signedSpread(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  const body = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1)
  if (rounded > 0) return `+${body}`
  if (rounded < 0) return `-${body}`
  return '0'
}

function legSpread(leg) {
  if (leg.spreadLine != null && Number.isFinite(Number(leg.spreadLine))) return Number(leg.spreadLine)
  if (leg.bet === 'Spread' && leg.line != null && Number.isFinite(Number(leg.line))) return Number(leg.line)
  return null
}

function legUpset(leg) {
  const line = legSpread(leg)
  if (line != null) return line > 0
  return Number(leg.price) > 0
}

function LegCard({ leg }) {
  const spread = signedSpread(legSpread(leg))
  const upset = legUpset(leg)
  const name = nickname(leg.teamName, leg.team)
  const label = spread ? `${name} (${spread})` : name
  const price = leg.price > 0 ? `+${leg.price}` : leg.price
  const detail = `${leg.teamName}${spread ? ` ${spread}` : ''} · ${leg.bet} ${price} · ${Math.round(leg.prob * 1000) / 10}% model${leg.source ? ` · ${leg.source}` : ''}${leg.asOf ? ` · ${leg.asOf}` : ''}`
  return <li className={upset ? 'team-parlay-card team-parlay-card-upset' : 'team-parlay-card'} title={detail}>
    {leg.logo ? <img src={leg.logo} alt="" onError={event => event.currentTarget.remove()} /> : null}
    <span className="pick-card-copy">
      <span className="pick-card-name">{label}</span>
      {upset ? <span className="pick-card-tag">(upset)</span> : null}
    </span>
  </li>
}

export default function TeamParlay({ matchups, week }) {
  const [legs, setLegs] = useState(3)
  const [minOdds, setMinOdds] = useState('+200')
  const [maxOdds, setMaxOdds] = useState('+600')
  const parsed = useMemo(() => ({
    legs: Number(legs),
    minOdds: Number(String(minOdds).replace(/^\+/, '')),
    maxOdds: Number(String(maxOdds).replace(/^\+/, '')),
  }), [legs, minOdds, maxOdds])
  const result = useMemo(() => buildTeamParlay(matchups, week, parsed), [matchups, week, parsed])
  const parlay = result.parlay
  return <section className="team-parlay" aria-label="Team parlay builder">
    <div className="team-parlay-head"><h2>Team parlay</h2><p>Unstarted games only. Prices are a static snapshot, not live odds. A getoddy moneyline is kept when one was already saved. Otherwise the price is the ESPN scoreboard odds snapshot.</p></div>
    <form onSubmit={event => event.preventDefault()}>
      <label>Legs<select value={legs} onChange={event => setLegs(event.target.value)}>{[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Min American<input value={minOdds} onChange={event => setMinOdds(event.target.value)} inputMode="text" /></label>
      <label>Max American<input value={maxOdds} onChange={event => setMaxOdds(event.target.value)} inputMode="text" /></label>
    </form>
    {!parlay ? <p className="team-parlay-empty">{result.reason}</p> : <>
      <p className="team-parlay-summary"><strong>{parlay.priceText}</strong> combined · <strong>{Math.round(parlay.hit * 1000) / 10}%</strong> model hit{parlay.asOf ? ` · snapshot ${parlay.asOf}` : ''}</p>
      <ol className="team-parlay-legs">{parlay.legs.map(leg => <LegCard key={leg.gameId + leg.bet} leg={leg} />)}</ol>
    </>}
  </section>
}
