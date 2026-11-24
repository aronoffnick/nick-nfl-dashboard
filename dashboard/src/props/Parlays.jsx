import {useMemo} from 'react'
import {valid} from './model.js'
import {betSignalScore,breakoutRating} from './Bets.jsx'
import {buildFlyerThemes,closestPlayer} from './Flyers.jsx'
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
function overlapLeg(theme,safeTheme,window){
  const player=closestPlayer(theme.candidates,theme,theme.position)
  if(!player)return null
  const betsRaw=betSignalScore(player),betsIndex=breakoutRating(player)
  if(betsRaw<=0||betsIndex==null)return null
  const projection=projectionFor(player,theme.spec.key)
  if(!valid(projection))return null
  const observations=player.logs.slice(-window).map(log=>boxValue(log,theme.spec.key)).filter(valid)
  if(observations.length<3)return null
  const playerHits=observations.filter(value=>value>=theme.threshold).length
  const playerRate=playerHits/observations.length
  const projectionCoverage=Math.min(projection/theme.threshold,1)
  const betsStrength=Math.min(betsRaw/8,1)*.45+Math.min(betsIndex/100,1)*.55
  const safeRate=safeTheme?.rate??theme.rate
  const fixed=betsStrength*.25+projectionCoverage*.2+playerRate*.15
  const safeHeavy=Math.round(100*(fixed+safeRate*.28+theme.rate*.12))
  const breakoutHeavy=Math.round(100*(fixed+safeRate*.1+theme.rate*.3))
  const rangeLow=Math.min(safeHeavy,breakoutHeavy),rangeHigh=Math.max(safeHeavy,breakoutHeavy)
  const concentration=Math.round((rangeLow+rangeHigh)/2)
  return {id:`${theme.offense.id}:${player.id}:${theme.spec.key}`,player,theme,projection,playerHits,
    playerN:observations.length,playerRate,betsRaw,betsIndex,betsStrength,projectionCoverage,safeRate,
    safeHits:safeTheme?.hits??theme.hits,safeN:safeTheme?.n??theme.n,rangeLow,rangeHigh,concentration}
}
function correlation(a,b){
  if(a.theme.offense.id!==b.theme.offense.id)return 'Different offenses; both legs still share overall game script.'
  if(a.player.position==='QB'&&['rec','recYds'].includes(b.theme.spec.key)||b.player.position==='QB'&&['rec','recYds'].includes(a.theme.spec.key))return 'Same-team passing stack; the sportsbook may price positive correlation.'
  return 'Same offense; volume and scoring environment may affect both legs.'
}
function buildParlays(legs){
  const pairs=[]
  for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
    const a=legs[i],b=legs[j]
    if(a.player.id===b.player.id)continue
    const lowWeakest=Math.min(a.rangeLow,b.rangeLow),lowAverage=(a.rangeLow+b.rangeLow)/2
    const highWeakest=Math.min(a.rangeHigh,b.rangeHigh),highAverage=(a.rangeHigh+b.rangeHigh)/2
    const rangeLow=Math.round(lowWeakest*.7+lowAverage*.3),rangeHigh=Math.round(highWeakest*.7+highAverage*.3)
    pairs.push({id:`${a.id}|${b.id}`,legs:[a,b],rangeLow,rangeHigh,score:(rangeLow+rangeHigh)/2,note:correlation(a,b)})
  }
  return pairs.sort((a,b)=>b.score-a.score).slice(0,3)
}
function Leg({leg}){
  return <li><div><span className="parlay-team">{leg.theme.offense.abbr} · {leg.player.position}</span><strong>{leg.player.name} · {leg.theme.threshold}+ {leg.theme.spec.title.toLowerCase()}</strong></div>
    <div className="parlay-leg-evidence"><span><b>{leg.rangeLow}–{leg.rangeHigh}</b>/100 overlap range</span><span>Breakout: {leg.theme.hits}/{leg.theme.n} ({Math.round(leg.theme.rate*100)}%)</span><span>Safe foundation: {leg.safeHits}/{leg.safeN} ({Math.round(leg.safeRate*100)}%)</span><span>Player: {leg.playerHits}/{leg.playerN} recent</span><span>Projection: {fmt(leg.projection,leg.theme.spec.key)}</span></div></li>
}
export default function Parlays({data,matchup,roster,halfLife,window}){
  const legs=useMemo(()=>{
    const themes=buildFlyerThemes(data,matchup,roster,halfLife,window)
    const safeByStat=new Map(themes.filter(theme=>theme.tier==='Safe').map(theme=>[`${theme.offense.id}:${theme.position}:${theme.spec.key}`,theme]))
    return themes.filter(theme=>theme.tier==='Breakout')
      .map(theme=>overlapLeg(theme,safeByStat.get(`${theme.offense.id}:${theme.position}:${theme.spec.key}`),window)).filter(Boolean)
      .sort((a,b)=>b.rangeLow-a.rangeLow||b.rangeHigh-a.rangeHigh||b.theme.rate-a.theme.rate)
  },[data,matchup,roster,halfLife,window])
  const parlays=useMemo(()=>buildParlays(legs),[legs])
  return <section className="parlays-section" aria-label="Parlays from Bets and Flyers overlap">
    <div className="prop-section-title"><h3>PARLAYS · highest overlap</h3><span>Bets signals + FLYERS Breakout themes</span></div>
    <p className="prop-help">Only FLYERS <b>Breakout</b> thresholds are eligible. Every leg must also have a positive Bets signal and a usable player projection. The displayed range recalculates the same candidate under two fixed views: a Safe-foundation-heavy view and a Breakout-heavy view. Bets strength contributes 25%, projection coverage 20%, and the player’s recent Breakout hit rate 15% in both views. This is a concentration range, not a win-probability interval.</p>
    {!parlays.length?<p className="prop-warning">Fewer than two different players currently meet both the Bets and FLYERS Breakout requirements. No parlay is forced.</p>:<div className="parlay-card-grid">{parlays.map((parlay,index)=><article className="parlay-card" key={parlay.id}>
      <header><div><small>{index===0?'TOP OVERLAP PARLAY':`ALTERNATE ${index}`}</small><h4>2-leg Breakout parlay</h4></div><strong>{parlay.rangeLow}–{parlay.rangeHigh}/100</strong></header>
      <ol>{parlay.legs.map(leg=><Leg key={leg.id} leg={leg}/>)}</ol>
      <p>{parlay.note}</p><small className="parlay-disclaimer">Suggested milestones only · confirm availability and combined odds with your sportsbook</small>
    </article>)}</div>}
    <section className="overlap-board"><div className="prop-section-title"><h3>Top overlap legs</h3><span>All qualifying player/stat combinations</span></div>
      {!legs.length?<p className="prop-warning">No individual legs currently satisfy both models.</p>:<div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Breakout stat</th><th>Overlap range</th><th>Breakout rate</th><th>Safe foundation</th><th>Player recent</th><th>Projection</th><th>Bets index</th></tr></thead><tbody>{legs.map((leg,index)=><tr key={leg.id}><td>#{index+1}</td><td><b>{leg.player.name}</b><small>{leg.theme.offense.abbr} · {leg.player.position}</small></td><td>{leg.theme.threshold}+ {leg.theme.spec.title.toLowerCase()}</td><td><strong>{leg.rangeLow}–{leg.rangeHigh}/100</strong></td><td>{leg.theme.hits}/{leg.theme.n} · {Math.round(leg.theme.rate*100)}%</td><td>{leg.safeHits}/{leg.safeN} · {Math.round(leg.safeRate*100)}%</td><td>{leg.playerHits}/{leg.playerN}</td><td>{fmt(leg.projection,leg.theme.spec.key)}</td><td>{leg.betsIndex}/100</td></tr>)}</tbody></table></div>}
    </section>
    <details className="prop-method"><summary>Parlay rules and limitations</summary><p>The low and high values are the two weighting outcomes, sorted numerically; they are not statistical confidence bounds. The Safe-heavy view allocates the 40% FLYERS component as 28% Safe and 12% Breakout. The Breakout-heavy view allocates it as 10% Safe and 30% Breakout. Each two-leg parlay uses two different players. A player/stat pair must map to a FLYERS Breakout threshold, have at least three valid recent player observations, a current projection, and a positive Bets-tab signal. Pairs are ranked primarily by the lower end and the weaker leg so one strong leg cannot hide a weak one. The model does not estimate joint probability or expected value and does not fetch live sportsbook prices.</p></details>
  </section>
}
