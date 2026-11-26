import {useMemo} from 'react'
import {valid} from './model.js'
import {betSignalScore} from './Bets.jsx'
import {breakoutRating} from './breakout.js'
import {buildFlyerThemes,rateAtLine} from './Flyers.jsx'
import {fileForWeek} from '../data/weekFiles.js'
import {decideScatterLine, scatterProjection} from './scatterCheck.js'
import {boardGame,fileCards,normName,pctText,tableConflict} from './parlayBoard.js'
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
function scoreLeg(theme,player,projection,observations,line,betsRaw,betsIndex){
  const playerHits=observations.filter(value=>value>=line).length
  const playerRate=playerHits/observations.length
  const projectionCoverage=Math.min(projection/line,1)
  const betsStrength=Math.min(betsRaw/8,1)*.45+Math.min(betsIndex/100,1)*.55
  const concentration=Math.round(100*(theme.rate*.4+betsStrength*.3+projectionCoverage*.15+playerRate*.15))
  return {playerHits,playerN:observations.length,playerRate,concentration}
}
function safeOverlapLeg(theme,player,window,scatterGames,awayAbbr,homeAbbr){
  const betsRaw=betSignalScore(player),betsIndex=breakoutRating(player)
  if(betsRaw<=0||betsIndex==null)return null
  const projection=projectionFor(player,theme.spec.key)
  const safeLine=theme.threshold
  if(!valid(projection)||projection<safeLine)return null
  const observations=player.logs.slice(-window).map(log=>boxValue(log,theme.spec.key)).filter(valid)
  if(observations.length<3)return null
  if(!observations.some(value=>value>=safeLine))return null
  const scatter=scatterProjection(scatterGames,{awayAbbr,homeAbbr,playerName:player.name,statKey:theme.spec.key})
  const decision=decideScatterLine({line:safeLine,statKey:theme.spec.key,projection:scatter,liveProjection:projection})
  const label=`${player.name} · ${safeLine}+ ${theme.spec.title.toLowerCase()}`
  if(decision.action==='remove')return {removed:true,decision,label}
  const prior=scoreLeg(theme,player,projection,observations,safeLine,betsRaw,betsIndex)
  const priorDefense={hits:theme.hits,n:theme.n,rate:theme.rate}
  const rated={...theme,...rateAtLine(theme,decision.line)}
  const scored=scoreLeg(rated,player,projection,observations,decision.line,betsRaw,betsIndex)
  return {removed:false,decision,prior,priorDefense,leg:{id:`${theme.offense.id}:${player.id}:${theme.spec.key}`,player,theme:rated,safeLine,line:decision.line,projection,scatter,betsIndex,scatterMark:decision.mark,scatterFlag:decision.flag||null,prior,priorDefense,...scored}}
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
  return <li><div><span className="parlay-team">{leg.theme.offense.abbr} · {leg.player.position}</span><strong>{leg.player.name} · {leg.line}+ {leg.theme.spec.title.toLowerCase()}</strong>{leg.scatterFlag?<em className="scatter-flag">{leg.scatterFlag}</em>:null}</div>
    <div className="parlay-leg-evidence"><span><b>{leg.concentration}/100</b> overlap</span><span>Safe defense: {leg.theme.hits}/{leg.theme.n} ({Math.round(leg.theme.rate*100)}%)</span><span>Player recent: {leg.playerHits}/{leg.playerN} ({Math.round(leg.playerRate*100)}%)</span><span>Player Projection: {fmt(leg.projection,leg.theme.spec.key)}</span><span>Bets index: {leg.betsIndex}/100</span><small className="scatter-mark">{leg.scatterMark}</small></div></li>
}
// Card leg from the game-day file (parlays-wkN.json): Week matchup model line, getoddy snapshot price.
function FileLeg({leg,conflict}){
  return <li><div><span className="parlay-team">{leg.team} · {leg.pos}</span><strong>{leg.card_label}</strong>{!leg.priced?<em className="scatter-flag">No snapshot price at this line{leg.flags?` · ${leg.flags}`:''}</em>:leg.flags?<em className="scatter-flag">{leg.flags}</em>:null}{conflict?<em className="scatter-flag">Same player is an over in the Safe-overlap table below</em>:null}</div>
    <div className="parlay-leg-evidence"><span><b>{leg.rating}/100</b> model</span><span>Snapshot: {leg.price_str}</span><span>Player recent: {leg.season}</span><span>Model projection: {leg.center} {leg.center_kind}</span><span>Market implied: {pctText(leg.market_p)}</span><small className="scatter-mark">Model line{leg.confidence?` · ${leg.confidence}`:''}{leg.model_edge_pct!=null?` · projection ${leg.model_edge_pct}% past the line`:''}{leg.asof?` · as of ${leg.asof}`:''}</small></div></li>
}
export default function Parlays({data,matchup,roster,halfLife,window}){
  const game=useMemo(()=>boardGame(fileForWeek('parlays',data.week),matchup.away.abbr,matchup.home.abbr),[data.week,matchup.away.abbr,matchup.home.abbr])
  const reviewed=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window)
    .filter(theme=>theme.tier==='Safe')
    .flatMap(theme=>theme.candidates.map(player=>safeOverlapLeg(theme,player,window,fileForWeek('scatter',data.week).data?.games,matchup.away.abbr,matchup.home.abbr)).filter(Boolean)),[data,matchup,roster,halfLife,window])
  const legs=useMemo(()=>reviewed.filter(item=>item.leg).map(item=>item.leg).sort((a,b)=>b.concentration-a.concentration||b.theme.rate-a.theme.rate),[reviewed])
  // Cards: the game-day file when it has this game; otherwise the live Safe-overlap legs without TD scorers.
  const parlays=useMemo(()=>game?fileCards(game):buildParlays(legs.filter(leg=>leg.theme.spec.key!=='totalTD')),[game,legs])
  const tableNames=useMemo(()=>new Set(legs.map(leg=>normName(leg.player.name))),[legs])
  const scatterGroups={
    pass:reviewed.filter(item=>item.decision.kind==='pass'),
    bump:reviewed.filter(item=>item.decision.kind==='bump'),
    changed:reviewed.filter(item=>item.decision.kind==='changed'),
    removed:reviewed.filter(item=>item.decision.kind==='removed'),
    skipped:reviewed.filter(item=>item.decision.kind==='skipped'),
    'no-data':reviewed.filter(item=>item.decision.kind==='no-data'),
  }
  return <><section className="parlays-section" aria-label="Parlays from Bets and Safe Flyers overlap">
    <div className="prop-section-title"><h3>PARLAYS · highest Safe overlap</h3><span>{game?`Week ${data.week} matchup model lines + getoddy snapshot ${game.snapshot?.props_asof||''}`:'Bets signals + FLYERS Safe history'}</span></div>
    {game&&<p className="prop-help">The cards use player props only, at the Week {data.week} matchup model’s own lines (the main line the model projected against) on the side the model favors. No touchdown scorers, no alternate lines, a different player on every leg, and a player never appears on both sides: when the model has a player on both an over and an under, only the side with the higher model hit chance stays, and a player shown as an over in the Safe-overlap table below never gets an under. The rating is the model hit chance; the card score blends 65% weakest leg and 35% average. Prices are the best price across books in a saved getoddy.com snapshot, not live odds; a leg with no snapshot price at the model line is flagged and the card shows no payout. The table below is unchanged and still uses the rules that follow.</p>}
    <p className="prop-help">Breakout candidates are excluded. FLYERS <b>Safe</b> history narrows the eligible position and stat; the player number comes directly from the same model used in <b>Player Projections</b>. A leg is removed unless that projection reaches the Safe target and the player reached it at least once in three or more recent appearances. Each kept non-touchdown leg is then checked against the Week 12 scatter projection. Touchdown legs stay on the Safe line and are marked skipped. When scatter covers the Safe line, the leg moves up to the live projection (rounded to the nearest 0.5) and is never lowered on that pass. Role eligibility runs before this check. Legs are ranked by 40% opponent hit rate at the line shown, 30% Bets strength, 15% projection coverage, and 15% the player’s recent hit rate at that line. The score measures model agreement, not a guaranteed win probability.</p>
    <details className="scatter-check">
      <summary className="prop-section-title"><span><h3>Scatter cross-check</h3><span>Week 12 projection vs the Safe line</span></span><span className="scatter-chevron" aria-hidden="true"/></summary>
      {[['pass','Passed'],['bump','Bumped'],['changed','Lowered'],['removed','Removed'],['skipped','Skipped'],['no-data','No scatter data']].map(([kind,title])=><div key={kind}><h4>{title}</h4>{scatterGroups[kind].length?<ul>{scatterGroups[kind].map(item=><li key={item.leg?.id||item.label}>{item.leg?`${item.leg.player.name} · ${item.leg.line}+ ${item.leg.theme.spec.title.toLowerCase()}`:item.label} — {item.decision.mark}{item.leg?` · player ${item.prior.playerHits}/${item.prior.playerN} -> ${item.leg.playerHits}/${item.leg.playerN} · defense ${item.priorDefense.hits}/${item.priorDefense.n} -> ${item.leg.theme.hits}/${item.leg.theme.n} · ${item.leg.concentration}/100`:''}</li>)}</ul>:<p>None</p>}</div>)}
    </details>
    {game&&!!game.dropped?.length&&<details className="scatter-check"><summary className="prop-section-title"><span><h3>Legs left out</h3><span>Same-player conflicts, missing prices and line rules</span></span><span className="scatter-chevron" aria-hidden="true"/></summary><ul>{game.dropped.map(item=><li key={item.label+item.reason}>{item.label} — {item.reason}</li>)}</ul></details>}
    {!game&&<p className="prop-warning">No saved odds snapshot for this game yet, so the cards use the live Safe-overlap legs with touchdown scorers left out.</p>}
    {parlays.length<5&&<p className="prop-warning">Only {parlays.length} of the five requested structures have enough distinct qualifying players. Unsupported parlays are not forced.</p>}
    {!!parlays.length&&<div className="parlay-card-grid">{parlays.map((parlay,index)=><article className={`parlay-card ${parlay.legs.length===4?'parlay-card-wide':''}`} key={parlay.id}>
      <header><div><small>{index===0?'TOP SAFE-OVERLAP PICK':'SAFE-OVERLAP PICK'}</small><h4>{parlay.label}</h4></div><strong>{parlay.score}/100</strong></header>
      <ol>{parlay.legs.map(leg=>game?<FileLeg key={leg.id} leg={leg} conflict={tableConflict(leg,tableNames)}/>:<Leg key={leg.id} leg={leg}/>)}</ol>
      {game&&<small className="parlay-disclaimer">Est. combined {pctText(parlay.combined)} with same-team correlation ({pctText(parlay.independent)} if independent){parlay.payout?` · snapshot payout ${parlay.payout} multiplies the leg prices; a real same-game parlay pays less`:' · no payout: a leg has no snapshot price'}</small>}
      <small className="parlay-disclaimer">Suggested milestones only · confirm player status, line availability, and combined odds with your sportsbook</small>
    </article>)}</div>}
    <section className="overlap-board"><div className="prop-section-title"><h3>Top Safe-overlap legs</h3><span>All qualifying player/stat combinations</span></div>
      {!legs.length?<p className="prop-warning">No individual legs currently satisfy the Bets signal, FLYERS Safe screen, Player Projection target, and recent-hit requirements.</p>:<div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Safe stat</th><th>Overlap</th><th>Safe defense rate</th><th>Player recent</th><th>Player Projection</th><th>Bets index</th></tr></thead><tbody>{legs.map((leg,index)=><tr key={leg.id}><td>#{index+1}</td><td><b>{leg.player.name}</b><small>{leg.theme.offense.abbr} · {leg.player.position}</small></td><td>{leg.line}+ {leg.theme.spec.title.toLowerCase()}<small className="scatter-mark">{leg.scatterMark}</small></td><td><strong>{leg.concentration}/100</strong></td><td>{leg.theme.hits}/{leg.theme.n} · {Math.round(leg.theme.rate*100)}%</td><td>{leg.playerHits}/{leg.playerN} · {Math.round(leg.playerRate*100)}%</td><td>{fmt(leg.projection,leg.theme.spec.key)}</td><td>{leg.betsIndex}/100</td></tr>)}</tbody></table></div>}
    </section>
    <details className="prop-method"><summary>Parlay rules and limitations</summary><p>PARLAYS uses FLYERS Safe results only as a position/stat and opponent-history screen. Player projections are read from the same projectTeam output displayed in Player Projections. A candidate needs at least three valid recent observations, one or more personal hits at the Safe target, a projection at or above that target, and a positive Bets-tab signal. FLYERS Breakout candidates do not enter this calculation. Each parlay requires a different player for every leg. The five target structures are two 3-leg parlays, two 2-leg parlays, and one 4-leg parlay. Combinations are ranked 65% by their weakest leg and 35% by their average overlap so one strong leg cannot conceal a weak one. Adding legs lowers joint win likelihood. The model does not fetch live sportsbook prices or estimate expected value.</p></details>
  </section>
  </>
}
