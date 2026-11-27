import { useMemo } from 'react'
import { betSignalScore, boardFor } from './gameBoard.js'
import {sameGameFavorite} from './sgp.js'
import {SGPCard} from './WeeklySGPs.jsx'

export { betSignalScore }
export default function Bets({ data, matchup, roster, halfLife, window }) {
  const players=useMemo(()=>boardFor(data, matchup, roster, halfLife, window).players,[data,matchup,roster,halfLife,window])
  const favorite=sameGameFavorite(data,matchup,roster,halfLife,window,Date.now(),players.map(p=>({...p,team:p.offense,opponent:p.opponent})))
  return <section aria-label="Bets">
    <div className="prop-section-title"><h3>Favorite 2-leg parlay</h3><span>Two different players · matchup-specific</span></div>
    {favorite.pair?<SGPCard pair={favorite.pair} matchup={matchup}/>:<p className="prop-warning">No 2-leg favorite is shown: {favorite.reason} The model skips a parlay when season history or quarterback availability does not meet its checks.</p>}
    <p className="prop-help">The parlay uses separate-player milestones with season-weighted hit rates and projection-cushion checks. These are model-selected ideas, not sportsbook lines or guaranteed probabilities.</p>
    <details className="bet-notes"><summary>Other bet notes</summary><p>{matchup.margin<.05?'Team model is a toss-up.':`Team lean: ${matchup.winner.abbr} by ${matchup.margin.toFixed(1)}.`} Sportsbook prices are unavailable. Enter lines in the projections tab; no sportsbook feed is connected.</p></details>
  </section>
}
