import { useEffect, useRef, useState } from 'react'
import { getRosters } from './data.js'
import { valid, historyFor, sides, positionOf } from './model.js'
import Flyers from './Flyers.jsx'
import Parlays from './Parlays.jsx'
import PlayerProjections, {projectionGroups} from './PlayerProjections.jsx'
import ScatterTab from './ScatterTab.js'
import CoverageTab from './CoverageTab.jsx'
import './props.css'
const format=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})
const positions=['QB','RB','WR','TE']
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
function ProjectionFilters({title,items,selected,onToggle}){
  return <fieldset className="projection-filter-group"><legend>{title}</legend>{items.map(([key,name])=><label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={()=>onToggle(key)}/>{name}</label>)}</fieldset>
}

export default function MatchupExplorer({saveProp,data,matchup,halfLife,advantage,onClose}){
  const [rosters,setRosters]=useState(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('Loading player positions…')
  const [tab,setTab]=useState('bets')
  const [betsView,setBetsView]=useState('flyers')
  const [offenseId,setOffenseId]=useState(matchup.away.id)
  const [historyPositions,setHistoryPositions]=useState(['QB','RB','WR','TE'])
  const [window,setWindow]=useState(4)
  const [projectionTeams,setProjectionTeams]=useState([matchup.away.id,matchup.home.id])
  const [projectionPositions,setProjectionPositions]=useState(positions)
  const [projectionCategories,setProjectionCategories]=useState(Object.keys(projectionGroups))
  const dialog=useRef(null)
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
  const projectionTeamsList=[[matchup.away,matchup.home],[matchup.home,matchup.away]].filter(([team])=>projectionTeams.includes(team.id)).map(([team,opponent])=>({team,opponent}))
  return <div className="overlay prop-overlay" onClick={onClose}><section ref={dialog} className="prop-modal" role="dialog" aria-modal="true" aria-labelledby="prop-title" onClick={e=>e.stopPropagation()}>
    <header className="prop-header"><div><p className="eyebrow">MATCHUP LAB · WEEK {data.week} · {date(matchup.date)}</p><h2 id="prop-title">{matchup.away.name} <span>at</span> {matchup.home.name}</h2></div><button className="close" onClick={onClose}>Close ✕</button></header>
    <div className="prop-score"><div><small>TEAM MODEL</small><b>{matchup.margin<.05?'Toss-up':`${matchup.winner.abbr} by ${format(matchup.margin)}`}</b></div><div><small>PROJECTED SCORE</small><b>{matchup.away.abbr} {format(matchup.awayPoints)} · {matchup.home.abbr} {format(matchup.homePoints)}</b></div><div><small>VENUE</small><b>{matchup.neutral?'Neutral · no home boost':`Home advantage +${advantage.toFixed(1)}`}</b></div></div>
    <nav className="prop-tabs" aria-label="Matchup analytics">{[['bets','Bets'],['scatter','Scatter Plot'],['coverage','Coverage Breakdown'],['history','Recent opponents']].map(([id,name])=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    {tab==='bets'&&<nav className="prop-tabs prop-subtabs" aria-label="Bets views">{[['flyers','Flyers'],['projections','Player Projections'],['parlays','Parlays']].map(([id,name])=><button key={id} aria-pressed={betsView===id} className={betsView===id?'active':''} onClick={()=>setBetsView(id)}>{name}</button>)}</nav>}
      {tab==='scatter'&&<ScatterTab away={matchup.away} home={matchup.home} week={data.week}/>}
      {tab==='coverage'&&<CoverageTab away={matchup.away} home={matchup.home} week={data.week}/>}
    {tab==='bets'&&betsView==='projections'&&<div className="projection-filters" aria-label="Player projection filters">
      <ProjectionFilters title="Teams" items={[[matchup.away.id,matchup.away.name],[matchup.home.id,matchup.home.name]]} selected={projectionTeams} onToggle={key=>toggle(setProjectionTeams,projectionTeams,key)}/>
      <ProjectionFilters title="Positions" items={positions.map(value=>[value,value])} selected={projectionPositions} onToggle={key=>toggle(setProjectionPositions,projectionPositions,key)}/>
      <ProjectionFilters title="Stat categories" items={Object.keys(projectionGroups).map(key=>[key,key])} selected={projectionCategories} onToggle={key=>toggle(setProjectionCategories,projectionCategories,key)}/>
      <div className="projection-window"><strong>Recent games</strong>{[[4,'Last 4'],[6,'Last 6'],[18,'Season']].map(([value,name])=><button key={value} aria-pressed={window===value} onClick={()=>setWindow(value)}>{name}</button>)}</div>
      <button className="prop-action" onClick={()=>{setProjectionTeams([matchup.away.id,matchup.home.id]);setProjectionPositions(positions);setProjectionCategories(Object.keys(projectionGroups))}}>Reset filters</button>
    </div>}
    {tab==='history'&&<div className="prop-controls history-controls">
      <label>Team<select value={defense.id} onChange={e=>setOffenseId(e.target.value===matchup.away.id?matchup.home.id:matchup.away.id)}><option value={matchup.away.id}>{matchup.away.name}</option><option value={matchup.home.id}>{matchup.home.name}</option></select></label>
      <fieldset className="history-position-filter"><legend>Positions</legend>{['QB','RB','WR','TE'].map(pos=><label key={pos}><input type="checkbox" checked={historyPositions.includes(pos)} onChange={e=>setHistoryPositions(current=>e.target.checked?[...current,pos]:current.filter(value=>value!==pos))}/>{pos}</label>)}</fieldset>
    </div>}
    {!rosters&&!error&&<p role="status" className="notice">{message}</p>}
    {error&&<p role="alert" className="prop-warning">{error} <button onClick={()=>load(true)}>Retry</button></p>}
    {rosters&&<>
      {rosters.failed.length>0&&<p className="prop-warning">{rosters.failed.length} team rosters unavailable. Unknown positions are labeled; incomplete position groups are excluded from adjustments. <button onClick={()=>load(true)}>Retry rosters</button></p>}
      {tab==='bets'&&betsView==='projections'&&<PlayerProjections matchup={matchup} saveProp={saveProp} data={data} teams={projectionTeamsList} roster={rosters.roster} halfLife={halfLife} window={window} positions={projectionPositions} categories={projectionCategories}/>}
      {tab==='bets'&&betsView==='flyers'&&<Flyers data={data} matchup={matchup} roster={rosters.roster} halfLife={halfLife} window={window}/>}
      {tab==='bets'&&betsView==='parlays'&&<Parlays data={data} matchup={matchup} roster={rosters.roster} halfLife={halfLife} window={window}/>}
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
