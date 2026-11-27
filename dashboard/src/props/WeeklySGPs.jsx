import { useEffect, useMemo, useState } from 'react'
import { getRosters } from './data.js'
import { weeklySGPFavorites } from './sgp.js'
import './sgp.css'
const kickoff=d=>new Date(d).toLocaleString('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
export function SGPCard({pair,matchup,rank,onOpen}){
  return <article className="sgp-card"><header><div><small>{rank?`WEEKLY FAVORITE ${rank}`:'MATCHUP FAVORITE'}</small><h3>{matchup.away.abbr} at {matchup.home.abbr}</h3></div><span>{kickoff(matchup.date)} ET</span></header>
    <ol>{pair.legs.map(leg=><li key={leg.id}><strong>{leg.text}</strong><div><span>Model: {leg.projection.toFixed(leg.key==='totalTD'?2:1)}</span><span>Reached in {leg.hits}/{leg.n} season games{leg.rate!=null?` · ${Math.round(leg.rate*100)}% weighted`:''}</span></div>{leg.signals?.length>0&&<small className="sgp-signals">Signals: {leg.signals.join(' · ')}</small>}</li>)}</ol>
    <p>{pair.dependence} Historical hit counts are per leg; no combined win probability is estimated.</p>
    {onOpen&&<button onClick={()=>onOpen(matchup.id)}>Open matchup analysis</button>}
    <small className="sgp-price">Suggested milestones · sportsbook availability, combined odds and value unverified</small>
  </article>
}
export default function WeeklySGPs({data,matchups,halfLife,onOpen}){
  const [rosters,setRosters]=useState(null),[error,setError]=useState(''),[progress,setProgress]=useState('Loading free player data…')
  const [clock,setClock]=useState(Date.now())
  useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(id)},[])
  useEffect(()=>{
    let cancelled=false
    if(!data)return
    setError('')
    getRosters(data,setProgress).then(result=>{if(!cancelled)setRosters(result)}).catch(e=>{if(!cancelled)setError(e.message)})
    return()=>{cancelled=true}
  },[data?.updated])
  const results=useMemo(()=>data&&rosters?weeklySGPFavorites(data,matchups,rosters.roster,halfLife,null,clock):null,[data,matchups,rosters,halfLife,clock])
  return <section className="sgp-weekly" aria-label="Weekly 2-leg SGP favorites"><div className="sgp-title"><div><p>WEEKLY BET FAVORITES</p><h2>2-leg SGPs of the week</h2></div><span>{data?`${data.year} · Week ${data.week}`:'Current NFL week'}</span></div>
    <p className="sgp-intro">Two different players, one game. These are the model's favorite milestone pairings from upcoming matchups, ranked by the weaker leg's season-weighted support and projection cushion. Free data only; confirm both selections and the combined price in your sportsbook.</p>
    {!data?<p className="prop-help">Waiting for the weekly schedule and team statistics.</p>:error?<p role="alert" className="prop-warning">SGP favorites could not load: {error}</p>:!results?<p role="status" className="prop-help">{progress}</p>:<>
      {rosters.failed.length>0&&<p className="prop-warning">Some roster data is unavailable. Matchups with unresolved quarterback status are withheld.</p>}
      <div className="sgp-grid">{results.favorites.map(({pair,matchup},i)=><SGPCard key={matchup.id} pair={pair} matchup={matchup} rank={i+1} onOpen={onOpen}/>)}</div>
      {!results.favorites.length&&<p className="prop-warning">No qualifying two-leg favorites right now. The model will not fill the list with unsupported picks. Review the skipped-game reasons below.</p>}
      <details className="sgp-method"><summary>Selection rules and skipped matchups</summary><p>Each player needs six recorded appearances, at least five valid season observations, no listed availability concern, and participation in the latest offensive box score. Each milestone must clear a two-thirds half-life-weighted season rate, with a model projection at least 20% above the milestone. Workload and output arrows still compare the last three appearances with the three before that; those are trend signals, not the stat window. The highest qualifying milestone per player/stat is considered. Two distinct players must be in the same game; no two-TD-scorer pairs or same-team passing/receiving stacks are generated. These rules are heuristics, not calibrated probabilities or a profitability backtest.</p>
      <p>Games with a recent quarterback switch or unresolved/questionable/out recent quarterback are withheld for review. Free roster data cannot confirm a starting lineup; late changes can still be missed. Started games drop out on the next minute check. Upcoming games are recalculated when the dashboard refreshes; no paid data feed or background betting service is used.</p>
      <ul>{results.skipped.map(({matchup,reason})=><li key={matchup.id}>{matchup.away.abbr} at {matchup.home.abbr}: {reason}</li>)}</ul></details>
    </>}
  </section>
}
