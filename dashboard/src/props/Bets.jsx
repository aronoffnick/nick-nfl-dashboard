import { useMemo } from 'react'
import { projectTeam, valid } from './model.js'
import {sameGameFavorite} from './sgp.js'
import {SGPCard} from './WeeklySGPs.jsx'

const average = (games,key) => games.length && games.every(game=>valid(game[key]))
  ? games.reduce((sum,game)=>sum+game[key],0)/games.length : null
function totalTD(game,position){
  const keys=position==='QB'?['rushTD']:['rushTD','recTD']
  return keys.every(key=>valid(game[key]))?keys.reduce((total,key)=>total+game[key],0):null
}
export function betSignalScore(player){
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const now=average(player.logs.slice(-3),usageKey),before=average(player.logs.slice(-6,-3),usageKey)
  const stat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const outputNow=average(player.logs.slice(-3),stat),outputBefore=average(player.logs.slice(-6,-3),stat)
  const rising=valid(now)&&valid(before)&&before>0&&now>=before*1.15
  const momentum=valid(outputNow)&&valid(outputBefore)&&outputBefore>0&&outputNow>=outputBefore*1.15
  const bounce=valid(now)&&valid(before)&&before>0&&now>=before*.9&&valid(outputNow)&&valid(outputBefore)&&outputBefore>0&&outputNow<=outputBefore*.8
  const defense=player.stats[stat]?.defense
  const favorable=defense?.adjusted&&defense.factor>=1.05
  const td=player.logs.slice(-4).some(g=>totalTD(g,player.position)>=1)
  return (rising?2:0)+(momentum?2:0)+(bounce?1:0)+(favorable?2:0)+(td?1:0)
}
export default function Bets({ data, matchup, roster, halfLife, window }) {
  const players=useMemo(()=>[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([offense,opponent])=>projectTeam(data,offense,opponent,roster,halfLife,window).map(player=>({...player,offense,opponent}))),[data,matchup,roster,halfLife,window])
  const favorite=sameGameFavorite(data,matchup,roster,halfLife,window,Date.now(),players.map(p=>({...p,team:p.offense,opponent:p.opponent})))
  return <section aria-label="Bets">
    <div className="prop-section-title"><h3>Favorite 2-leg parlay</h3><span>Two different players · matchup-specific</span></div>
    {favorite.pair?<SGPCard pair={favorite.pair} matchup={matchup}/>:<p className="prop-warning">No 2-leg favorite is shown: {favorite.reason} The model skips a parlay when recent history or quarterback availability does not meet its checks.</p>}
    <p className="prop-help">The parlay uses separate-player milestones with recent hit-rate and projection-cushion checks. These are model-selected ideas, not sportsbook lines or guaranteed probabilities.</p>
    <details className="bet-notes"><summary>Other bet notes</summary><p>{matchup.margin<.05?'Team model is a toss-up.':`Team lean: ${matchup.winner.abbr} by ${matchup.margin.toFixed(1)}.`} Sportsbook prices are unavailable. Enter lines in the projections tab; no sportsbook feed is connected.</p></details>
  </section>
}
