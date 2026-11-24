import {useMemo} from 'react'
import {valid} from './model.js'
import {betSignalScore,breakoutRating} from './Bets.jsx'
import {buildFlyerThemes} from './Flyers.jsx'
import './parlays.css'

const fmt=(value,key)=>valid(value)?value.toFixed(key.toLowerCase().includes('td')?2:1):'—'
function boxValue(log,key){
  if(key!=='totalTD')return log[key]
  return valid(log.rushTD)&&valid(log.recTD)?log.rushTD+log.recTD:null
}
function projectionFor(player,key){
  if(key!=='totalTD')return player.stats[key]?.projection
  const rush=player.stats.rushTD?.projection,rec=player.stats.recTD?.projection
  return valid(rush)&&valid(rec)?rush+rec:null
}
function safeOverlapLeg(theme,player,window){
  const betsRaw=betSignalScore(player),betsIndex=breakoutRating(player)
  if(betsRaw<=0||betsIndex==null)return null
  const projection=projectionFor(player,theme.spec.key)
  if(!valid(projection)||projection<theme.threshold)return null
  const observations=player.logs.slice(-window).map(log=>boxValue(log,theme.spec.key)).filter(valid)
  if(observations.length<3)return null
  const playerHits=observations.filter(value=>value>=theme.threshold).length
  if(playerHits===0)return null
  const playerRate=playerHits/observations.length
  const projectionCoverage=Math.min(projection/theme.threshold,1)
  const betsStrength=Math.min(betsRaw/8,1)*.45+Math.min(betsIndex/100,1)*.55
  const concentration=Math.round(100*(theme.rate*.4+betsStrength*.3+projectionCoverage*.15+playerRate*.15))
  return {id:`${theme.offense.id}:${player.id}:${theme.spec.key}`,player,theme,projection,playerHits,
    playerN:observations.length,playerRate,betsIndex,concentration}
}
function combinations(items,size,start=0,prefix=[],result=[]){
  if(prefix.length===size){result.push(prefix);return result}
  for(let i=start;i<=items.length-(size-prefix.length);i++)combinations(items,size,i+1,[...prefix,items[i]],result)
  return result
}
function parlayScore(legs){
  const scores=legs.map(leg=>leg.concentration)
  const weakest=Math.min(...scores),average=scores.reduce((sum,value)=>sum+value,0)/scores.length
  return Math.round(weakest*.65+average*.35)
}
function rankedCombinations(legs,size){
  return combinations(legs,size).filter(combo=>new Set(combo.map(leg=>leg.player.id)).size===size)
    .map(combo=>({id:combo.map(leg=>leg.id).join('|'),legs:combo,score:parlayScore(combo)}))
    .sort((a,b)=>b.score-a.score)
}
function pickDiversified(candidates,count,used=new Set()){
  const selected=[]
  for(const candidate of candidates){
    if(selected.length>=count)break
    const signature=candidate.legs.map(leg=>leg.player.id).sort().join('|')
    if(used.has(signature))continue
    selected.push(candidate);used.add(signature)
  }
  return selected
}
function buildParlays(legs){
  const pool=legs.slice(0,14),used=new Set()
  const three=pickDiversified(rankedCombinations(pool,3),2,used)
  const two=pickDiversified(rankedCombinations(pool,2),2,used)
  const four=pickDiversified(rankedCombinations(pool,4),1,used)
  return [
    ...three.map((parlay,index)=>({...parlay,label:`3-LEG PARLAY ${index+1}`})),
    ...two.map((parlay,index)=>({...parlay,label:`2-LEG PARLAY ${index+1}`})),
    ...four.map(parlay=>({...parlay,label:'4-LEG PARLAY'})),
  ]
}
function Leg({leg}){
  return <li><div><span className="parlay-team">{leg.theme.offense.abbr} · {leg.player.position}</span><strong>{leg.player.name} · {leg.theme.threshold}+ {leg.theme.spec.title.toLowerCase()}</strong></div>
    <div className="parlay-leg-evidence"><span><b>{leg.concentration}/100</b> overlap</span><span>Safe defense: {leg.theme.hits}/{leg.theme.n} ({Math.round(leg.theme.rate*100)}%)</span><span>Player recent: {leg.playerHits}/{leg.playerN} ({Math.round(leg.playerRate*100)}%)</span><span>Player Projection: {fmt(leg.projection,leg.theme.spec.key)}</span><span>Bets index: {leg.betsIndex}/100</span></div></li>
}
export default function Parlays({data,matchup,roster,halfLife,window}){
  const legs=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window)
    .filter(theme=>theme.tier==='Safe')
    .flatMap(theme=>theme.candidates.map(player=>safeOverlapLeg(theme,player,window)).filter(Boolean))
    .sort((a,b)=>b.concentration-a.concentration||b.theme.rate-a.theme.rate),[data,matchup,roster,halfLife,window])
  const parlays=useMemo(()=>buildParlays(legs),[legs])
  return <section className="parlays-section" aria-label="Parlays from Bets and Safe Flyers overlap">
    <div className="prop-section-title"><h3>PARLAYS · highest Safe overlap</h3><span>Bets signals + FLYERS Safe history</span></div>
    <p className="prop-help">Breakout candidates are excluded. FLYERS <b>Safe</b> history narrows the eligible position and stat; the player number comes directly from the same model used in <b>Player Projections</b>. A leg is removed unless that projection reaches the Safe target and the player reached it at least once in three or more recent appearances. Legs are ranked by 40% opponent Safe rate, 30% Bets strength, 15% projection coverage, and 15% the player’s recent Safe hit rate. The score measures model agreement, not a guaranteed win probability.</p>
    {parlays.length<5&&<p className="prop-warning">Only {parlays.length} of the five requested structures have enough distinct qualifying players. Unsupported parlays are not forced.</p>}
    {!!parlays.length&&<div className="parlay-card-grid">{parlays.map((parlay,index)=><article className={`parlay-card ${parlay.legs.length===4?'parlay-card-wide':''}`} key={parlay.id}>
      <header><div><small>{index===0?'TOP SAFE-OVERLAP PICK':'SAFE-OVERLAP PICK'}</small><h4>{parlay.label}</h4></div><strong>{parlay.score}/100</strong></header>
      <ol>{parlay.legs.map(leg=><Leg key={leg.id} leg={leg}/>)}</ol>
      <small className="parlay-disclaimer">Suggested milestones only · confirm player status, line availability, and combined odds with your sportsbook</small>
    </article>)}</div>}
    <section className="overlap-board"><div className="prop-section-title"><h3>Top Safe-overlap legs</h3><span>All qualifying player/stat combinations</span></div>
      {!legs.length?<p className="prop-warning">No individual legs currently satisfy the Bets signal, FLYERS Safe screen, Player Projection target, and recent-hit requirements.</p>:<div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Safe stat</th><th>Overlap</th><th>Safe defense rate</th><th>Player recent</th><th>Player Projection</th><th>Bets index</th></tr></thead><tbody>{legs.map((leg,index)=><tr key={leg.id}><td>#{index+1}</td><td><b>{leg.player.name}</b><small>{leg.theme.offense.abbr} · {leg.player.position}</small></td><td>{leg.theme.threshold}+ {leg.theme.spec.title.toLowerCase()}</td><td><strong>{leg.concentration}/100</strong></td><td>{leg.theme.hits}/{leg.theme.n} · {Math.round(leg.theme.rate*100)}%</td><td>{leg.playerHits}/{leg.playerN} · {Math.round(leg.playerRate*100)}%</td><td>{fmt(leg.projection,leg.theme.spec.key)}</td><td>{leg.betsIndex}/100</td></tr>)}</tbody></table></div>}
    </section>
    <details className="prop-method"><summary>Parlay rules and limitations</summary><p>PARLAYS uses FLYERS Safe results only as a position/stat and opponent-history screen. Player projections are read from the same projectTeam output displayed in Player Projections. A candidate needs at least three valid recent observations, one or more personal hits at the Safe target, a projection at or above that target, and a positive Bets-tab signal. FLYERS Breakout candidates do not enter this calculation. Each parlay requires a different player for every leg. The five target structures are two 3-leg parlays, two 2-leg parlays, and one 4-leg parlay. Combinations are ranked 65% by their weakest leg and 35% by their average overlap so one strong leg cannot conceal a weak one. Adding legs lowers joint win likelihood. The model does not fetch live sportsbook prices or estimate expected value.</p></details>
  </section>
}
