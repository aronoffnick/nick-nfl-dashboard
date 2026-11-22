import { useMemo, useState } from 'react'
import { projectTeam, valid } from './model.js'
import { sameGameFavorite } from './sgp.js'
import { SGPCard } from './WeeklySGPs.jsx'
import Performance, { PerformanceLegend } from './Performance.jsx'
import { relevantMetrics, groupCandidates, rankPlayerGroups } from './performance.js'
import { buildCandidates, metricLabel, lineComparison, breakEven, valueFor } from './analysis.js'
const f=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
function Candidate({item,data,matchup,saveProp,halfLife,lookback}){
  const [line,setLine]=useState(''),[odds,setOdds]=useState(''),[message,setMessage]=useState('')
  const p=item.player,c=lineComparison(p,item.key,line,halfLife,lookback),price=breakEven(odds)
  const recent=p.logs.slice(-lookback).map(l=>valueFor(l,item.key)).filter(valid)
  const thresholds=item.key.endsWith('TD')?[1,2,3]:item.key==='rec'?[3,5,7]:item.key==='passYds'?[200,250,300]:[25,50,75,100]
  function track(){
    if(Date.now()>=Date.parse(matchup.date)){setMessage('Kickoff has passed.');return}
    if(!saveProp){setMessage('Pick tracking unavailable.');return}
    if(odds.trim()!==''&&price==null){setMessage('Correct the odds or leave them blank.');return}
    const pick=c.delta>0?'Over':'Under'
    try{saveProp(`${matchup.id}:${p.id}:${item.key}`,{week:`${data.year} Week ${data.week}`,date:matchup.date,player:p.name,position:p.position,team:p.team.abbr,teamName:p.team.name,metric:metricLabel(item.key),line:Number(line),odds:odds.trim(),projection:item.stat.projection,pick,result:'Pending',recordedAt:new Date().toISOString()});setMessage('Saved to Weekly picks.')}catch{setMessage('This browser could not save the pick.')}
  }
  return <div className="player-stat-detail">
    <Performance player={p} metric={item.key} halfLife={halfLife} lookback={lookback}/>
    <div className="bet-inputs"><label>Your sportsbook line<input type="number" min="0" step=".5" placeholder={item.key.endsWith('TD')?'0.5':'e.g. 64.5'} value={line} onChange={e=>setLine(e.target.value)}/></label><label>American odds (optional)<input placeholder="-110 or +120" value={odds} onChange={e=>setOdds(e.target.value)}/></label></div>
      {c&&<p>Model minus line: <b>{f(c.delta,item.key)}</b> · historical overs: <b>{c.over}/{c.n}</b>{c.push?` · pushes: ${c.push}`:''}.</p>}
      {odds.trim()!==''&&<p>{price==null?'Enter valid American odds such as -110 or +120.':`Price break-even: ${(price*100).toFixed(1)}%. This is the sportsbook's break-even requirement, not the model's win probability.`}</p>}
      {c&&valid(c.delta)&&c.delta!==0&&!matchup.started&&<button className="prop-action" onClick={track}>Track model pick</button>}
      {message&&<p role="status">{message}</p>}
    <details><summary>{metricLabel(item.key)} · supporting evidence</summary>
    <div className="bet-badges">{item.badges.map(b=><span key={b}>{b}</span>)}{item.risk&&<span className="bet-risk">Check availability</span>}</div>
    <p>Weighted baseline <b>{f(item.stat.baseline,item.key)}</b> · opponent adjustment <b>{item.stat.defense.adjusted?`${item.stat.defense.factor>=1?'+':''}${((item.stat.defense.factor-1)*100).toFixed(1)}%`:'Neutral'}</b></p>
    <ul>{item.reasons.map(r=><li key={r}>{r}</li>)}</ul>
    <div className="bet-thresholds">{thresholds.map(t=><span key={t}><b>{t}+</b> in {recent.filter(v=>v>=t).length}/{recent.length}</span>)}</div>
      <p className="prop-help">Thresholds describe recorded appearances, including recorded zeros—not forecast hit rates. No calibrated win probability or expected value is available.</p>
    </details>
  </div>
}
export default function Bets({data,matchup,roster,halfLife,window,saveProp}){
  const players=useMemo(()=>[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([team,opponent])=>projectTeam(data,team,opponent,roster,halfLife,window).map(p=>({...p,team,opponent}))),[data,matchup,roster,halfLife,window])
  const candidates=useMemo(()=>buildCandidates(players,halfLife,window).filter(item=>relevantMetrics(item.player).some(([key])=>key===item.key)),[players,halfLife,window])
  const groups=useMemo(()=>rankPlayerGroups(groupCandidates(candidates),halfLife,window),[candidates,halfLife,window])
  const favorite=useMemo(()=>sameGameFavorite(data,matchup,roster,halfLife,window,Date.now(),players),[data,matchup,roster,halfLife,window,players])
  const visible=groups
  return <section aria-label="Bets"><div className="prop-section-title"><h3>Matchup research shortlist</h3><span>Favorites first · strongest supported stat</span></div>
    <div className="bet-sgp"><h3>Favorite 2-leg SGP for this game</h3>{favorite.pair?<SGPCard pair={favorite.pair} matchup={matchup}/>:<p className="prop-warning">No automatic SGP: {favorite.reason}</p>}</div>
    <p className="prop-help">Team lean: <strong>{matchup.margin<.05?'Toss-up':`${matchup.winner.abbr} by ${matchup.margin.toFixed(1)}`}</strong> · no confirmed starting-QB adjustment. Each player appears once below, with their relevant stat signals and line comparisons together. Rows rank by the highest recent weighted benchmark frequency across any relevant stat, highest first. Ties favor more observations, then the research signal. This is historical support, not a combined win probability; odds do not affect this ordering.</p>
    <PerformanceLegend/>
    <p className="prop-help">Higher recent support does not imply value at any sportsbook price. An output dip with steady usage is a research flag, not evidence a player is due. Expected TD counts are rates; total TDs combine rushing and receiving.</p>
    {matchup.started&&<p className="prop-warning">Game started or finished. These are pregame baselines, not live recommendations; new pick tracking is disabled.</p>}
    <div className="player-card-grid">{visible.map((group,index)=><article className="player-research-card player-row bet-player-row" key={group.id} aria-label={`${group.player.name} bets`}>
      <header><div><small className="player-rank">FAVORITE #{index+1}</small><h4>{group.player.name}</h4><p>{group.player.team.abbr} · {group.player.position} · {group.player.injury||group.player.status}</p><small>{group.player.logs.length} recorded appearances · {group.items.length} stat signals</small><p className="row-best-support">{group.bestSupport?<>Strongest: <b>{metricLabel(group.bestSupport.key)}</b><br/>{Math.round(group.bestSupport.weightedRate*100)}% recent weighted frequency<br/>{group.bestSupport.hits}/{group.bestSupport.n} reached {group.bestSupport.threshold}+</>:<>Not rated · availability or sample concern</>}</p></div></header>
      <div className="player-metrics" style={{'--metric-count':relevantMetrics(group.player).length}}>{relevantMetrics(group.player).map(([key])=>{
        const item=group.items.find(i=>i.key===key)
        return item?<Candidate key={key} item={item} data={data} matchup={matchup} saveProp={saveProp} halfLife={halfLife} lookback={window}/>:<Performance key={key} player={group.player} metric={key} halfLife={halfLife} lookback={window}/>
      })}</div>
    </article>)}</div>
    {!groups.length&&<p className="prop-warning">No eligible candidates. Three recorded appearances and a current recent offensive role are required; stale and unavailable players are excluded.</p>}
    <p className="prop-help">Enter the actual sportsbook line and optional price inside a card to compare and track it before kickoff. No sportsbook feed is connected. Projection differences alone do not establish a profitable bet. Picks are saved in this browser and prop results are graded manually.</p>
  </section>
}
