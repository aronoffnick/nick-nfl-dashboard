import { useMemo, useState } from 'react'
import { projectTeam, valid } from './model.js'
import {sameGameFavorite} from './sgp.js'
import {SGPCard} from './WeeklySGPs.jsx'

const clamp = (n,min,max) => Math.max(min,Math.min(max,n))
const average = (games,key) => games.length && games.every(game=>valid(game[key]))
  ? games.reduce((sum,game)=>sum+game[key],0)/games.length : null
const statLabels = {passYds:'Pass yd',passTD:'Pass TD',rushYds:'Rush yd',rushTD:'Rush TD',recYds:'Rec yd',rec:'Receptions',recTD:'Rec TD',totalTD:'TD scored'}
const statGroups = {
  Passing:['passYds','passTD'], Rushing:['rushYds','rushTD'], Receiving:['rec','recYds','recTD'], 'TD scored':['totalTD'],
}
const positions=['QB','RB','FB','WR','TE']
function totalTD(game,position){
  const keys=position==='QB'?['rushTD']:['rushTD','recTD']
  return keys.every(key=>valid(game[key]))?keys.reduce((total,key)=>total+game[key],0):null
}
function projectionFor(player,key){
  if(key!=='totalTD')return player.stats[key]?.projection
  const scores=['rushTD','recTD'].map(k=>player.stats[k]?.projection)
  return scores.every(valid)?scores.reduce((sum,value)=>sum+value,0):null
}
function metricsFor(player){
  return player.position==='QB'?['passYds','passTD','rushYds','rushTD']:
    ['WR','TE'].includes(player.position)?['rec','recYds','totalTD']:['rushYds','rec','recYds','totalTD']
}
export function breakoutRating(player){
  if(player.unavailable||player.stale||player.logs.length<6)return null
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const recent=average(player.logs.slice(-3),usageKey),prior=average(player.logs.slice(-6,-3),usageKey)
  const mainStat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const factor=player.stats[mainStat]?.defense.factor,sample=player.stats[mainStat]?.sample||0
  if(!valid(recent)||!valid(prior)||prior<=0||!valid(factor))return null
  const trend=clamp(50+125*(recent/prior-1),0,100)
  const matchup=clamp((factor-.75)/.5*100,0,100)
  const reliability=clamp(sample/8*100,0,100)
  return Math.round(trend*.4+matchup*.35+reliability*.25)
}
export function ratingLevel(score){return score==null?'unknown':score>=70?'high':score>=45?'moderate':'low'}
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
function observedRange(player,key,window){
  const values=player.logs.slice(-window).map(game=>key==='totalTD'?totalTD(game,player.position):game[key]).filter(valid).sort((a,b)=>a-b)
  if(!values.length)return {low:null,median:null,high:null,n:0}
  return {low:values[0],median:values[Math.floor((values.length-1)*.5)],high:values.at(-1),n:values.length}
}
function CheckFilter({title,items,selected,onToggle}){
  return <fieldset className="breakout-filter-group"><legend>{title}</legend>{items.map(([key,label])=><label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={()=>onToggle(key)}/>{label}</label>)}</fieldset>
}
function BreakoutGauge({score}){
  const level=ratingLevel(score)
  return <div className={`breakout-gauge breakout-${level}`} aria-label={score==null?'Breakout index not rated':`Breakout index ${score} out of 100, ${level}`}>
    <div className="breakout-gauge-scale"><span/><span/><span/>{score!=null&&<i style={{left:`${score}%`}}/>}</div>
    <div className="breakout-gauge-labels"><span>Low</span><span>Moderate</span><span>High</span></div>
    <b>{score==null?'Not rated':`${score}/100 · ${level==='moderate'?'Moderate':level[0].toUpperCase()+level.slice(1)}`}</b>
  </div>
}
function PlayerRow({player,matchup,window,index,selectedGroups}){
  const score=player.breakoutScore,level=ratingLevel(score),mainStat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const recent=average(player.logs.slice(-3),usageKey),prior=average(player.logs.slice(-6,-3),usageKey)
  const metrics=metricsFor(player).filter(key=>selectedGroups.some(group=>statGroups[group].includes(key))),teamWon=matchup.winner?.abbr===player.offense.abbr
  const isPassAhead=!teamWon && matchup.margin>=4
  const factor=player.stats[mainStat]?.defense.factor
  const favorable=valid(factor)&&factor>=1.05
  const risks=[player.injury||/questionable|doubtful|out/i.test(player.status)?`Roster status: ${player.injury||player.status}`:null,player.logs.length<6?'Limited current-team sample; role trend unavailable':null,player.stale?'Absent from latest offensive box score; role needs review':null].filter(Boolean)
  const recentMetric=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const recentOutput=average(player.logs.slice(-3).map(g=>({value:g[recentMetric]})),'value'),priorOutput=average(player.logs.slice(-6,-3).map(g=>({value:g[recentMetric]})),'value')
  const workloadRising=valid(recent)&&valid(prior)&&recent>=prior*1.15
  const momentum=valid(recentOutput)&&valid(priorOutput)&&recentOutput>=priorOutput*1.15
  const bounceBack=valid(recent)&&valid(prior)&&recent>=prior*.9&&valid(recentOutput)&&valid(priorOutput)&&recentOutput<=priorOutput*.8
  const tdInvolved=player.logs.slice(-window).some(g=>totalTD(g,player.position)>=1)
  const triggers=[workloadRising?`Rising workload: ${recent.toFixed(1)} ${usageKey==='passAtt'?'pass attempts':usageKey} per game in the last 3 vs ${prior.toFixed(1)} in the prior 3`:null,favorable?`Favorable matchup: recent position adjustment +${((factor-1)*100).toFixed(0)}%`:null,momentum?`Momentum: ${recentMetric} average ${recentOutput.toFixed(1)} vs ${priorOutput.toFixed(1)} in prior 3`:null,bounceBack?`Bounce back: workload held while ${recentMetric} output dipped ${Math.round((1-recentOutput/priorOutput)*100)}%`:null,tdInvolved?'TD involvement: at least one rushing/receiving TD in the recent sample':null].filter(Boolean)
  const tierFor=key=>observedRange(player,key,window)
  const allStats=[...new Set([...metrics,'totalTD'])]
  const tdValues=player.logs.slice(-window).map(game=>totalTD(game,player.position)).filter(valid)
  return <article className="breakout-player-row">
    <div className="breakout-player-identity"><small className="player-rank">BREAKOUT WATCH #{index+1}</small><h4>{player.name}</h4><p>{player.offense.abbr} · {player.position} · {player.injury||player.status}</p><small>{player.logs.length} recorded appearances</small></div>
    <section className="breakout-score-cell"><h5>Breakout index</h5><BreakoutGauge score={score}/><small>Directional composite · not a probability</small></section>
    <section className="breakout-usage-cell"><h5>Recent opportunity</h5><strong>{valid(recent)?`${recent.toFixed(1)} ${usageKey==='passAtt'?'attempts':usageKey}`:'—'}</strong><small>Last 3 appearances{valid(prior)?` · prior 3: ${prior.toFixed(1)}`:''}</small><p>{valid(recent)&&valid(prior)&&prior>0?`${recent>=prior?'↑':'↓'} ${Math.abs((recent/prior-1)*100).toFixed(0)}% vs prior 3`:'Trend unavailable'}</p></section>
    <section className="breakout-matchup-cell"><h5>Matchup context</h5><strong>{valid(factor)?`${factor>=1?'+':''}${((factor-1)*100).toFixed(0)}%`:'Neutral'}</strong><small>Recent ${player.position} defense adjustment</small><p>Team model: {teamWon?'favored':isPassAhead?'underdog':'near even'}{matchup.margin>=.05?` by ${matchup.margin.toFixed(1)}`:''}</p></section>
    <section className="breakout-projection-cell"><h5>Projected stats</h5>{metrics.map(key=>{const range=observedRange(player,key,window),projection=projectionFor(player,key);return <div className="breakout-stat-chip" key={key}><b>{statLabels[key]}</b><strong>{player.unavailable?'Withheld':valid(projection)?projection.toFixed(key.endsWith('TD')?2:1):'—'}</strong><small>Recent {window}: {valid(range.low)?`${range.low}–${range.high}`:'range unavailable'}</small>{key==='totalTD'&&<small>2+ TDs: {tdValues.filter(value=>value>=2).length}/{tdValues.length} recent</small>}</div>})}</section>
    <details className="breakout-disclosure"><summary><span className={`breakout-headline breakout-${level}`}>{level==='high'?'Higher breakout support':level==='moderate'?'Moderate breakout support':level==='low'?'Lower breakout support':'Breakout support not rated'}</span><span className="support-chevron" aria-hidden="true"/></summary>
      <div className="breakout-expanded"><p><b>Yardage reference:</b> model projection is the current baseline. The recent low / middle / high values below are observed results, not forecast percentiles.</p>
        <div className="bet-badges">{(triggers.length?triggers:['No qualifying workload, matchup, momentum, bounce-back, or TD signal in the available box scores.']).map(signal=><span key={signal}>{signal}</span>)}</div>
        <div className="breakout-tier-grid">{allStats.filter(key=>['passYds','rushYds','recYds','totalTD'].includes(key)).map(key=>{const r=tierFor(key),projection=projectionFor(player,key);return <div key={key}><b>{statLabels[key]}</b><span>Recent low <strong>{valid(r.low)?r.low:'—'}</strong> · middle <strong>{valid(r.median)?r.median:'—'}</strong> · high <strong>{valid(r.high)?r.high:'—'}</strong></span>{valid(projection)&&<span>Model baseline <strong>{projection.toFixed(1)}</strong></span>}<small>{r.n} recorded appearances</small></div>})}</div>
        <div className="breakout-trigger-risk"><div><b>Potential triggers</b>{triggers.length?<ul>{triggers.slice(0,3).map(t=><li key={t}>{t}</li>)}</ul>:<p>No verified workload or matchup trigger available in current box-score data.</p>}</div><div><b>Risks</b><ul>{(risks.length?risks:['Recent role can change; no confirmed starter, snap, route, weather, or live injury adjustment is connected.','Team score and player volume are modeled independently; actual game script may differ.']).slice(0,2).map(t=><li key={t}>{t}</li>)}</ul></div></div>
        <p>TD scored projection combines rushing and receiving TD rates. Recent 2+ TD games: {tdValues.filter(value=>value>=2).length}/{tdValues.length}; this historical count is not a calibrated probability.</p>
        <p>Index weights: recent role trend 40%, opponent position adjustment 35%, sample reliability 25%. Sample reliability is descriptive. It does not represent confidence that the player will break out.</p>
      </div>
    </details>
  </article>
}
export default function Bets({ data, matchup, roster, halfLife, window }) {
  const [teams,setTeams]=useState([matchup.away.id,matchup.home.id]),[selectedPositions,setSelectedPositions]=useState(positions),[selectedGroups,setSelectedGroups]=useState(Object.keys(statGroups))
  const toggle=(setter,current,key)=>setter(current.includes(key)?current.filter(x=>x!==key):[...current,key])
  const players=useMemo(()=>[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([offense,opponent])=>projectTeam(data,offense,opponent,roster,halfLife,window).map(player=>({...player,offense,breakoutScore:breakoutRating(player)}))),[data,matchup,roster,halfLife,window])
  const favorite=sameGameFavorite(data,matchup,roster,halfLife,window,Date.now(),players.map(p=>({...p,team:p.offense,opponent:p.opponent})))
  const visible=players.filter(player=>teams.includes(player.offense.id)&&selectedPositions.includes(player.position)&&metricsFor(player).some(key=>selectedGroups.some(group=>statGroups[group].includes(key))))
    .sort((a,b)=>betSignalScore(b)-betSignalScore(a)||(b.breakoutScore??-1)-(a.breakoutScore??-1)||a.name.localeCompare(b.name))
  return <section aria-label="Breakout outlook">
    <div className="prop-section-title"><h3>Favorite 2-leg parlay</h3><span>Two different players · matchup-specific</span></div>
    {favorite.pair?<SGPCard pair={favorite.pair} matchup={matchup}/>:<p className="prop-warning">No 2-leg favorite is shown: {favorite.reason} The model skips a parlay when recent history or quarterback availability does not meet its checks.</p>}
    <p className="prop-help">Player bets below are ranked as breakout candidates using workload trend, matchup adjustment, TD involvement, momentum, and bounce-back indicators where data supports them. The parlay uses separate-player milestones with recent hit-rate and projection-cushion checks. These are model-selected ideas, not sportsbook lines or guaranteed probabilities.</p>
    <div className="prop-section-title"><h3>Player breakout outlook</h3><span>Top composite support first · one row per player</span></div>
    <p className="prop-help">This 0–100 directional index combines recent role trend (40%), opponent position adjustment (35%), and sample reliability (25%). Red is low, yellow moderate, and green high; the index is a ranking aid, not a forecast probability or betting recommendation. Source: ESPN box scores and current roster statuses. Yardage ranges and TD hit counts are historical.</p>
    <div className="breakout-filters" aria-label="Breakout filters">
      <CheckFilter title="Teams" items={[[matchup.away.id,matchup.away.name],[matchup.home.id,matchup.home.name]]} selected={teams} onToggle={key=>toggle(setTeams,teams,key)}/>
      <CheckFilter title="Positions" items={positions.map(key=>[key,key])} selected={selectedPositions} onToggle={key=>toggle(setSelectedPositions,selectedPositions,key)}/>
      <CheckFilter title="Stat categories" items={Object.keys(statGroups).map(key=>[key,key])} selected={selectedGroups} onToggle={key=>toggle(setSelectedGroups,selectedGroups,key)}/>
      <button className="prop-action" onClick={()=>{setTeams([matchup.away.id,matchup.home.id]);setSelectedPositions(positions);setSelectedGroups(Object.keys(statGroups))}}>Reset filters</button>
    </div>
    <div className="breakout-board">{visible.map((player,index)=><PlayerRow key={`${player.offense.id}:${player.id}`} player={player} matchup={matchup} window={window} index={index} selectedGroups={selectedGroups}/>)}</div>
    {!visible.length&&<p className="prop-warning">No eligible players match the selected filters.</p>}
    <details className="bet-notes"><summary>Other bet notes</summary><p>{matchup.margin<.05?'Team model is a toss-up.':`Team lean: ${matchup.winner.abbr} by ${matchup.margin.toFixed(1)}.`} Sportsbook prices are unavailable. Enter lines in the projections tab; no sportsbook feed is connected.</p></details>
  </section>
}
