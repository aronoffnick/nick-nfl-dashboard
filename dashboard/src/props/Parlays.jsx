import {useMemo} from 'react'
import {valid,sampleRows,isSeasonWindow,weightedShare} from './model.js'
import {betSignalScore} from './Bets.jsx'
import {breakoutRating} from './breakout.js'
import {buildFlyerThemes,rateAtLine} from './Flyers.jsx'
import {fileForWeek} from '../data/weekFiles.js'
import {decideScatterLine,scatterAbbrev,scatterProjection} from './scatterCheck.js'
import {boardGame,filePropCandidates,legHit,uniqueProps} from './parlayBoard.js'
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
function scoreLeg(theme,player,projection,observations,line,betsRaw,betsIndex,weightedRate){
  const playerHits=observations.filter(value=>value>=line).length
  const playerRate=weightedRate==null?playerHits/observations.length:weightedRate
  const projectionCoverage=Math.min(projection/line,1)
  const betsStrength=Math.min(betsRaw/8,1)*.45+Math.min(betsIndex/100,1)*.55
  const concentration=Math.round(100*(theme.rate*.4+betsStrength*.3+projectionCoverage*.15+playerRate*.15))
  return {playerHits,playerN:observations.length,playerRate,concentration}
}
function safeOverlapLeg(theme,player,window,scatterGames,awayAbbr,homeAbbr,halfLife){
  const betsRaw=betSignalScore(player,halfLife),betsIndex=breakoutRating(player)
  if(betsRaw<=0||betsIndex==null)return null
  const projection=projectionFor(player,theme.spec.key)
  const safeLine=theme.threshold
  if(!valid(projection)||projection<safeLine)return null
  const rows=sampleRows(player.logs,window)
  const observations=rows.map(log=>boxValue(log,theme.spec.key)).filter(valid)
  if(observations.length<3)return null
  if(!observations.some(value=>value>=safeLine))return null
  const rateAt=line=>weightedShare(rows,halfLife,log=>{const value=boxValue(log,theme.spec.key);return valid(value)?value>=line:null}).rate
  const scatter=scatterProjection(scatterGames,{awayAbbr,homeAbbr,playerName:player.name,statKey:theme.spec.key})
  const decision=decideScatterLine({line:safeLine,statKey:theme.spec.key,projection:scatter,liveProjection:projection})
  const label=`${player.name} · ${safeLine}+ ${theme.spec.title.toLowerCase()}`
  if(decision.action==='remove')return {removed:true,decision,label}
  const prior=scoreLeg(theme,player,projection,observations,safeLine,betsRaw,betsIndex,rateAt(safeLine))
  const priorDefense={hits:theme.hits,n:theme.n,rate:theme.rate}
  const rated={...theme,...rateAtLine(theme,decision.line)}
  const scored=scoreLeg(rated,player,projection,observations,decision.line,betsRaw,betsIndex,rateAt(decision.line))
  return {removed:false,decision,prior,priorDefense,leg:{id:`${theme.offense.id}:${player.id}:${theme.spec.key}`,player,theme:rated,safeLine,line:decision.line,projection,scatter,betsIndex,scatterMark:decision.mark,scatterFlag:decision.flag||null,prior,priorDefense,...scored}}
}
function teamSide(matchup,abbr){
  const key=scatterAbbrev(abbr)
  if(scatterAbbrev(matchup.away.abbr)===key)return matchup.away
  if(scatterAbbrev(matchup.home.abbr)===key)return matchup.home
  return {abbr,logo:null}
}
function lineLabel(leg){
  if(typeof leg.player==='string')return `${leg.side} ${leg.line}`
  return `${leg.line}+`
}
function PropRow({leg,matchup,gameLabel,scope}){
  const file=typeof leg.player==='string'
  const name=file?leg.player:leg.player.name
  const pos=file?leg.pos:leg.player.position
  const abbr=file?leg.team:leg.theme.offense.abbr
  const team=teamSide(matchup,abbr)
  const prop=file?leg.market:leg.theme.spec.title
  const hit=legHit(leg)
  const pct=hit==null?null:Math.round(hit*100)
  const note=file?(leg.confidence?`hit chance · ${leg.confidence}`:'hit chance'):'overlap'
  return <li className="parlay-leg-card">
    {team.logo?<img className="parlay-leg-logo" src={team.logo} alt=""/>:<span className="parlay-leg-logo parlay-leg-logo-fallback" aria-hidden="true">{abbr}</span>}
    <div className="parlay-leg-copy">
      <span className="parlay-team">{abbr} · {pos}</span>
      <strong>{name}</strong>
      <span className="parlay-leg-prop">{prop} · {lineLabel(leg)}</span>
      <span className="parlay-leg-game">{gameLabel}</span>
      {file?<small className="scatter-mark">{[leg.season,leg.price_str,leg.flags].filter(Boolean).join(' · ')}</small>:<>
        <small className="scatter-mark">Safe defense {leg.theme.hits}/{leg.theme.n} ({Math.round(leg.theme.rate*100)}%) · {scope} {leg.playerHits}/{leg.playerN} ({Math.round(leg.playerRate*100)}% weighted) · projection {fmt(leg.projection,leg.theme.spec.key)}</small>
        {leg.scatterFlag?<em className="scatter-flag">{leg.scatterFlag}</em>:null}
      </>}
    </div>
    <div className="parlay-confidence" role="img" aria-label={pct==null?`No hit chance for ${name}`:`${pct}% ${note} for ${name}`}>
      <strong>{pct==null?'—':`${pct}%`}</strong>
      <span className="parlay-confidence-bar" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,pct??0))}%`}}/></span>
      <small>{note}</small>
    </div>
  </li>
}
export default function Parlays({data,matchup,roster,halfLife,window}){
  const game=useMemo(()=>boardGame(fileForWeek('parlays',data.week),matchup.away.abbr,matchup.home.abbr),[data.week,matchup.away.abbr,matchup.home.abbr])
  const reviewed=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window)
    .filter(theme=>theme.tier==='Safe')
    .flatMap(theme=>theme.candidates.map(player=>safeOverlapLeg(theme,player,window,fileForWeek('scatter',data.week).data?.games,matchup.away.abbr,matchup.home.abbr,halfLife)).filter(Boolean)),[data,matchup,roster,halfLife,window])
  const legs=useMemo(()=>reviewed.filter(item=>item.leg).map(item=>item.leg).sort((a,b)=>b.concentration-a.concentration||b.theme.rate-a.theme.rate),[reviewed])
  // One row per player + stat + line. The week file's prop pool when this game is in it; otherwise the live Safe-overlap legs.
  const candidates=useMemo(()=>game?filePropCandidates(game):uniqueProps(legs),[game,legs])
  const gameLabel=`${matchup.away.abbr} at ${matchup.home.abbr}`
  const scope=isSeasonWindow(window)?'season':'recent'
  const scatterGroups={
    pass:reviewed.filter(item=>item.decision.kind==='pass'),
    bump:reviewed.filter(item=>item.decision.kind==='bump'),
    changed:reviewed.filter(item=>item.decision.kind==='changed'),
    removed:reviewed.filter(item=>item.decision.kind==='removed'),
    skipped:reviewed.filter(item=>item.decision.kind==='skipped'),
    'no-data':reviewed.filter(item=>item.decision.kind==='no-data'),
  }
  return <><section className="parlays-section" aria-label="Candidate props ranked by hit chance">
    <div className="prop-section-title"><h3>Props · ranked by hit chance</h3><span>{game?`Week ${data.week} matchup model lines${game.snapshot?.props_asof?` · snapshot ${game.snapshot.props_asof}`:''}`:'Bets signals + FLYERS Safe history'}</span></div>
    <p className="prop-help">{game
      ? `Each player, stat, and line from the Week ${data.week} file is listed once, highest model hit chance first. That chance is the shrunk rate of recent games on this side of the line, the same number the parlay builder stored as the leg rating. If both sides of one line are present, the higher chance is kept. Prices are a saved snapshot, not live odds.`
      : `Each Safe-overlap leg is listed once. The bar is the overlap score: 40% opponent hit rate at the line, 30% Bets strength, 15% projection coverage, and 15% the player’s half-life-weighted ${scope} hit rate. It measures model agreement, not a guaranteed win probability.`}</p>
    <details className="scatter-check">
      <summary className="prop-section-title"><span><h3>Scatter cross-check</h3><span>Week {data.week} projection vs the Safe line</span></span><span className="scatter-chevron" aria-hidden="true"/></summary>
      {[['pass','Passed'],['bump','Bumped'],['changed','Lowered'],['removed','Removed'],['skipped','Skipped'],['no-data','No scatter data']].map(([kind,title])=><div key={kind}><h4>{title}</h4>{scatterGroups[kind].length?<ul>{scatterGroups[kind].map(item=><li key={item.leg?.id||item.label}>{item.leg?`${item.leg.player.name} · ${item.leg.line}+ ${item.leg.theme.spec.title.toLowerCase()}`:item.label} — {item.decision.mark}{item.leg?` · player ${item.prior.playerHits}/${item.prior.playerN} -> ${item.leg.playerHits}/${item.leg.playerN} · defense ${item.priorDefense.hits}/${item.priorDefense.n} -> ${item.leg.theme.hits}/${item.leg.theme.n} · ${item.leg.concentration}/100`:''}</li>)}</ul>:<p>None</p>}</div>)}
    </details>
    {game&&!!game.dropped?.length&&<details className="scatter-check"><summary className="prop-section-title"><span><h3>Legs left out</h3><span>Same-player conflicts, missing prices and line rules</span></span><span className="scatter-chevron" aria-hidden="true"/></summary><ul>{game.dropped.map(item=><li key={item.label+item.reason}>{item.label} — {item.reason}</li>)}</ul></details>}
    {!game&&<p className="prop-warning">No saved odds snapshot for this game yet, so the list uses the live Safe-overlap legs, ranked by overlap score.</p>}
    {candidates.length?<ol className="parlay-leg-list">{candidates.map(leg=><PropRow key={leg.id} leg={leg} matchup={matchup} gameLabel={gameLabel} scope={scope}/>)}</ol>:<p className="prop-warning">{game?'No player props are in the week file for this game.':`No individual legs currently satisfy the Bets signal, FLYERS Safe screen, Player Projection target, and ${scope} hit requirements.`}</p>}
    <small className="parlay-disclaimer">Suggested milestones only · confirm player status, line availability, and odds with your sportsbook</small>
    <details className="prop-method"><summary>Parlay rules and limitations</summary><p>When a week file is saved, this list is every player prop in that file. Each player, stat, and line appears once, ordered by the model hit chance already stored on the leg. That chance is the player’s games on this side of the line, shrunk toward one half. The grouped parlays used the same chance as each leg’s rating. When no file is saved, FLYERS Safe results are only a position, stat, and opponent-history screen. Player projections are read from the same projectTeam output displayed in Player Projections. A candidate needs at least three valid observations in the selected games, one or more personal hits at the Safe target, a projection at or above that target, and a positive Bets signal. The player hit rate in the overlap score is half-life weighted across those games. FLYERS Breakout candidates do not enter this calculation. The model does not fetch live sportsbook prices or estimate expected value.</p></details>
  </section>
  </>
}
