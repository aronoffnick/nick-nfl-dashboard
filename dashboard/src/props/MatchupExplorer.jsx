import { useEffect, useMemo, useRef, useState } from 'react'
import { getRosters } from './data.js'
import { valid, historyFor, sides, positionOf, projectTeam, defenseProfile, historicalComparison } from './model.js'
import { DISPLAY_METRICS, statFor, valueFor, metricLabel, lineComparison } from './analysis.js'
import Bets from './Bets.jsx'
import PlayerFilters, {defaultFilters} from './PlayerFilters.jsx'
import {matchesPlayer,selectedMetrics,projectedOrder} from './filters.js'
import Performance, { PerformanceLegend } from './Performance.jsx'
import { relevantMetrics, performance } from './performance.js'
import './props.css'
const format=(n,key='')=>valid(n)?n.toFixed(key==='totalTD'||key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})

function PlayerDetail({player,data,matchup,saveProp,halfLife,lookback}){
  const metrics=relevantMetrics(player)
  const [metric,setMetric]=useState(metrics[0][0])
  const [line,setLine]=useState('')
  const [message,setMessage]=useState('')
  const comparison=lineComparison(player,metric,line,halfLife,lookback)
  return <section className="prop-comparison"><h3>{player.name} · evidence & game log</h3>
    <div className="table-wrap"><table><thead><tr><th>Statistic</th><th>Weighted baseline</th><th>Matchup adjustment</th><th>Projection</th><th>Appearances</th></tr></thead><tbody>{metrics.map(([key,name])=>{
      const s=statFor(player,key,halfLife,lookback)
      return <tr key={key}><td>{name}</td><td>{format(s.baseline,key)}</td><td>{s.defense.adjusted?`${s.defense.factor>=1?'+':''}${((s.defense.factor-1)*100).toFixed(1)}%`:'Neutral · insufficient baseline'}</td><td>{player.unavailable?'Withheld':format(s.projection,key)}</td><td>{s.sample}</td></tr>
    })}</tbody></table></div>
    <h4>Compare a prop line</h4><div className="prop-metric-buttons" aria-label="Comparison statistic">{metrics.map(([key,name])=><button key={key} aria-pressed={metric===key} onClick={()=>{setMetric(key);setLine('');setMessage('')}}>{name}</button>)}</div>
    <label>Your {metricLabel(metric)} line <input type="number" min="0" step="0.5" value={line} placeholder="Enter your sportsbook line" onChange={e=>setLine(e.target.value)}/></label>
    {comparison&&<p>{valid(comparison.projection)?<>Projection <b>{format(comparison.projection,metric)}</b> · difference from line <b>{format(comparison.delta,metric)}</b> · </>:null}Over this line in <b>{comparison.over}/{comparison.n}</b> recent recorded appearances{comparison.push?` (${comparison.push} pushes)`:''}. Historical frequency is not a forecast probability.</p>}
    {comparison&&valid(comparison.delta)&&comparison.delta!==0&&!matchup.started&&<button className="prop-action" onClick={()=>{
      if(Date.now()>=Date.parse(matchup.date)){setMessage('Kickoff has passed.');return}
      if(!saveProp){setMessage('Pick tracking is unavailable.');return}
      const pick=comparison.delta>0?'Over':'Under'
      try{saveProp(`${matchup.id}:${player.id}:${metric}`,{week:`${data.year} Week ${data.week}`,date:matchup.date,player:player.name,position:player.position,team:player.team.abbr,teamName:player.team.name,metric:metricLabel(metric),line:Number(line),pick,result:'Pending'});setMessage('Saved to Weekly picks.')}catch{setMessage('This browser could not save the pick.')}
    }}>Track model pick</button>}
    {message&&<p role="status">{message}</p>}
    <h4>Recorded appearances</h4><div className="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th>{metrics.map(([key,name])=><th key={key}>{name}</th>)}</tr></thead><tbody>{[...player.logs].reverse().map(log=><tr key={log.gameId}><td>{date(log.date)}</td><td>{log.opponent}</td>{metrics.map(([key])=><td key={key}>{format(valueFor(log,key),key)}</td>)}</tr>)}</tbody></table></div>
  </section>
}

function Projections({players,data,matchup,halfLife,lookback,saveProp,filters,setFilters}){
  const [sort,setSort]=useState('recYds'),[chosen,setChosen]=useState(null)
  const filtered=players.filter(p=>matchesPlayer(p,filters))
  const selected=filtered.find(p=>`${p.team.id}:${p.id}`===chosen)
  const evidence=useRef(null)
  useEffect(()=>{if(chosen)evidence.current?.scrollIntoView({behavior:'smooth',block:'start'})},[chosen])
  const strength=p=>Math.max(-1,...selectedMetrics(p,filters).map(([key])=>performance(p,key,halfLife,lookback).weightedRate??-1))
  const metricKeys=DISPLAY_METRICS.map(([key])=>key)
  const activeSort=metricKeys.includes(sort)&&!filters.stats.includes(sort)?filters.stats[0]||sort:sort
  const sorted=metricKeys.includes(activeSort)?projectedOrder(filtered,activeSort,halfLife,lookback):[...filtered].sort((a,b)=>sort==='support'?strength(b)-strength(a)||a.name.localeCompare(b.name):sort==='name'?a.name.localeCompare(b.name):a.team.abbr.localeCompare(b.team.abbr)||a.name.localeCompare(b.name))
  return <section aria-label="Player projections"><div className="prop-section-title"><h3>Player projections · both teams</h3><span>One player · relevant stats together</span></div>
    {matchup.started&&<p className="prop-warning">Game started or finished. These projections are pregame baselines using prior weeks, not live forecasts.</p>}
    <PlayerFilters matchup={matchup} filters={filters} onChange={setFilters}/>
    <PerformanceLegend/>
    <label className="projections-sort">Order players <select value={activeSort} onChange={e=>setSort(e.target.value)}>{DISPLAY_METRICS.map(([key,name])=><option key={key} value={key}>Highest projected: {name}</option>)}<option value="team">Team, then player</option><option value="name">Player name</option><option value="support">Strongest recent big-game support</option></select></label>
    <p className="prop-help">White marker = model projection · dashed marker = big-game benchmark. QB cards show passing and rushing roles; receiving stats appear for players with receiving usage. TD scored combines rushing and receiving TDs. Questionable or stale roles are not color-rated; out/doubtful projections are withheld.</p>
    <div className="player-card-grid">{sorted.map(p=><article className="player-research-card player-row" key={`${p.team.id}:${p.id}`} aria-label={`${p.name} projections`}>
      <header><div><h4>{p.name}</h4><p>{p.team.abbr} · {p.position} · {p.injury||p.status}</p><small>{p.logs.length} recorded appearances{p.stale?' · absent latest offensive box score':''}</small></div>      <button className="prop-action" aria-label={`View ${p.name} game log and line comparison`} aria-expanded={chosen===`${p.team.id}:${p.id}`} onClick={()=>setChosen(chosen===`${p.team.id}:${p.id}`?null:`${p.team.id}:${p.id}`)}>Game log &amp; lines</button> </header>
      {(p.unavailable||p.stale)&&<p className="prop-warning">{p.unavailable?'Unavailable or doubtful: projection withheld.':'Absent from the latest offensive box score: recent role needs review.'}</p>}
      <div className="player-metrics" style={{'--metric-count':selectedMetrics(p,filters).length}}>{selectedMetrics(p,filters).map(([key])=><Performance key={key} player={p} metric={key} halfLife={halfLife} lookback={lookback}/>)}</div>

    </article>)}</div>
    {!sorted.length&&<p className="prop-warning">No players match the selected filters.</p>}
    {selected&&<div ref={evidence}><PlayerDetail key={`${selected.team.id}:${selected.id}`} player={selected} data={data} matchup={matchup} halfLife={halfLife} lookback={lookback} saveProp={saveProp}/></div>}
  </section>
}

function History({data,team,roster,lookback,halfLife}){
  const games=historyFor(data,team.id).slice(-lookback).reverse()
  return <section className="prop-history"><h3>{team.name} · recent opponents</h3>{games.map(g=>{
    const [,opponent]=sides(g,team.id)
    const box=opponent.playerBox
    const players=(box?.players||[]).filter(p=>['passAtt','carries','targets','passYds','rushYds','recYds'].some(k=>valid(p[k])&&p[k]!==0))
      .sort((a,b)=>(b.passYds||0)+(b.rushYds||0)+(b.recYds||0)-(a.passYds||0)-(a.rushYds||0)-(a.recYds||0))
    return <article className="prop-opponent" key={g.id}><header><div><b>{opponent.name}</b><span>{date(g.date)} · {opponent.points} points</span></div><a href={`https://www.espn.com/nfl/boxscore/_/gameId/${g.id}`} target="_blank" rel="noreferrer">Box score</a></header>
      {!players.length?<p className="prop-warning">Individual player data unavailable.</p>:<><div className="table-wrap"><table><thead><tr><th>Opponent player</th>{DISPLAY_METRICS.map(([key,name])=><th key={key}>{name}</th>)}</tr></thead><tbody>{players.map(p=><tr key={p.id}><td>{p.name}<small>{positionOf(p,roster)}</small></td>{DISPLAY_METRICS.map(([key])=>{
        const v=valueFor(p,key)
        const base=key==='totalTD'?null:historicalComparison(data,opponent.id,p,key,g.id,halfLife)
        const standout=!key.endsWith('TD')&&base>0&&v>=base*1.2
        return <td key={key} className={standout?'prop-positive':''} title={valid(base)?`Earlier weighted baseline: ${format(base,key)}`:''}>{valid(v)?v:'—'}</td>
      })}</tr>)}</tbody></table></div>
      {['passing','rushing','receiving'].some(cat=>!box.available.includes(cat))&&<p className="prop-warning">Missing or empty categories: {['passing','rushing','receiving'].filter(cat=>!box.available.includes(cat)).join(', ')}. Missing values are not counted as zero.</p>}</>}
    </article>
  })}</section>
}

function Defense({data,team,roster,halfLife,lookback}){
  return <section><h3>{team.name} · defense by opponent position</h3><div className="table-wrap"><table><thead><tr><th>Position</th>{DISPLAY_METRICS.map(([key,name])=><th key={key}>{name} allowed</th>)}</tr></thead><tbody>{['QB','RB','FB','WR','TE'].map(pos=><tr key={pos}><td>{pos}</td>{DISPLAY_METRICS.map(([key])=>{
    const p=key==='totalTD'?null:defenseProfile(data,team.id,pos,key,roster,halfLife,lookback)
    const r=key==='totalTD'?defenseProfile(data,team.id,pos,'rushTD',roster,halfLife,lookback):null
    const c=key==='totalTD'?defenseProfile(data,team.id,pos,'recTD',roster,halfLife,lookback):null
    const value=p?.allowed??(valid(r?.allowed)&&valid(c?.allowed)?r.allowed+c.allowed:null)
    return <td key={key}>{format(value,key)}<small>{p?`${p.games} games · ${p.adjusted?`${((p.factor-1)*100).toFixed(0)}% adj.`:'neutral adj.'}`:'Rush + receiving'}</small></td>
  })}</tr>)}</tbody></table></div></section>
}

export default function MatchupExplorer({saveProp,data,matchup,halfLife,advantage,onClose}){
  const [rosters,setRosters]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('Loading player positions…')
  const [tab,setTab]=useState('projections'),[lookback,setLookback]=useState(4)
  const [filters,setFilters]=useState(()=>defaultFilters(matchup))
  const dialog=useRef(null)
  async function load(force=false){setError('');try{setRosters(await getRosters(data,setMessage,force))}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[data.year])
  useEffect(()=>{
    const previous=document.activeElement,original=document.body.style.overflow
    document.body.style.overflow='hidden';dialog.current?.querySelector('button')?.focus()
    function key(e){if(e.key==='Escape'){e.preventDefault();onClose()}if(e.key==='Tab'){
      const items=[...dialog.current.querySelectorAll('button,input,select,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length),first=items[0],last=items.at(-1)
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }}
    document.addEventListener('keydown',key)
    return()=>{document.body.style.overflow=original;document.removeEventListener('keydown',key);previous?.focus()}
  },[])
  const players=useMemo(()=>!rosters?[]:[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([team,opponent])=>projectTeam(data,team,opponent,rosters.roster,halfLife,lookback).map(p=>({...p,team,opponent}))),[data,matchup,rosters,halfLife,lookback])
  return <div className="overlay prop-overlay" onClick={onClose}><section ref={dialog} className="prop-modal" role="dialog" aria-modal="true" aria-labelledby="prop-title" onClick={e=>e.stopPropagation()}>
    <header className="prop-header"><div><p className="eyebrow">MATCHUP LAB · WEEK {data.week} · {date(matchup.date)}</p><h2 id="prop-title">{matchup.away.name} <span>at</span> {matchup.home.name}</h2></div><button className="close" onClick={onClose}>Close ✕</button></header>
    <div className="prop-score"><div><small>TEAM MODEL</small><b>{matchup.margin<.05?'Toss-up':`${matchup.winner.abbr} by ${format(matchup.margin)}`}</b></div><div><small>PROJECTED SCORE</small><b>{matchup.away.abbr} {format(matchup.awayPoints)} · {matchup.home.abbr} {format(matchup.homePoints)}</b></div><div><small>VENUE</small><b>{matchup.neutral?'Neutral · no home boost':`Home advantage +${advantage.toFixed(1)}`}</b></div></div>
    <nav className="prop-tabs" aria-label="Matchup analytics">{[['projections','Player projections'],['defense','Defense trends'],['history','Recent opponents'],['bets','Bets']].map(([id,name])=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    <div className="prop-lookback"><span>Recent opponent / game-log window</span><div className="prop-metric-buttons">{[[4,'Last 4'],[6,'Last 6'],[18,'Season']].map(([n,name])=><button key={n} aria-pressed={lookback===n} onClick={()=>setLookback(n)}>{name}</button>)}</div><small>Player EMA uses all recorded appearances · {halfLife}-game half-life</small></div>
    {!rosters&&!error&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="prop-warning">{error} <button onClick={()=>load(true)}>Retry</button></p>}
    {rosters&&<>{rosters.failed.length>0&&<p className="prop-warning">{rosters.failed.length} rosters unavailable; incomplete position totals use neutral adjustments. <button onClick={()=>load(true)}>Retry rosters</button></p>}
      {tab==='projections'&&<Projections filters={filters} setFilters={setFilters} players={players} data={data} matchup={matchup} halfLife={halfLife} lookback={lookback} saveProp={saveProp}/>}
      {tab==='history'&&<><p className="prop-help">Both defenses shown together. Green yardage/reception values were at least 20% above the player's average in three or more earlier appearances.</p>{[matchup.away,matchup.home].map(team=><History key={team.id} data={data} team={team} roster={rosters.roster} lookback={lookback} halfLife={halfLife}/>)}</>}
      {tab==='defense'&&<>{[matchup.away,matchup.home].map(team=><Defense key={team.id} data={data} team={team} roster={rosters.roster} lookback={lookback} halfLife={halfLife}/>)}<p className="prop-help">Position-group totals per opponent game. Adjustments compare opponents' usual output, shrink small samples and cap changes at ±25%.</p></>}
      {tab==='bets'&&<Bets filters={filters} setFilters={setFilters} data={data} matchup={matchup} roster={rosters.roster} halfLife={halfLife} window={lookback} saveProp={saveProp}/>}
    </>}
    <details className="prop-method"><summary>Team offense vs defense estimates</summary><div className="table-wrap"><table><thead><tr><th>Offense</th><th>Net pass yards</th><th>Rush yards</th></tr></thead><tbody>{[[matchup.away,matchup.home],[matchup.home,matchup.away]].map(([o,d])=><tr key={o.id}><td>{o.abbr} vs {d.abbr}</td><td>{format((o.recent.passO+d.recent.passD)/2)}</td><td>{format((o.recent.rushO+d.recent.rushD)/2)}</td></tr>)}</tbody></table></div></details>
    <details className="prop-method"><summary>Projection method, sources & limitations</summary>
      <p>Player baseline = normalized exponential average of current-team recorded offensive appearances; at least three are required. Each statistic is adjusted for recent opponent position-group production versus those opponents' usual production in other prior games. Ratios shrink by n/(n+4), need three usable games, and are capped at 0.75–1.25; otherwise neutral adjustment. TD scored is the sum of the rushing and receiving TD projections, requires three joint complete appearances, and excludes passing TDs.</p>
      <p>Player passing yards are gross; team passing yards are net of sack losses. Expected TD counts are not probabilities. Ranges and hit counts describe recorded games, not calibrated prediction intervals or win probabilities. Multiple markets on one player are correlated. No live sportsbook lines or odds are fetched; comparisons use your entries.</p>
      <p>ESPN current roster status and one offensive appearance in the last two team games determine eligibility. Out/doubtful projections are withheld; questionable status is displayed. Status may lag. No confirmed starting-QB adjustment, snap counts, weather, or injury-driven role redistribution is modeled. Player projections do not reconcile to team scores. Missing appearances are not silently counted as zero.</p>
      <p>Sources: ESPN prior-week box scores (24-hour cache) and rosters (30-minute session cache). Positions come from box scores when available, otherwise current rosters. Current-week results are excluded. Team snapshot: {new Date(data.updated).toLocaleString('en-US',{timeZone:'America/New_York'})} ET. Roster snapshot: {rosters?new Date(rosters.time).toLocaleString('en-US',{timeZone:'America/New_York'}):'Loading'} ET.</p>
      <a href={matchup.source} target="_blank" rel="noreferrer">ESPN matchup source</a>
    </details>
  </section></div>
}
