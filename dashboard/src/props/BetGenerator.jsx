import { useMemo, useState } from 'react'
import { boardGame, pctText } from './parlayBoard.js'
import { generateBets, POSITIONS } from './betGenerator.js'
import { scatterAbbrev } from './scatterCheck.js'
import { fileForWeek } from '../data/weekFiles.js'
import './betGenerator.css'

function LegRow({ leg }) {
  return <li>
    <div><span className="parlay-team">{leg.team} · {leg.pos}</span><strong>{leg.card_label}</strong></div>
    <div className="parlay-leg-evidence">
      <span><b>{leg.rating}/100</b> model</span>
      <span>Best price: {leg.price_str}</span>
      <span>{leg.kind === 'ml' ? `Record: ${leg.season}` : `Season: ${leg.season}`}</span>
      <span>Market implied: {pctText(leg.market_p)}</span>
      <small className="scatter-mark">{leg.kind === 'prop' ? `Week matchup model line · projection ${leg.center} ${leg.center_kind || ''}` : leg.kind === 'td' ? `Anytime TD · ${leg.center} exp. TDs` : 'Dashboard team margin → win chance'}{leg.asof ? ` · snapshot ${leg.asof}` : ''}</small>
    </div>
  </li>
}

export default function BetGenerator({ matchup, week }) {
  const away = scatterAbbrev(matchup.away.abbr), home = scatterAbbrev(matchup.home.abbr)
  const game = useMemo(() => boardGame(fileForWeek('parlays', week), matchup.away.abbr, matchup.home.abbr), [week, matchup.away.abbr, matchup.home.abbr])
  const [legs, setLegs] = useState(2)
  const [team, setTeam] = useState(home)
  const [both, setBoth] = useState(true)
  const [position, setPosition] = useState('All positions')
  const [includeTD, setIncludeTD] = useState(false)
  const [minOdds, setMinOdds] = useState('')
  const [maxOdds, setMaxOdds] = useState('')
  const [output, setOutput] = useState(null)
  const teamName = abbr => abbr === away ? matchup.away.name : abbr === home ? matchup.home.name : abbr
  if (!game) return <section className="bet-generator" aria-label="Bet generator">
    <div className="prop-section-title"><h3>Bet generator</h3><span>Model picks + saved odds snapshot</span></div>
    <p className="prop-warning">No saved odds snapshot for this game yet. The game-day refresh adds it; the generator never invents prices.</p>
  </section>
  const run = () => setOutput({ opts: { legs, teams: both ? [away, home] : [team], position, includeTD, minOdds, maxOdds }, ...generateBets(game, { legs, teams: both ? [away, home] : [team], position, includeTD, minOdds, maxOdds }) })
  return <section className="bet-generator" aria-label="Bet generator">
    <div className="prop-section-title"><h3>Bet generator</h3><span>Model picks + getoddy snapshot {game.snapshot?.props_asof || ''}</span></div>
    <form className="bet-generator-form" onSubmit={event => { event.preventDefault(); run() }}>
      <label>Legs<select value={legs} onChange={event => setLegs(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Team<select value={team} disabled={both} onChange={event => setTeam(event.target.value)}>{[away, home].map(abbr => <option key={abbr} value={abbr}>{teamName(abbr)}</option>)}</select></label>
      <label className="bet-generator-check"><input type="checkbox" checked={both} onChange={event => setBoth(event.target.checked)} />Include both teams</label>
      <label>Position<select value={position} onChange={event => setPosition(event.target.value)}>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
      <label>Min odds<input inputMode="numeric" placeholder="e.g. +200" value={minOdds} onChange={event => setMinOdds(event.target.value)} /></label>
      <label>Max odds<input inputMode="numeric" placeholder="e.g. +600" value={maxOdds} onChange={event => setMaxOdds(event.target.value)} /></label>
      <label className="bet-generator-check"><input type="checkbox" checked={includeTD} onChange={event => setIncludeTD(event.target.checked)} />Include TD scorers</label>
      <button type="submit">Generate</button>
    </form>
    <p className="prop-help">Legs come from the same pool as the Parlays tab: player props at the Week {week} matchup model’s own lines on the side the model favors, team moneylines (all positions only), and anytime TD scorers only when you tick the box. One leg per player, one moneyline at most, and a player never appears on both sides. Prices are the best price across books in a saved getoddy.com snapshot, not live odds; legs with no snapshot price at the model line are left out. Results are ranked by the model hit chances multiplied together. Odds range filters the combined price.</p>
    {output && <div className="bet-generator-results">
      {output.error && <p className="prop-warning">{output.error}</p>}
      {!output.error && !output.results.length && <p className="prop-warning">No {output.opts.legs}-leg combination fits these filters ({output.pool} priced legs available).</p>}
      {!!output.results.length && <div className="parlay-card-grid">{output.results.map((result, index) => <article className="parlay-card" key={result.legs.map(leg => leg.id).join('|')}>
        <header><div><small>{index === 0 ? 'TOP GENERATED PICK' : `GENERATED PICK ${index + 1}`}</small><h4>{result.legs.length}-LEG {result.legs.length === 1 ? 'BET' : 'PARLAY'} · {result.payout}</h4></div><strong>{pctText(result.hit)}</strong></header>
        <ol>{result.legs.map(leg => <LegRow key={leg.id} leg={leg} />)}</ol>
        <small className="parlay-disclaimer">Model hit chance {pctText(result.hit)} with legs multiplied as if independent{result.adjusted != null && result.legs.length > 1 ? `, ${pctText(result.adjusted)} with same-team correlation` : ''}. Combined price {result.payout} multiplies the snapshot leg prices (implied {pctText(result.implied)}); a real same-game parlay pays less. Estimates only, entertainment, not advice.</small>
      </article>)}</div>}
      <p className="bet-generator-excluded">Left out: {output.excluded.unpriced} legs with no snapshot price at the model line{output.opts.includeTD ? '' : `, ${output.excluded.td} TD scorer legs (box unticked)`}.</p>
    </div>}
  </section>
}
