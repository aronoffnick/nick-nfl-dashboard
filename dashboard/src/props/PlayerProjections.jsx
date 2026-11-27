import { useMemo, useState } from 'react'
import { valid } from './model.js'
import { boardFor } from './gameBoard.js'
import { breakoutRating, ratingLevel } from './breakout.js'
import BreakoutScale from './BreakoutScale.jsx'
import Performance from './Performance.jsx'
import RoleTags from './RoleTags.jsx'
import { roleTags } from './roleData.js'
import { roleDecision } from './roleEligibility.js'
import { roleBookForWeek } from '../data/weekFiles.js'

const format=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})
const average=(games,key)=>games.length&&games.every(game=>valid(game[key]))?games.reduce((sum,game)=>sum+game[key],0)/games.length:null
export const projectionGroups={Passing:['passYds'],Rushing:['rushYds'],Receiving:['rec','recYds']}
const fields=[
  ['rec','Receptions'],
  ['recYds','Receiving yards'],
  ['rushYds','Rush yards'],
  ['passYds','Pass yards'],
]
const fieldCategory={rec:['Receiving'],recYds:['Receiving'],rushYds:['Rushing'],passYds:['Passing']}
const fieldLabel=Object.fromEntries(fields)
function categoryAllows(key,categories){return fieldCategory[key].some(category=>categories.includes(category))}
function logValue(log,key){
  if(key!=='totalTD')return log[key]
  return valid(log.rushTD)&&valid(log.recTD)?log.rushTD+log.recTD:null
}
function projectedValue(player,key){
  if(key!=='totalTD')return player.stats[key]?.projection
  const rush=player.stats.rushTD?.projection,rec=player.stats.recTD?.projection
  return valid(rush)&&valid(rec)?rush+rec:null
}
const roleStats={
  QB:['passYds','rushYds'],
  RB:['rushYds','rec','recYds'],
  FB:['rushYds','rec','recYds'],
  WR:['rec','recYds'],
  TE:['rec','recYds'],
}
function slotsFor(player,categories){
  return (roleStats[player.position]||[]).filter(key=>categoryAllows(key,categories))
}
function listedPosition(player){return player.position==='FB'?'RB':player.position}
function betterPlayer(next,prev){
  const aligned=player=>String(player.teamId)===String(player.team?.id)
  if(aligned(next)!==aligned(prev))return aligned(next)?next:prev
  return (next.logs?.length||0)>=(prev.logs?.length||0)?next:prev
}
function dedupePlayers(list){
  const byId=new Map()
  for(const player of list){
    const prev=byId.get(player.id)
    byId.set(player.id,prev?betterPlayer(player,prev):player)
  }
  const byName=new Map()
  for(const player of byId.values()){
    const key=`${player.team?.id}:${player.name.trim().toLowerCase()}`
    const prev=byName.get(key)
    byName.set(key,prev?betterPlayer(player,prev):player)
  }
  return [...byName.values()]
}
function ProjectionCard({player,matchup,slots,chosen,onOpen,halfLife,window}){
  const score=player.breakoutScore
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const recent=average(player.logs.slice(-3),usageKey),prior=average(player.logs.slice(-6,-3),usageKey)
  const mainStat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const factor=player.stats[mainStat]?.defense?.factor
  const favored=matchup.winner?.abbr===player.team.abbr
  const ahead=!favored&&matchup.margin>=4
  const open=chosen===`${player.team.id}:${player.id}`
  const first=slots.find(Boolean)
  const tags=roleTags(player,player.week)
  return <article className="projection-outlook-card" aria-label={`${player.name} projections`}>
    <div className="projection-row" style={{'--stat-count':Math.max(slots.length,1)}}>
      <div className="breakout-player-identity">
        <h4>{player.name}</h4>
        <p>{player.team.abbr} · {player.position} · {player.injury||player.status}</p>
        <small>{player.logs.length} recorded appearances</small>
      </div>
      <section className="breakout-score-cell"><h5>Breakout index</h5><BreakoutScale score={score}/><small>Directional composite · not a probability</small></section>
      {slots.map(key=><div className="projection-scale-cell" key={key}><Performance player={player} metric={key} halfLife={halfLife} lookback={window} label={fieldLabel[key]} breakoutScore={score}/></div>)}
    </div>
    <details className="projection-context">
      <summary>Role, recent opportunity, and matchup context<span className="support-chevron" aria-hidden="true"/></summary>
      <div className="projection-role"><h5>Role</h5>{player.gate?.flag?<p className="role-flag">{player.gate.flag}</p>:null}{player.gate?.note?<p className="role-note">{player.gate.note}</p>:null}{tags.length?<RoleTags player={player} week={player.week}/>:<p>—</p>}</div>
      {player.unavailable&&<p className="projection-withheld">Projection withheld</p>}
      <div className="projection-context-body">
        <section className="breakout-usage-cell"><h5>Recent opportunity</h5>
          <strong>{valid(recent)?`${recent.toFixed(1)} ${usageKey==='passAtt'?'pass attempts':usageKey}`:'—'}</strong>
          <small>Last 3 appearances{valid(prior)?` · prior 3: ${prior.toFixed(1)}`:''}</small>
          <p>{valid(recent)&&valid(prior)&&prior>0?`${recent>=prior?'↑':'↓'} ${Math.abs((recent/prior-1)*100).toFixed(0)}% vs prior 3`:'Trend unavailable'}</p>
        </section>
        <section className="breakout-matchup-cell"><h5>Matchup context</h5>
          <strong>{valid(factor)?`${factor>=1?'+':''}${((factor-1)*100).toFixed(0)}%`:'Neutral'}</strong>
          <small>Recent {player.position} defense adjustment</small>
          <p>Team model: {favored?'favored':ahead?'underdog':'near even'}{matchup.margin>=.05?` by ${matchup.margin.toFixed(1)}`:''}</p>
        </section>
      </div>
      <button className="prop-action" aria-label={`View ${player.name} game log and line comparison`} aria-expanded={open} onClick={()=>onOpen(player,first)}>Game log &amp; lines</button>
    </details>
  </article>
}
const breakoutBuckets=[['all','All'],['low','Low'],['moderate','Moderate'],['high','High']]
export default function PlayerProjections({matchup,saveProp,data,teams,roster,halfLife,window,positions,categories}){
  const [chosen,setChosen]=useState(''),[line,setLine]=useState(''),[lineMetric,setLineMetric]=useState(''),[trackMessage,setTrackMessage]=useState(''),[sortKey,setSortKey]=useState('recYds'),[ascending,setAscending]=useState(false),[roleOnly,setRoleOnly]=useState(true),[breakoutFilter,setBreakoutFilter]=useState('all')
  const sortableKeys=fields.map(([key])=>key).filter(key=>categoryAllows(key,categories))
  const activeSortKey=sortableKeys.includes(sortKey)?sortKey:sortableKeys[0]||'recYds'
  const players=useMemo(()=>dedupePlayers(boardFor(data,matchup,roster,halfLife,window).players.filter(player=>teams.some(({team})=>team.id===player.team.id)))
    .filter(player=>positions.includes(listedPosition(player))&&slotsFor(player,categories).length)
    .map(player=>({...player,week:data.week,gate:roleDecision(player,{book:roleBookForWeek(data.week)}),breakoutScore:breakoutRating(player)}))
    .sort((a,b)=>{const av=projectedValue(a,activeSortKey),bv=projectedValue(b,activeSortKey);if(!valid(av))return valid(bv)?1:a.name.localeCompare(b.name);if(!valid(bv))return -1;return (av-bv)*(ascending?1:-1)||a.name.localeCompare(b.name)}),[teams,data,matchup,roster,halfLife,window,positions,categories,activeSortKey,ascending])
  const hiddenCount=players.filter(player=>!player.gate.eligible).length
  const roleVisible=roleOnly?players.filter(player=>player.gate.eligible):players
  const visible=breakoutFilter==='all'?roleVisible:roleVisible.filter(player=>ratingLevel(player.breakoutScore)===breakoutFilter)
  const breakoutHidden=roleVisible.length-visible.length
  const selected=visible.find(player=>`${player.team.id}:${player.id}`===chosen)
  const selectedMetrics=selected?slotsFor(selected,categories).filter(Boolean):[]
  const validLine=line.trim()!==''&&Number.isFinite(Number(line))&&Number(line)>=0
  const selectedStat=selected&&lineMetric?projectedValue(selected,lineMetric):null
  const sample=selected?.logs.slice(-window).map(log=>logValue(log,lineMetric)).filter(valid)||[]
  const over=validLine?sample.filter(value=>value>Number(line)).length:0
  const pushes=validLine?sample.filter(value=>value===Number(line)).length:0
  function choosePlayer(player,key){setChosen(`${player.team.id}:${player.id}`);setLineMetric(key||slotsFor(player,categories).find(Boolean)||'');setLine('');setTrackMessage('')}
  return <section><div className="prop-section-title"><h3>Player projections · both teams</h3><span>One row per player · {ascending?'lowest':'highest'} selected stat first</span></div>
    <div className="projection-sort"><label>Order by <select value={activeSortKey} onChange={event=>setSortKey(event.target.value)}>{sortableKeys.map(key=><option key={key} value={key}>{fieldLabel[key]}</option>)}</select></label><button className="prop-action" onClick={()=>setAscending(value=>!value)}>{ascending?'Lowest first':'Highest first'}</button><label className="projection-role-toggle"><input type="checkbox" checked={roleOnly} onChange={event=>setRoleOnly(event.target.checked)}/> Role players only</label>{roleOnly?<span className="projection-hidden-count">{hiddenCount} non-role player{hiddenCount===1?'':'s'} hidden</span>:null}<div className="projection-window" aria-label="Breakout index filter"><strong>Breakout index</strong>{breakoutBuckets.map(([id,name])=><button key={id} type="button" aria-pressed={breakoutFilter===id} onClick={()=>setBreakoutFilter(id)}>{name}</button>)}</div>{breakoutFilter!=='all'?<span className="projection-hidden-count">{breakoutHidden} outside {breakoutFilter} hidden</span>:null}</div>
    <div className="projection-card-board">{visible.map(player=><ProjectionCard key={player.id} player={player} matchup={matchup} slots={slotsFor(player,categories)} chosen={chosen} halfLife={halfLife} window={window} onOpen={choosePlayer}/>)}</div>
    {!visible.length&&<p className="prop-warning">No players match the selected team, position, stat, and breakout filters.</p>}
    {selected&&<div className="prop-comparison"><h3>{selected.name} · {fieldLabel[lineMetric]||'Game log'}</h3>
      <label>Your prop line <input type="number" min="0" step="0.5" placeholder="Enter a line, e.g. 64.5" value={line} onChange={event=>setLine(event.target.value)}/></label>
      {validLine&&!selected.unavailable&&valid(selectedStat)&&selectedStat!==Number(line)&&!matchup.started&&<button onClick={()=>{
        if(Date.now()>=Date.parse(matchup.date))return setTrackMessage('Kickoff has passed.')
        const pick=selectedStat>Number(line)?'Over':'Under'
        try{saveProp(`${matchup.id}:${selected.id}:${lineMetric}`,{week:`${data.year} Week ${data.week}`,date:matchup.date,player:selected.name,position:selected.position,team:selected.team.abbr,teamName:selected.team.name,metric:fieldLabel[lineMetric],line:Number(line),pick,result:'Pending'});setTrackMessage(`Saved ${selected.name} ${pick.toLowerCase()} ${line}.`)}catch{setTrackMessage('This browser could not save the prop.')}
      }}>Track model pick</button>}
      {trackMessage&&<p role="status">{trackMessage}</p>}
      {validLine&&<p>{valid(selectedStat)?<>Projection <b>{format(selectedStat,lineMetric)}</b> · difference from line <b>{format(selectedStat-Number(line),lineMetric)}</b> · </>:null}Over this line in <b>{over}/{sample.length}</b> recent appearances{pushes?` (${pushes} pushes)`:''}. Historical frequency is not a probability.</p>}
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th>{selectedMetrics.map(key=><th key={key}>{fieldLabel[key]}</th>)}</tr></thead><tbody>{[...selected.logs].reverse().map(log=><tr key={log.gameId}><td>{date(log.date)}</td><td>{log.opponent}</td>{selectedMetrics.map(key=><td key={key}>{format(logValue(log,key),key)}</td>)}</tr>)}</tbody></table></div>
    </div>}
  </section>
}
