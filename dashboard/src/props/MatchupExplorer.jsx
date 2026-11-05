import { useEffect, useMemo, useRef, useState } from 'react'
import { getRosters } from './data.js'
import { METRICS, valid, weighted, historyFor, sides, positionOf, projectTeam, defenseProfile, historicalComparison } from './model.js'
import './props.css'
const format=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})
const positions=['QB','RB','FB','WR','TE']
const statsFor=p=>p==='QB'?['passYds','passTD','rushYds','rushTD']:p==='WR'||p==='TE'?['rec','recYds','recTD']:['rushYds','rushTD','rec','recYds','recTD']
const label=k=>METRICS.find(([key])=>key===k)?.[1]||k

function Historical({data,defense,roster,window,position,halfLife,metric}){
  const games=historyFor(data,defense.id).slice(-window).reverse()
  return <div className="prop-history"><div className="prop-section-title"><h3>What opponents produced against {defense.abbr}</h3><span>Actual box scores · most recent first</span></div>
    <p className="prop-help">Each card is an opponent, grouped by player position—like your notes. Highlighted values were at least 20% above that player's weighted average from three or more earlier appearances. TDs are listed, not labeled a breakout.</p>
    {games.map(g=>{
      const [,opponent]=sides(g,defense.id)
      const players=opponent.playerBox?.players||[]
      return <article className="prop-opponent" key={g.id}>
        <header><div><b>{opponent.name}</b><span>{date(g.date)} · {opponent.points} points</span></div><a target="_blank" rel="noreferrer" href={`https://www.espn.com/nfl/boxscore/_/gameId/${g.id}`}>Box score ↗</a></header>
        {!players.length?<p className="prop-warning">Individual player data unavailable for this game.</p>:<>
          {['passing','rushing','receiving'].some(cat=>!opponent.playerBox.available.includes(cat))&&<p className="prop-warning">Missing or empty box-score categories: {['passing','rushing','receiving'].filter(cat=>!opponent.playerBox.available.includes(cat)).join(', ')}. These are shown as missing, not zero.</p>}
          {(position==='all'?[...positions,'?']:[position]).map(pos=>{
            const group=players.filter(p=>positionOf(p,roster)===pos)
              .filter(p=>statsFor(pos).some(k=>valid(p[k])&&p[k]!==0))
              .sort((a,b)=>(b[metric]||0)-(a[metric]||0))
            if(!group.length)return null
            return <section className="prop-position" key={pos}><strong>{pos==='?'?'Unknown position':pos}</strong><div>{group.map(p=><div className="prop-player-line" key={p.id}><b>{p.name}</b><span>{statsFor(pos).map(k=>{
              const baseline=historicalComparison(data,opponent.id,p,k,g.id,halfLife)
              const highlight=!k.endsWith('TD')&&valid(baseline)&&baseline>0&&p[k]>=baseline*1.2
              return <span key={k} className={highlight?'prop-breakout':''} title={valid(baseline)?`Earlier weighted average: ${format(baseline,k)}`:'Insufficient earlier appearances for comparison'}>{label(k)} <b>{valid(p[k])?String(p[k]):'—'}</b></span>
            })}</span></div>)}</div></section>
          })}
        </>}
      </article>
    })}
  </div>
}

function PositionDefense({data,defense,roster,halfLife,window,position,metric}){
  return <section><div className="prop-section-title"><h3>{defense.abbr} defense vs position</h3><span>Position-group totals per opponent game</span></div>
    <div className="table-wrap"><table><thead><tr><th>Position</th><th>Recent allowed</th><th>Opponents' usual output</th><th>Projection adjustment</th><th>Usable games</th></tr></thead><tbody>
      {(position==='all'?positions:[position]).map(pos=>{
        const p=defenseProfile(data,defense.id,pos,metric,roster,halfLife,window)
        return <tr key={pos}><td><b>{pos}</b></td><td>{format(p.allowed,metric)}</td><td>{format(p.expected,metric)}</td><td className={p.factor>1.01?'prop-positive':p.factor<.99?'prop-negative':''}>{p.adjusted?`${p.factor>=1?'+':''}${((p.factor-1)*100).toFixed(1)}%`:'Neutral · insufficient baseline'}</td><td>{p.sample}/{window}<small>{label(metric)}</small></td></tr>
      })}
    </tbody></table></div>
    <p className="prop-help">A positive adjustment means this defense allowed more to the position than its recent opponents normally produced. The comparison excludes the game being evaluated. Adjustments shrink toward neutral and are capped at ±25%. Unknown player positions suppress incomplete position totals.</p>
  </section>
}

function PlayerProjections({data,team,opponent,roster,halfLife,window,position,metric}){
  const [chosen,setChosen]=useState('')
  const [line,setLine]=useState('')
  const [ascending,setAscending]=useState(false)
  const projections=useMemo(()=>projectTeam(data,team,opponent,roster,halfLife,window),[data,team,opponent,roster,halfLife,window])
  const players=projections.filter(p=>position==='all'||p.position===position)
    .sort((a,b)=>{
      const av=a.stats[metric].projection,bv=b.stats[metric].projection
      if(!valid(av))return valid(bv)?1:0
      if(!valid(bv))return -1
      return (av-bv)*(ascending?1:-1)
    })
  const selected=projections.find(p=>p.id===chosen)
  const selectedStat=selected?.stats[metric]
  const validLine=line.trim()!==''&&Number.isFinite(Number(line))&&Number(line)>=0
  const sample=selected?.lastFour.filter(l=>valid(l[metric]))||[]
  const over=validLine?sample.filter(l=>l[metric]>Number(line)).length:0
  const pushes=validLine?sample.filter(l=>l[metric]===Number(line)).length:0
  return <section><div className="prop-section-title"><h3>{team.abbr} player projections vs {opponent.abbr}</h3><span>Conditional on playing a comparable role</span></div>
    <div className="table-wrap"><table><thead><tr><th>Player / position</th><th>Recent usage</th><th>Weighted baseline</th><th>Matchup adj.</th><th><button className="sort" onClick={()=>setAscending(!ascending)}>Projected {label(metric)} {ascending?'↑':'↓'}</button></th><th>Recent observed range</th><th>Appearances</th></tr></thead><tbody>
      {players.map(p=>{
        const s=p.stats[metric]
        const usageKey=p.position==='QB'?'passAtt':metric.startsWith('rush')?'carries':'targets'
        const usage=weighted(p.logs,usageKey,halfLife)
        return <tr key={p.id}><td><button className={`prop-name ${chosen===p.id?'selected':''}`} onClick={()=>setChosen(p.id)}>{p.name}</button><small>{p.position} · {p.status}{p.injury?` · ${p.injury}`:''}{p.stale?' · absent latest offensive box score':''}</small></td>
          <td>{format(usage)}<small>{usageKey==='passAtt'?'pass attempts':usageKey==='carries'?'carries':'targets'} / appearance</small></td>
          <td>{format(s.baseline,metric)}</td><td>{s.defense.adjusted?`${s.defense.factor>=1?'+':''}${((s.defense.factor-1)*100).toFixed(1)}%`:'Neutral'}<small>{s.defense.sample} usable opponent games</small></td>
          <td className="prop-projection">{p.unavailable?'Withheld':format(s.projection,metric)}<small>{p.unavailable?'Unavailable / doubtful roster designation':p.limited?'Need 3 appearances':label(metric)}</small></td>
          <td>{valid(s.min)?`${format(s.min,metric)}–${format(s.max,metric)}`:'—'}<small>Last {window} recorded appearances</small></td><td>{s.sample}<small>{p.logs.length<5?'Small sample':'Current-team box scores'}</small></td></tr>
      })}
    </tbody></table></div>
    {!players.length&&<p className="prop-warning">No resolved current-roster players match this position and recent participation filter.</p>}
    <p className="prop-help">Click a player's name for their game log and a manual prop-line comparison. Players must appear in an offensive box score in one of the team's last two games. Missing appearances are not silently counted as zero. No snap-count or starter confirmation is available.</p>
    {selected&&<div className="prop-comparison"><h3>{selected.name} · {label(metric)}</h3>
      <label>Your prop line <input type="number" min="0" step="0.5" placeholder="Enter a line, e.g. 64.5" value={line} onChange={e=>setLine(e.target.value)}/></label>
      {validLine&&<p>{!selected.unavailable&&valid(selectedStat.projection)?<>Projection <b>{format(selectedStat.projection,metric)}</b> · Difference from your line <b>{(selectedStat.projection-Number(line)).toFixed(1)}</b> · </>:null}Over your line in <b>{over}/{sample.length}</b> recent recorded appearances{pushes?` (${pushes} pushes)`:''}. Historical frequency is not a forecast probability.</p>}
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th>{METRICS.map(([k,l])=><th key={k}>{l}</th>)}</tr></thead><tbody>{[...selected.logs].reverse().map(l=><tr key={l.gameId}><td>{date(l.date)}</td><td>{l.opponent}</td>{METRICS.map(([k])=><td key={k}>{format(l[k],k)}</td>)}</tr>)}</tbody></table></div>
    </div>}
  </section>
}

export default function MatchupExplorer({data,matchup,halfLife,advantage,onClose}){
  const [rosters,setRosters]=useState(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('Loading player positions…')
  const [tab,setTab]=useState('projections')
  const [offenseId,setOffenseId]=useState(matchup.away.id)
  const [position,setPosition]=useState('all')
  const [metric,setMetric]=useState('recYds')
  const [window,setWindow]=useState(4)
  const dialog=useRef(null)
  const offense=offenseId===matchup.away.id?matchup.away:matchup.home
  const defense=offenseId===matchup.away.id?matchup.home:matchup.away
  async function load(force=false){
    setError('');setMessage('Loading player positions…')
    try{setRosters(await getRosters(data,setMessage,force))}catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[data.year])
  useEffect(()=>{
    const previous=document.activeElement
    const original=document.body.style.overflow
    document.body.style.overflow='hidden'
    dialog.current?.querySelector('button')?.focus()
    function key(e){
      if(e.key==='Escape'){e.preventDefault();onClose()}
      if(e.key==='Tab'){
        const items=[...dialog.current.querySelectorAll('button,input,select,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length)
        const first=items[0],last=items.at(-1)
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }
    }
    document.addEventListener('keydown',key)
    return()=>{document.body.style.overflow=original;document.removeEventListener('keydown',key);previous?.focus()}
  },[])
  const playerGames=data.games.filter(g=>[g.away,g.home].some(s=>s.playerBox?.players.length)).length
  return <div className="overlay prop-overlay" onClick={onClose}><section ref={dialog} className="prop-modal" role="dialog" aria-modal="true" aria-labelledby="prop-title" onClick={e=>e.stopPropagation()}>
    <header className="prop-header"><div><p className="eyebrow">MATCHUP LAB · WEEK {data.week} · {date(matchup.date)}</p><h2 id="prop-title">{matchup.away.name} <span>at</span> {matchup.home.name}</h2></div><button className="close" onClick={onClose}>Close ✕</button></header>
    <div className="prop-score"><div><small>TEAM MODEL</small><b>{matchup.margin<.05?'Toss-up':`${matchup.winner.abbr} by ${format(matchup.margin)}`}</b></div><div><small>PROJECTED SCORE</small><b>{matchup.away.abbr} {format(matchup.awayPoints)} · {matchup.home.abbr} {format(matchup.homePoints)}</b></div><div><small>VENUE</small><b>{matchup.neutral?'Neutral · no home boost':`Home advantage +${advantage.toFixed(1)}`}</b></div></div>
    <nav className="prop-tabs" aria-label="Matchup analytics">{[['projections','Player projections'],['defense','Defense vs position'],['history','Recent opponents']].map(([id,name])=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    <div className="prop-controls">
      <label>Offense to analyze<select value={offenseId} onChange={e=>setOffenseId(e.target.value)}><option value={matchup.away.id}>{matchup.away.name}</option><option value={matchup.home.id}>{matchup.home.name}</option></select></label>
      <label>Position<select value={position} onChange={e=>setPosition(e.target.value)}><option value="all">All skill positions</option>{positions.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>Stat<select value={metric} onChange={e=>setMetric(e.target.value)}>{METRICS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      <label>Defense lookback<select value={window} onChange={e=>setWindow(Number(e.target.value))}><option value={4}>Last 4 games</option><option value={6}>Last 6 games</option><option value={18}>All prior games</option></select></label>
    </div>
    <div className="prop-context"><span>Studying <b>{offense.abbr} offense</b> against <b>{defense.abbr} defense</b></span><span>EMA half-life: {halfLife} games</span></div>
    {!rosters&&!error&&<p role="status" className="notice">{message}</p>}
    {error&&<p role="alert" className="prop-warning">{error} <button onClick={()=>load(true)}>Retry</button></p>}
    {rosters&&<>
      {rosters.failed.length>0&&<p className="prop-warning">{rosters.failed.length} team rosters unavailable. Unknown positions are labeled; incomplete position groups are excluded from adjustments. <button onClick={()=>load(true)}>Retry rosters</button></p>}
      {tab==='projections'&&<PlayerProjections key={offense.id} data={data} team={offense} opponent={defense} roster={rosters.roster} halfLife={halfLife} window={window} position={position} metric={metric}/>}
      {tab==='defense'&&<PositionDefense data={data} defense={defense} roster={rosters.roster} halfLife={halfLife} window={window} position={position} metric={metric}/>}
      {tab==='history'&&<Historical data={data} defense={defense} roster={rosters.roster} halfLife={halfLife} window={window} position={position} metric={metric}/>}
    </>}
    <details className="prop-method"><summary>Team offense vs defense estimates</summary><div className="table-wrap"><table><thead><tr><th>Offense</th><th>Expected net pass yards</th><th>Expected rush yards</th></tr></thead><tbody>{[[matchup.away,matchup.home],[matchup.home,matchup.away]].map(([o,d])=><tr key={o.id}><td>{o.abbr} vs {d.abbr}</td><td>{format((o.recent.passO+d.recent.passD)/2)}</td><td>{format((o.recent.rushO+d.recent.rushD)/2)}</td></tr>)}</tbody></table></div></details>
    <details className="prop-method"><summary>Projection method, sources & limitations</summary>
      <p>Player baseline = normalized exponential average of current-team recorded offensive appearances, using the dashboard's {halfLife}-game half-life. At least three appearances are required. Defense adjustment = recent position-group production allowed divided by those opponents' usual position-group production in their other prior games. Ratios shrink toward 1 using n/(n+4), require three usable defensive games, and are capped at 0.75–1.25. Projection = baseline × adjustment. When the opponent comparison is insufficient, use neutral adjustment.</p>
      <p>Player passing yards are gross passing yards; the main team board uses net passing yards. TD columns show expected TD counts per appearance (e.g. 0.35), not a promise to score or a calibrated anytime-TD probability. Recent observed ranges are descriptive min/max, not confidence intervals. Prop lines are entered manually; no live odds, edge probabilities or expected-value claims.</p>
      <p>Eligibility uses current ESPN rosters and an offensive box-score appearance in one of the last two team games. Unavailable/doubtful players have projections withheld; questionable status is displayed. Roster designations may lag. No confirmed starters, snap counts, injury role redistribution, weather or separate home/away player adjustment. Player projections are independent of the displayed team-score model and do not reconcile to its totals. Absence from a box score is not proof of injury or inactivity.</p>
      <p>Source: ESPN individual game box scores (24-hour cache) and current season team rosters (30-minute session cache). All inputs are prior-week games; current-week results are excluded. Historical positions are resolved from box-score position when available, otherwise current roster position, which can differ from historical roles. Coverage: {playerGames}/{data.games.length} historical games have individual player rows. Team snapshot: {new Date(data.updated).toLocaleString('en-US',{timeZone:'America/New_York'})} ET. Rosters: {rosters?new Date(rosters.time).toLocaleString('en-US',{timeZone:'America/New_York'}):'Loading'} ET.</p>
      <a href={matchup.source} target="_blank" rel="noreferrer">ESPN matchup source ↗</a>
    </details>
  </section></div>
}
