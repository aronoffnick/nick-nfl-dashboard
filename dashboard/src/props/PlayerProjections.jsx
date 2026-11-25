import { useMemo, useState } from 'react'
import { valid, projectTeam } from './model.js'
import { breakoutRating } from './breakout.js'
import BreakoutScale from './BreakoutScale.jsx'
import RoleTags from './RoleTags.jsx'

const format=(n,key='')=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
const date=d=>new Date(d).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'})
const average=(games,key)=>games.length&&games.every(game=>valid(game[key]))?games.reduce((sum,game)=>sum+game[key],0)/games.length:null
const showNum=n=>!valid(n)?'—':Number.isInteger(n)?String(n):String(Math.round(n*10)/10)
export const projectionGroups={Passing:['passYds','passTD'],Rushing:['rushYds'],Receiving:['rec','recYds'],TDs:['passTD','totalTD']}
const fields=[
  ['rec','Receptions'],
  ['recYds','Receiving yards'],
  ['rushYds','Rush yards'],
  ['passYds','Pass yards'],
  ['passTD','Pass TDs'],
  ['totalTD','TD scored'],
]
const fieldCategory={rec:['Receiving'],recYds:['Receiving'],rushYds:['Rushing'],passYds:['Passing'],passTD:['Passing','TDs'],totalTD:['TDs']}
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
function hasEvidence(player,key){
  return player.logs.some(log=>valid(logValue(log,key))&&logValue(log,key)!==0)||valid(projectedValue(player,key))
}
function relevantFields(player,categories){
  const pos=player.position
  return fields.filter(([key])=>{
    if(!categoryAllows(key,categories))return false
    if(key==='passYds'||key==='passTD')return pos==='QB'
    if(key==='rec'||key==='recYds')return pos!=='QB'
    if(key==='rushYds')return ['QB','RB','FB'].includes(pos)||hasEvidence(player,key)
    if(key==='totalTD')return ['QB','RB','FB','WR','TE'].includes(pos)
    return false
  }).map(([key])=>key)
}
function recentRange(player,key){
  const values=player.logs.slice(-4).map(log=>logValue(log,key)).filter(valid)
  if(!values.length)return null
  return {low:Math.min(...values),high:Math.max(...values),n:values.length}
}
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
function ProjectionCard({player,matchup,fieldsForPlayer,chosen,lineMetric,onOpen}){
  const score=breakoutRating(player)
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const recent=average(player.logs.slice(-3),usageKey),prior=average(player.logs.slice(-6,-3),usageKey)
  const mainStat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const factor=player.stats[mainStat]?.defense?.factor
  const favored=matchup.winner?.abbr===player.team.abbr
  const ahead=!favored&&matchup.margin>=4
  const open=chosen===`${player.team.id}:${player.id}`
  return <article className="breakout-player-row projection-outlook-card" aria-label={`${player.name} projections`}>
    <div className="breakout-player-identity">
      <h4>{player.name}</h4>
      <RoleTags player={player}/>
      <p>{player.team.abbr} · {player.position} · {player.injury||player.status}</p>
      <small>{player.logs.length} recorded appearances</small>
      {player.unavailable&&<small className="projection-withheld">Projection withheld</small>}
      <button className="prop-action" aria-label={`View ${player.name} game log and line comparison`} aria-expanded={open} onClick={()=>onOpen(player,fieldsForPlayer[0])}>Game log &amp; lines</button>
    </div>
    <section className="breakout-score-cell"><h5>Breakout index</h5><BreakoutScale score={score}/><small>Directional composite · not a probability</small></section>
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
    <section className="breakout-projection-cell"><h5>Projected stats</h5>{fieldsForPlayer.map(key=>{
      const projection=player.unavailable?null:projectedValue(player,key)
      const range=recentRange(player,key)
      return <button className="breakout-stat-chip" key={key} type="button" aria-pressed={open&&lineMetric===key} onClick={()=>onOpen(player,key)}>
        <b>{fieldLabel[key]}</b>
        <strong>{valid(projection)?format(projection,key):'—'}</strong>
        <small>{range?`Recent 4: ${showNum(range.low)}–${showNum(range.high)}`:'Recent 4 unavailable'}</small>
      </button>
    })}</section>
  </article>
}
export default function PlayerProjections({matchup,saveProp,data,teams,roster,halfLife,window,positions,categories}){
  const [chosen,setChosen]=useState(''),[line,setLine]=useState(''),[lineMetric,setLineMetric]=useState(''),[trackMessage,setTrackMessage]=useState(''),[sortKey,setSortKey]=useState('recYds'),[ascending,setAscending]=useState(false)
  const sortableKeys=fields.map(([key])=>key).filter(key=>categoryAllows(key,categories))
  const activeSortKey=sortableKeys.includes(sortKey)?sortKey:sortableKeys[0]||'recYds'
  const players=useMemo(()=>dedupePlayers(teams.flatMap(({team,opponent})=>projectTeam(data,team,opponent,roster,halfLife,window).map(player=>({...player,team,opponent}))))
    .filter(player=>positions.includes(player.position)&&relevantFields(player,categories).length>0)
    .sort((a,b)=>{const av=projectedValue(a,activeSortKey),bv=projectedValue(b,activeSortKey);if(!valid(av))return valid(bv)?1:a.name.localeCompare(b.name);if(!valid(bv))return -1;return (av-bv)*(ascending?1:-1)||a.name.localeCompare(b.name)}),[teams,data,roster,halfLife,window,positions,categories,activeSortKey,ascending])
  const selected=players.find(player=>`${player.team.id}:${player.id}`===chosen)
  const selectedMetrics=selected?relevantFields(selected,categories):[]
  const validLine=line.trim()!==''&&Number.isFinite(Number(line))&&Number(line)>=0
  const selectedStat=selected&&lineMetric?projectedValue(selected,lineMetric):null
  const sample=selected?.logs.slice(-window).map(log=>logValue(log,lineMetric)).filter(valid)||[]
  const over=validLine?sample.filter(value=>value>Number(line)).length:0
  const pushes=validLine?sample.filter(value=>value===Number(line)).length:0
  function choosePlayer(player,key){setChosen(`${player.team.id}:${player.id}`);setLineMetric(key||relevantFields(player,categories)[0]||'');setLine('');setTrackMessage('')}
  return <section><div className="prop-section-title"><h3>Player projections · both teams</h3><span>One block per player · {ascending?'lowest':'highest'} selected stat first</span></div>
    <div className="projection-sort"><label>Order by <select value={activeSortKey} onChange={event=>setSortKey(event.target.value)}>{sortableKeys.map(key=><option key={key} value={key}>{fieldLabel[key]}</option>)}</select></label><button className="prop-action" onClick={()=>setAscending(value=>!value)}>{ascending?'Lowest first':'Highest first'}</button></div>
    <div className="projection-card-board">{players.map(player=><ProjectionCard key={player.id} player={player} matchup={matchup} fieldsForPlayer={relevantFields(player,categories)} chosen={chosen} lineMetric={lineMetric} onOpen={choosePlayer}/>)}</div>
    {!players.length&&<p className="prop-warning">No players match the selected team, position, and stat filters.</p>}
    <p className="prop-help">Each player is one block: name and status, breakout index, recent opportunity (last 3 appearances against the prior 3), matchup context, then projected stats. The stat list is only receptions, receiving yards, rush yards, pass yards, pass TDs, and TDs scored, and only the fields that fit that player. A missing projection or recent-4 range is shown as a dash or left off the card. It is not filled in.</p>
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
