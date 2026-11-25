import {useMemo,useState} from 'react'
import {valid,weighted} from '../model.js'
import {breakoutRating} from '../breakout.js'
import BreakoutScale from '../BreakoutScale.jsx'
import {StatScale} from '../Performance.jsx'
import RoleTags from '../RoleTags.jsx'
import {roleDecision} from '../roleEligibility.js'
import {buildFlyerThemes} from '../Flyers.jsx'
import './flyer-favorites.css'

const fmt=n=>Number.isInteger(n)?String(n):Number(n).toFixed(1)
const roleName=p=>p==='RB'?'RB/FB':p
function boxValue(player,key){return key==='totalTD'?(valid(player.rushTD)&&valid(player.recTD)?player.rushTD+player.recTD:null):player[key]}
function projectionFor(player,key){
  if(key==='totalTD'){
    const rush=player.stats.rushTD?.projection,rec=player.stats.recTD?.projection
    return valid(rush)&&valid(rec)?rush+rec:null
  }
  return player.stats[key]?.projection
}
function baselineFor(player,key,halfLife){
  return key==='totalTD'?weighted(player.logs.map(log=>({...log,totalTD:boxValue(log,'totalTD')})),'totalTD',halfLife):weighted(player.logs,key,halfLife)
}
export function rankBreakoutFavorites(themes,{teamFilter='all',positionFilter='all',halfLife}={}){
  const picks=new Map()
  for(const theme of themes.filter(row=>row.tier==='Breakout')){
    if((teamFilter!=='all'&&theme.offense.id!==teamFilter)||(positionFilter!=='all'&&theme.position!==positionFilter))continue
    for(const player of theme.candidates){
      const baseline=baselineFor(player,theme.spec.key,halfLife)
      const projection=projectionFor(player,theme.spec.key)
      if(!valid(baseline)||baseline<=0||!valid(projection))continue
      const multiple=projection/baseline
      const recentPeak=Math.max(...player.logs.map(log=>boxValue(log,theme.spec.key)).filter(valid),0)
      const peakMultiple=recentPeak/baseline
      const decision=roleDecision({...player,team:{name:theme.offense.name}},{statKey:theme.spec.key})
      if(!decision.eligible)continue
      const key=`${player.id}:${theme.spec.key}`
      const row={player,theme,baseline,projection,multiple,peakMultiple,recentPeak,flag:decision.flag,note:decision.note,
        score:((multiple*theme.rate)+(Math.min(peakMultiple,3)*.15)+(theme.rate*.25))*decision.weight}
      if(!picks.has(key)||picks.get(key).score<row.score)picks.set(key,row)
    }
  }
  return [...picks.values()].sort((a,b)=>b.score-a.score||b.peakMultiple-a.peakMultiple).slice(0,3)
}
export default function FlyerFavorites({data,matchup,roster,halfLife,window}){
  const [teamFilter,setTeamFilter]=useState('all')
  const [positionFilter,setPositionFilter]=useState('all')
  const themes=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window),[data,matchup,roster,halfLife,window])
  const teams=[...new Map([{offense:matchup.away},{offense:matchup.home}].map(side=>[side.offense.id,side.offense])).values()]
  const favorites=useMemo(()=>rankBreakoutFavorites(themes,{teamFilter,positionFilter,halfLife}),[themes,teamFilter,positionFilter,halfLife])
  return <section className="flyer-favorites" aria-label="Top three breakout upside candidates">
    <div className="flyers-filters" aria-label="Filter archived favorites">
      <label>Team<select value={teamFilter} onChange={event=>setTeamFilter(event.target.value)}><option value="all">All teams</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Position<select value={positionFilter} onChange={event=>setPositionFilter(event.target.value)}><option value="all">All positions</option>{['QB','RB','WR','TE'].map(pos=><option key={pos} value={pos}>{roleName(pos)}</option>)}</select></label>
    </div>
    <div className="flyer-favorites-heading"><div><span>TOP THREE</span><h4>Breakout Upside Favorites</h4></div><small>Highest combined matchup rate, model projection, and prior single-game ceiling</small></div>
    {!favorites.length?<p className="prop-warning">No breakout candidate currently has a reliable projection for these filters.</p>:<ol className="flyer-favorites-list">{favorites.map(({player,theme,baseline,projection,multiple,peakMultiple,recentPeak,flag,note},index)=><li key={`${player.id}:${theme.spec.key}`}>
      <span className="flyer-favorite-rank">0{index+1}</span>
      <div><b>{player.name}</b>{flag?<em className="role-flag">{flag}</em>:null}{note?<em className="role-note">{note}</em>:null}<RoleTags player={player}/><small>{theme.offense.abbr} · {roleName(theme.position)} · {theme.spec.title}</small></div>
      <BreakoutScale score={breakoutRating(player)} className="flyer-breakout-scale"/>
      <div><strong>{fmt(projection)} {theme.spec.title.toLowerCase()}</strong><small>Projection · {multiple.toFixed(2)}× weighted baseline</small></div>
      <StatScale player={player} metric={theme.spec.key} halfLife={halfLife} lookback={window} baseline={baseline}/>
      <div><strong>{fmt(recentPeak)} peak</strong><small>{peakMultiple.toFixed(2)}× baseline · {Math.round(theme.rate*100)}% opponent breakout rate</small></div>
    </li>)}</ol>}
    <p className="flyer-favorites-note">A 1.5× or 2× label is not assigned unless the player’s actual model projection reaches that multiple. The current matchup adjustment is capped at 1.25× baseline, so larger multiples would require a separate ceiling model.</p>
  </section>
}
