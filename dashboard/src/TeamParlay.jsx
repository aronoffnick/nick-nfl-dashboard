import { useMemo, useState } from 'react'
import { buildTeamParlay } from './teamParlay.js'

export default function TeamParlay({ matchups, week }) {
  const [legs, setLegs] = useState(2)
  const [minOdds, setMinOdds] = useState('+100')
  const [maxOdds, setMaxOdds] = useState('+450')
  const parsed = useMemo(() => ({
    legs: Number(legs),
    minOdds: Number(String(minOdds).replace(/^\+/, '')),
    maxOdds: Number(String(maxOdds).replace(/^\+/, '')),
  }), [legs, minOdds, maxOdds])
  const result = useMemo(() => buildTeamParlay(matchups, week, parsed), [matchups, week, parsed])
  const parlay = result.parlay
  return <section className="team-parlay" aria-label="Team parlay builder">
    <div className="team-parlay-head"><h2>Team parlay</h2><p>Unstarted games only. Prices are a static getoddy snapshot, not live odds. Spreads are not in that snapshot, so every leg is a moneyline.</p></div>
    <form onSubmit={event => event.preventDefault()}>
      <label>Legs<select value={legs} onChange={event => setLegs(event.target.value)}>{[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Min American<input value={minOdds} onChange={event => setMinOdds(event.target.value)} inputMode="text" /></label>
      <label>Max American<input value={maxOdds} onChange={event => setMaxOdds(event.target.value)} inputMode="text" /></label>
    </form>
    {!parlay ? <p className="team-parlay-empty">{result.reason}</p> : <>
      <p className="team-parlay-summary"><strong>{parlay.priceText}</strong> combined · <strong>{Math.round(parlay.hit * 1000) / 10}%</strong> model hit{parlay.asOf ? ` · snapshot ${parlay.asOf}` : ''}</p>
      <ol>{parlay.legs.map(leg => <li key={leg.gameId}><b>{leg.team}</b> {leg.bet} <span>{leg.price > 0 ? `+${leg.price}` : leg.price}</span> <span>{Math.round(leg.prob * 1000) / 10}% model</span>{leg.asOf ? <small>{leg.source} · {leg.asOf}</small> : <small>{leg.source}</small>}</li>)}</ol>
    </>}
  </section>
}
