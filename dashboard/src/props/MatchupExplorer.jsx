import { useEffect, useMemo, useRef, useState } from 'react'
import { getRosters } from './data.js'
import { METRICS, valid, weighted, historyFor, sides, positionOf, projectTeam, defenseProfile } from './model.js'
import Bets, {breakoutRating,ratingLevel} from './Bets.jsx'
import Performance, {PerformanceLegend} from './Performance.jsx'
import Flyers from './Flyers.jsx'
import './props.css'
const format=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})
const positions=['QB','RB','FB','WR','TE']
const statsFor=p=>p==='QB'?['passYds','passTD','rushYds','rushTD']:['RB','FB'].includes(p)?['rushYds','rec','recYds','totalTD']:p==='WR'||p==='TE'?['rec','recYds','totalTD']:[]
const label=k=>k==='totalTD'?'TDs':METRICS.find(([key])=>key===k)?.[1]||k
const boxStat=(p,k)=>k==='totalTD'?(valid(p.rushTD)&&valid(p.recTD)?p.rushTD+p.recTD:null):p[k]

function Historical({data,defense,roster,window,selectedPositions}){
  const games=historyFor(data,defense.id).slice(-window).reverse()
  const order=['QB','RB','WR','TE']
  return <div className="prop-history"><div className="prop-section-title"><h3>Recent opponents of {defense.abbr}</h3><span>Actual box scores · most recent first</span></div>
    <div className="table-wrap"><table className="recent-opponents-table"><thead><tr><th>Position</th><th>Player</th><th>Pass yds · TD</th><th>Rush yds</th><th>Receptions · Rec yds</th><th>TDs</th></tr></thead>
      {games.map(g=>{
        const [,opponent]=sides(g,defense.id)
        const players=opponent.playerBox?.players||[]
        const rows=order.filter(pos=>selectedPositions.includes(pos)).flatMap(pos=>players
          .filter(player=>{
            const actual=positionOf(player,roster)
            return pos==='RB'?actual==='RB'||actual==='FB':actual===pos
          })
          .filter(player=>['passYds','passTD','rushYds','rec','recYds','totalTD'].some(key=>valid(boxStat(player,key))&&boxStat(player,key)!==0))
          .sort((a,b)=>a.name.localeCompare(b.name))
          .map(player=>({player,pos})))
        return <tbody key={g.id}>
          <tr className="recent-opponent-heading"><th colSpan="6"><span>{opponent.name} · {date(g.date)} · {opponent.points} points</span><a target="_blank" rel="noreferrer" href={`https://www.espn.com/nfl/boxscore/_/gameId/${g.id}`}>Box score ↗</a></th></tr>
          {!players.length?<tr><td colSpan="6">Individual player data unavailable for this game.</td></tr>:rows.length?rows.map(({player,pos})=><tr key={player.id}>
            <td>{pos}</td><td>{player.name}</td>
            <td>{valid(player.passYds)?player.passYds:'—'} · {valid(player.passTD)?player.passTD:'—'}</td>
            <td>{valid(player.rushYds)?player.rushYds:'—'}</td>
            <td>{valid(player.rec)?player.rec:'—'} · {valid(player.recYds)?player.recYds:'—'}</td>
            <td>{valid(boxStat(player,'totalTD'))?boxStat(player,'totalTD'):'—'}</td>
          </tr>):<tr><td colSpan="6">No players for the selected positions.</td></tr>}
        </tbody>
      })}
    </table></div>
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

const projectionGroups={Passing:['passYds','passTD'],Rushing:['rushYds','rushTD'],Receiving:['rec','recYds'],TDs:['passTD','rushTD','totalTD']}
const projectionStatLabel={passYds:'Passing yards',passTD:'Passing TDs',rushYds:'Rushing yards',rushTD:'Rushing TDs',rec:'Receptions',recYds:'Receiving yards',totalTD:'TDs'}
const projectionStatCategory={passYds:['Passing'],passTD:['Passing','TDs'],rushYds:['Rushing'],rushTD:['Rushing','TDs'],rec:['Receiving'],recYds:['Receiving'],totalTD:['TDs']}
function projectionStats(position,categories){
  const keys=position==='QB'?['passYds','passTD','rushYds','rushTD']:['RB','FB'].includes(position)?['rushYds','rec','recYds','totalTD']:['WR','TE'].includes(position)?['rec','recYds','totalTD']:[]
  return keys.filter(key=>projectionStatCategory[key].some(category=>categories.includes(category)))
}
function projectedValue(player,key){
  if(key!=='totalTD')return player.stats[key]?.projection
  const rush=player.stats.rushTD?.projection,rec=player.stats.recTD?.projection
  return valid(rush)&&valid(rec)?rush+rec:null
}
function logValue(log,key,position){
  if(key!=='totalTD')return log[key]
  const keys=position==='QB'?['rushTD']:['rushTD','recTD']
  return keys.every(k=>valid(log[k]))?keys.reduce((sum,k)=>sum+log[k],0):null
}
function ProjectionFilters({title,items,selected,onToggle}){
  return <fieldset className="projection-filter-group"><legend>{title}</legend>{items.map(([key,name])=><label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={()=>onToggle(key)}/>{name}</label>)}</fieldset>
}
function PlayerProjections({matchup,saveProp,data,teams,roster,halfLife,window,positions,categories}){
  const [chosen,setChosen]=useState(''),[line,setLine]=useState(''),[lineMetric,setLineMetric]=useState(''),[trackMessage,setTrackMessage]=useState(''),[sortKey,setSortKey]=useState('recYds'),[ascending,setAscending]=useState(false)
  const sortableKeys=[...new Set(Object.entries(projectionGroups).filter(([group])=>categories.includes(group)).flatMap(([,keys])=>keys))]
  const activeSortKey=sortableKeys.includes(sortKey)?sortKey:sortableKeys[0]||'recYds'
  const players=useMemo(()=>teams.flatMap(({team,opponent})=>projectTeam(data,team,opponent,roster,halfLife,window).map(player=>({...player,team,opponent})))
    .filter(player=>positions.includes(player.position)&&projectionStats(player.position,categories).length>0)
    .sort((a,b)=>{const av=projectedValue(a,activeSortKey),bv=projectedValue(b,activeSortKey);if(!valid(av))return valid(bv)?1:a.name.localeCompare(b.name);if(!valid(bv))return -1;return (av-bv)*(ascending?1:-1)||a.name.localeCompare(b.name)}),[teams,data,roster,halfLife,window,positions,categories,activeSortKey,ascending])
  const selected=players.find(player=>`${player.team.id}:${player.id}`===chosen)
  const selectedMetrics=selected?projectionStats(selected.position,categories):[]
  const validLine=line.trim()!==''&&Number.isFinite(Number(line))&&Number(line)>=0
  const selectedStat=selected&&lineMetric?projectedValue(selected,lineMetric):null
  const sample=selected?.logs.slice(-window).map(log=>logValue(log,lineMetric,selected.position)).filter(valid)||[]
  const over=validLine?sample.filter(value=>value>Number(line)).length:0
  const pushes=validLine?sample.filter(value=>value===Number(line)).length:0
  function choosePlayer(player,key){setChosen(`${player.team.id}:${player.id}`);setLineMetric(key);setLine('');setTrackMessage('')}
  return <section><div className="prop-section-title"><h3>Player projections · both teams</h3><span>One full-width row per player · highest projection first</span></div>
    <PerformanceLegend/>
    <div className="projection-sort"><label>Order by <select value={activeSortKey} onChange={event=>setSortKey(event.target.value)}>{sortableKeys.map(key=><option key={key} value={key}>{projectionStatLabel[key]}</option>)}</select></label><button className="prop-action" onClick={()=>setAscending(value=>!value)}>{ascending?'Lowest first':'Highest first'}</button></div>
    <div className="player-card-grid">{players.map(player=>{
      const metrics=projectionStats(player.position,categories).map(key=>[key,projectionStatLabel[key]])
      return <article className="player-research-card player-row" key={`${player.team.id}:${player.id}`} aria-label={`${player.name} projections`}>
        <header><div><h4>{player.name}</h4><p>{player.team.abbr} · {player.position} · {player.injury||player.status}</p><small>{player.logs.length} recorded appearances</small>
          <div className={`projection-breakout-preview breakout-${ratingLevel(breakoutRating(player))}`}><span>Breakout preview</span><b>{ratingLevel(breakoutRating(player))==='unknown'?'Not rated':ratingLevel(breakoutRating(player))==='moderate'?'Moderate':ratingLevel(breakoutRating(player))[0].toUpperCase()+ratingLevel(breakoutRating(player)).slice(1)}</b></div>
        </div><button className="prop-action" aria-label={`View ${player.name} game log and line comparison`} aria-expanded={chosen===`${player.team.id}:${player.id}`} onClick={()=>choosePlayer(player,metrics[0]?.[0])}>Game log &amp; lines</button></header>
        {player.unavailable&&<p className="prop-warning">Unavailable or doubtful: projection withheld.</p>}
        <div className="player-metrics" style={{'--metric-count':metrics.length}}>{metrics.map(([key])=><div className="player-stat-detail" key={key} onClick={()=>choosePlayer(player,key)}><Performance player={player} metric={key} halfLife={halfLife} lookback={window}/></div>)}</div>
      </article>
    })}</div>
    {!players.length&&<p className="prop-warning">No players match the selected team, position, and stat filters.</p>}
    <p className="prop-help">QB rows show passing yards, passing TDs, rushing yards, and rushing TDs. RB rows show rushing yards, receptions, receiving yards, and combined rushing/receiving TDs. WR/TE rows show receptions, receiving yards, and combined TDs. Expand the colored support headline for recent hit frequency and benchmark details. Recent middle-range values and big-game benchmark numbers are labeled on each scale.</p>
    {selected&&<div className="prop-comparison"><h3>{selected.name} · {projectionStatLabel[lineMetric]}</h3>
      <label>Your prop line <input type="number" min="0" step="0.5" placeholder="Enter a line, e.g. 64.5" value={line} onChange={event=>setLine(event.target.value)}/></label>
      {validLine&&!selected.unavailable&&valid(selectedStat)&&selectedStat!==Number(line)&&!matchup.started&&<button onClick={()=>{
        if(Date.now()>=Date.parse(matchup.date))return setTrackMessage('Kickoff has passed.')
        const pick=selectedStat>Number(line)?'Over':'Under'
        try{saveProp(`${matchup.id}:${selected.id}:${lineMetric}`,{week:`${data.year} Week ${data.week}`,date:matchup.date,player:selected.name,position:selected.position,team:selected.team.abbr,teamName:selected.team.name,metric:projectionStatLabel[lineMetric],line:Number(line),pick,result:'Pending'});setTrackMessage(`Saved ${selected.name} ${pick.toLowerCase()} ${line}.`)}catch{setTrackMessage('This browser could not save the prop.')}
      }}>Track model pick</button>}
      {trackMessage&&<p role="status">{trackMessage}</p>}
      {validLine&&<p>{valid(selectedStat)?<>Projection <b>{format(selectedStat,lineMetric)}</b> · difference from line <b>{format(selectedStat-Number(line),lineMetric)}</b> · </>:null}Over this line in <b>{over}/{sample.length}</b> recent appearances{pushes?` (${pushes} pushes)`:''}. Historical frequency is not a probability.</p>}
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th>{selectedMetrics.map(key=><th key={key}>{projectionStatLabel[key]}</th>)}</tr></thead><tbody>{[...selected.logs].reverse().map(log=><tr key={log.gameId}><td>{date(log.date)}</td><td>{log.opponent}</td>{selectedMetrics.map(key=><td key={key}>{format(logValue(log,key,selected.position),key)}</td>)}</tr>)}</tbody></table></div>
    </div>}
  </section>
}

export default function MatchupExplorer({saveProp,data,matchup,halfLife,advantage,onClose}){
  const [rosters,setRosters]=useState(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('Loading player positions…')
  const [tab,setTab]=useState('projections')
  const [offenseId,setOffenseId]=useState(matchup.away.id)
  const [position,setPosition]=useState('all')
  const [historyPositions,setHistoryPositions]=useState(['QB','RB','WR','TE'])
  const [metric,setMetric]=useState('recYds')
  const [window,setWindow]=useState(4)
  const [projectionTeams,setProjectionTeams]=useState([matchup.away.id,matchup.home.id])
  const [projectionPositions,setProjectionPositions]=useState(positions)
  const [projectionCategories,setProjectionCategories]=useState(Object.keys(projectionGroups))
  const dialog=useRef(null)
  const offense=offenseId===matchup.away.id?matchup.away:matchup.home
  const defense=offenseId===matchup.away.id?matchup.home:matchup.away
  const toggle=(setter,current,key)=>setter(current.includes(key)?current.filter(value=>value!==key):[...current,key])
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
    <nav className="prop-tabs" aria-label="Matchup analytics">{[['projections','Player projections'],['defense','Defense vs position'],['history','Recent opponents'],['bets','Bets'],['flyers','FLYERS']].map(([id,name])=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    {tab==='projections'&&<div className="projection-filters" aria-label="Player projection filters">
      <ProjectionFilters title="Teams" items={[[matchup.away.id,matchup.away.name],[matchup.home.id,matchup.home.name]]} selected={projectionTeams} onToggle={key=>toggle(setProjectionTeams,projectionTeams,key)}/>
      <ProjectionFilters title="Positions" items={positions.map(value=>[value,value])} selected={projectionPositions} onToggle={key=>toggle(setProjectionPositions,projectionPositions,key)}/>
      <ProjectionFilters title="Stat categories" items={Object.keys(projectionGroups).map(key=>[key,key])} selected={projectionCategories} onToggle={key=>toggle(setProjectionCategories,projectionCategories,key)}/>
      <div className="projection-window"><strong>Recent games</strong>{[[4,'Last 4'],[6,'Last 6'],[18,'Season']].map(([value,name])=><button key={value} aria-pressed={window===value} onClick={()=>setWindow(value)}>{name}</button>)}</div>
      <button className="prop-action" onClick={()=>{setProjectionTeams([matchup.away.id,matchup.home.id]);setProjectionPositions(positions);setProjectionCategories(Object.keys(projectionGroups))}}>Reset filters</button>
    </div>}
    {tab==='defense'&&<><div className="prop-controls">
      <label>Offense to analyze<select value={offenseId} onChange={e=>setOffenseId(e.target.value)}><option value={matchup.away.id}>{matchup.away.name}</option><option value={matchup.home.id}>{matchup.home.name}</option></select></label>
      <label>Position<select value={position} onChange={e=>setPosition(e.target.value)}><option value="all">All skill positions</option>{positions.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>Stat<select value={metric} onChange={e=>setMetric(e.target.value)}>{METRICS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      <label>Defense lookback<select value={window} onChange={e=>setWindow(Number(e.target.value))}><option value={4}>Last 4 games</option><option value={6}>Last 6 games</option><option value={18}>All prior games</option></select></label>
    </div>
    <div className="prop-context"><span>Studying <b>{offense.abbr} offense</b> against <b>{defense.abbr} defense</b></span><span>EMA half-life: {halfLife} games</span></div></>}
    {tab==='history'&&<div className="prop-controls history-controls">
      <label>Team<select value={defense.id} onChange={e=>setOffenseId(e.target.value===matchup.away.id?matchup.home.id:matchup.away.id)}><option value={matchup.away.id}>{matchup.away.name}</option><option value={matchup.home.id}>{matchup.home.name}</option></select></label>
      <fieldset className="history-position-filter"><legend>Positions</legend>{['QB','RB','WR','TE'].map(pos=><label key={pos}><input type="checkbox" checked={historyPositions.includes(pos)} onChange={e=>setHistoryPositions(current=>e.target.checked?[...current,pos]:current.filter(value=>value!==pos))}/>{pos}</label>)}</fieldset>
    </div>}
    {!rosters&&!error&&<p role="status" className="notice">{message}</p>}
    {error&&<p role="alert" className="prop-warning">{error} <button onClick={()=>load(true)}>Retry</button></p>}
    {rosters&&<>
      {rosters.failed.length>0&&<p className="prop-warning">{rosters.failed.length} team rosters unavailable. Unknown positions are labeled; incomplete position groups are excluded from adjustments. <button onClick={()=>load(true)}>Retry rosters</button></p>}
      {tab==='projections'&&<PlayerProjections matchup={matchup} saveProp={saveProp} data={data} teams={[[matchup.away,matchup.home],[matchup.home,matchup.away]].filter(([team])=>projectionTeams.includes(team.id)).map(([team,opponent])=>({team,opponent}))} roster={rosters.roster} halfLife={halfLife} window={window} positions={projectionPositions} categories={projectionCategories}/>}
      {tab==='defense'&&<PositionDefense data={data} defense={defense} roster={rosters.roster} halfLife={halfLife} window={window} position={position} metric={metric}/>}
      {tab==='bets'&&<Bets data={data} matchup={matchup} roster={rosters.roster} halfLife={halfLife} window={window}/>}
      {tab==='flyers'&&<Flyers data={data} matchup={matchup} roster={rosters.roster} halfLife={halfLife} window={window}/>}
      {tab==='history'&&<Historical data={data} defense={defense} roster={rosters.roster} window={window} selectedPositions={historyPositions}/>}
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
