import { useMemo, useState } from 'react'
import { projectTeam, valid } from './model.js'
import { sameGameFavorite } from './sgp.js'
import { SGPCard } from './WeeklySGPs.jsx'
import { buildCandidates, metricLabel, lineComparison, breakEven, valueFor } from './analysis.js'
const f=(n,key='')=>valid(n)?n.toFixed(key==='totalTD'?2:1):'—'
function Candidate({item,data,matchup,saveProp,halfLife,lookback}){
  const [line,setLine]=useState(''),[odds,setOdds]=useState(''),[message,setMessage]=useState('')
  const p=item.player,c=lineComparison(p,item.key,line,halfLife,lookback),price=breakEven(odds)
  const recent=p.logs.slice(-lookback).map(l=>valueFor(l,item.key)).filter(valid)
  const thresholds=item.key==='totalTD'?[1,2]:item.key==='rec'?[3,5,7]:item.key==='passYds'?[200,250,300]:[25,50,75,100]
  function track(){
    if(Date.now()>=Date.parse(matchup.date)){setMessage('Kickoff has passed.');return}
    if(!saveProp){setMessage('Pick tracking unavailable.');return}
    if(odds.trim()!==''&&price==null){setMessage('Correct the odds or leave them blank.');return}
    const pick=c.delta>0?'Over':'Under'
    try{saveProp(`${matchup.id}:${p.id}:${item.key}`,{week:`${data.year} Week ${data.week}`,date:matchup.date,player:p.name,position:p.position,team:p.team.abbr,teamName:p.team.name,metric:metricLabel(item.key),line:Number(line),odds:odds.trim(),projection:item.stat.projection,pick,result:'Pending',recordedAt:new Date().toISOString()});setMessage('Saved to Weekly picks.')}catch{setMessage('This browser could not save the pick.')}
  }
  return <article className="bet-candidate"><header><div><h4>{p.name} <span className="prop-team-tag">{p.team.abbr}</span></h4><span>{metricLabel(item.key)} · {item.evidence} · {item.stat.sample} appearances</span></div><div className="bet-estimate"><small>PROJECTED</small><strong>{f(item.stat.projection,item.key)}</strong></div></header>
    <div className="bet-badges">{item.badges.map(b=><span key={b}>{b}</span>)}{item.risk&&<span className="bet-risk">Check availability</span>}</div>
    <p>Weighted baseline <b>{f(item.stat.baseline,item.key)}</b> · opponent adjustment <b>{item.stat.defense.adjusted?`${item.stat.defense.factor>=1?'+':''}${((item.stat.defense.factor-1)*100).toFixed(1)}%`:'Neutral'}</b></p>
    <ul>{item.reasons.map(r=><li key={r}>{r}</li>)}</ul>
    <div className="bet-thresholds">{thresholds.map(t=><span key={t}><b>{t}+</b> in {recent.filter(v=>v>=t).length}/{recent.length}</span>)}</div>
    <details><summary>Compare a line / price or save a pick</summary><div className="bet-inputs"><label>Your sportsbook line<input type="number" min="0" step=".5" placeholder={item.key==='totalTD'?'0.5':'e.g. 64.5'} value={line} onChange={e=>setLine(e.target.value)}/></label><label>American odds (optional)<input placeholder="-110 or +120" value={odds} onChange={e=>setOdds(e.target.value)}/></label></div>
      {c&&<p>Model minus line: <b>{f(c.delta,item.key)}</b> · historical overs: <b>{c.over}/{c.n}</b>{c.push?` · pushes: ${c.push}`:''}.</p>}
      {odds.trim()!==''&&<p>{price==null?'Enter valid American odds such as -110 or +120.':`Price break-even: ${(price*100).toFixed(1)}%. This is the sportsbook's break-even requirement, not the model's win probability.`}</p>}
      {c&&valid(c.delta)&&c.delta!==0&&!matchup.started&&<button className="prop-action" onClick={track}>Track model pick</button>}
      {message&&<p role="status">{message}</p>}
      <p className="prop-help">Thresholds describe recorded appearances, including recorded zeros—not forecast hit rates. No calibrated win probability or expected value is available.</p>
    </details>
  </article>
}
export default function Bets({data,matchup,roster,halfLife,window,saveProp}){
  const [expanded,setExpanded]=useState(false)
  const players=useMemo(()=>[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([team,opponent])=>projectTeam(data,team,opponent,roster,halfLife,window).map(p=>({...p,team,opponent}))),[data,matchup,roster,halfLife,window])
  const candidates=useMemo(()=>buildCandidates(players,halfLife,window),[players,halfLife,window])
  const favorite=useMemo(()=>sameGameFavorite(data,matchup,roster,halfLife,window,Date.now(),players),[data,matchup,roster,halfLife,window,players])
  const visible=expanded?candidates:candidates.slice(0,12)
  const rising=candidates.find(c=>c.badges.includes('Rising workload')),favorable=candidates.find(c=>c.badges.includes('Favorable matchup'))
  const td=candidates.filter(c=>c.key==='totalTD').sort((a,b)=>b.stat.projection-a.stat.projection)[0]
  return <section aria-label="Bets"><div className="prop-section-title"><h3>Matchup research shortlist</h3><span>Ranked statistical signals · not price-qualified bets</span></div>
    <div className="bet-sgp"><h3>Favorite 2-leg SGP for this game</h3>{favorite.pair?<SGPCard pair={favorite.pair} matchup={matchup}/>:<p className="prop-warning">No automatic SGP: {favorite.reason}</p>}</div>
    <div className="bet-summary"><div><small>TEAM LEAN</small><strong>{matchup.margin<.05?'Toss-up':`${matchup.winner.abbr} by ${matchup.margin.toFixed(1)}`}</strong><p>Recent team model; no confirmed starting-QB adjustment.</p></div>
      {[["RISING WORKLOAD",rising],["MATCHUP SUPPORT",favorable],["TD INVOLVEMENT",td]].map(([name,pick])=><div key={name}><small>{name}</small><strong>{pick?.player.name||'No qualifying signal'}</strong><p>{pick?`${metricLabel(pick.key)} · projection ${f(pick.stat.projection,pick.key)}`:'Insufficient data or signal.'}</p></div>)}
    </div>
    <p className="prop-help">More data means six or more recorded appearances and three usable defensive comparisons, without a listed availability flag. Ranking rewards rising usage and favorable matchups. An output dip with sustained usage is only a research flag; no player is “due.” Related markets and cards may refer to the same player. TDs combine rushing and receiving; passing TDs are excluded.</p>
    {matchup.started&&<p className="prop-warning">Game started or finished. These are pregame baselines, not live recommendations; new pick tracking is disabled.</p>}
    <div className="bet-grid">{visible.map(item=><Candidate key={item.id} item={item} data={data} matchup={matchup} saveProp={saveProp} halfLife={halfLife} lookback={window}/>)}</div>
    {!candidates.length&&<p className="prop-warning">No eligible candidates. Three recorded appearances and a current recent offensive role are required; stale and unavailable players are excluded.</p>}
    {candidates.length>12&&<button className="prop-action" onClick={()=>setExpanded(!expanded)}>{expanded?'Show top 12':`Show all ${candidates.length} candidates`}</button>}
    <p className="prop-help">Enter the actual sportsbook line and optional price inside a card to compare and track it before kickoff. No sportsbook feed is connected. Projection differences alone do not establish a profitable bet. Picks are saved in this browser and prop results are graded manually.</p>
  </section>
}
