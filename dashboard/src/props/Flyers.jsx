import {useMemo,useState} from 'react'
import {historyFor,sides,positionOf,projectTeam,valid,weighted} from './model.js'
import {breakoutRating,ratingLevel} from './breakout.js'
import {betSignalScore} from './Bets.jsx'
import {rbStarter} from './roleData.js'
import RoleTags from './RoleTags.jsx'
import wrStarterRows from './wr-starters-week12.json'
import './flyers.css'

const THRESHOLDS={
  QB:[
    {key:'passYds',title:'Pass yards',usage:'passAtt',group:['passing'],safe:260,breakout:300},
    {key:'passTD',title:'Pass TDs',usage:'passAtt',group:['passing'],safe:2,breakout:3},
    {key:'rushYds',title:'Rush yards',usage:'carries',group:['rushing'],safe:20,breakout:35},
    {key:'rushTD',title:'TDs (rushing)',usage:'carries',group:['rushing'],safe:1,breakout:2},
  ],
  RB:[
    {key:'rushYds',title:'Rush yards',usage:'carries',group:['rushing'],safe:90,breakout:110},
    {key:'rec',title:'Receptions',usage:'targets',group:['receiving'],safe:4,breakout:6},
    {key:'recYds',title:'Receiving yards',usage:'targets',group:['receiving'],safe:15,breakout:25},
    {key:'totalTD',title:'TDs (rush + receiving)',usage:'carries',group:['rushing','receiving'],safe:1,breakout:2},
  ],
  WR:[
    {key:'rec',title:'Receptions',usage:'targets',group:['receiving'],safe:6,breakout:8},
    {key:'recYds',title:'Receiving yards',usage:'targets',group:['receiving'],safe:90,breakout:110},
    {key:'totalTD',title:'TDs (rush + receiving)',usage:'targets',group:['rushing','receiving'],safe:1,breakout:2},
  ],
  TE:[
    {key:'rec',title:'Receptions',usage:'targets',group:['receiving'],safe:5,breakout:7},
    {key:'recYds',title:'Receiving yards',usage:'targets',group:['receiving'],safe:40,breakout:60},
    {key:'totalTD',title:'TDs (rush + receiving)',usage:'targets',group:['rushing','receiving'],safe:1,breakout:2},
  ],
}
const wrLookup=new Map(wrStarterRows.map(row=>[row.name.trim().toLowerCase(),row]))
const fmt=n=>Number.isInteger(n)?String(n):Number(n).toFixed(1)
const roleName=p=>p==='RB'?'RB/FB':p
function posMatch(player,pos,roster){const actual=positionOf(player,roster);return actual===pos||(pos==='RB'&&actual==='FB')}
function boxValue(player,key){return key==='totalTD'?(valid(player.rushTD)&&valid(player.recTD)?player.rushTD+player.recTD:null):player[key]}
function gameEligible(side,spec){return !!side.playerBox&&spec.group.every(group=>side.playerBox.available.includes(group))}
function mean(values){const validValues=values.filter(valid);return validValues.length?validValues.reduce((a,b)=>a+b,0)/validValues.length:null}
function recentDefenseGames(data,defense,window,matchup){return historyFor(data,defense.id).filter(g=>new Date(g.date)<new Date(matchup.date)).slice(-window)}
function rateForTheme(games,defense,pos,spec,threshold,roster){
  const outcomes=[]
  for(const game of games){
    const [defSide,offSide]=sides(game,defense.id)
    if(!gameEligible(offSide,spec))continue
    const players=offSide.playerBox.players.filter(p=>posMatch(p,pos,roster)&&valid(boxValue(p,spec.key)))
    if(!players.length)continue
    const highest=Math.max(...players.map(p=>boxValue(p,spec.key)))
    const crossed=highest>=threshold
    const crossingPlayers=crossed?players.filter(p=>boxValue(p,spec.key)>=threshold):[]
    outcomes.push({game,highest,crossed,crossingPlayers,opponent:offSide})
  }
  const hits=outcomes.filter(row=>row.crossed)
  const players=hits.flatMap(row=>row.crossingPlayers.map(p=>({player:p,game:row.game,opponent:row.opponent,usage:p[spec.usage]}))).filter(row=>valid(row.usage))
  return {hits: hits.length,n:outcomes.length,rate:outcomes.length?hits.length/outcomes.length:null,hitPlayers:players}
}
function wrRoleSimilarity(a,b){
  if(!a||!b)return null
  let score=0,weight=0
  if(a.rank&&b.rank){score+=Math.max(0,1-Math.abs(Number(a.rank.replace(/\D/g,''))-Number(b.rank.replace(/\D/g,'')))/2)*.55;weight+=.55}
  score+=(a.slot===b.slot?1:0)*.25;weight+=.25
  if(a.alignment&&b.alignment){score+=(a.alignment===b.alignment?1:0)*.12;weight+=.12}
  if(a.side&&b.side){score+=(a.side===b.side?1:0)*.08;weight+=.08}
  return weight?score/weight:null
}
// RB matching uses the Week 12 RB starters sheet: depth label (RB1/RB2/RB3), primary role, goal-line/red-zone role.
const GL_ORDER={primary:3,shared:2,occasional:1,none:0}
function rbRoleSimilarity(a,b){
  if(!a||!b)return null
  let score=0,weight=0
  const d=x=>/^RB\d/.test(x||'')?Number(x.replace(/\D/g,'')):null
  if(d(a.depth)!=null&&d(b.depth)!=null){score+=Math.max(0,1-Math.abs(d(a.depth)-d(b.depth))/2)*.45;weight+=.45}
  if(a.primary&&b.primary){score+=(a.primary===b.primary?1:0)*.30;weight+=.30}
  if(a.glRole in GL_ORDER&&b.glRole in GL_ORDER){score+=Math.max(0,1-Math.abs(GL_ORDER[a.glRole]-GL_ORDER[b.glRole])/3)*.25;weight+=.25}
  return weight?score/weight:null
}
const rbEvidence=r=>`${r.depth} · ${r.primary} · ${r.glLabel}`
export function closestPlayer(candidates,theme,pos){
  if(!candidates.length)return null
  const referenceUsage=mean(theme.hitPlayers.map(row=>row.usage))
  const referenceWrRoles=pos==='WR'?theme.hitPlayers.map(row=>wrLookup.get(row.player.name.trim().toLowerCase())).filter(Boolean):[]
  const referenceRbRoles=pos==='RB'?theme.hitPlayers.map(row=>rbStarter(row.player.name)).filter(Boolean):[]
  return candidates.map(player=>{
    const usage=weighted(player.logs,theme.spec.usage,3)
    const usageScore=valid(referenceUsage)&&referenceUsage>0&&valid(usage)?Math.max(0,1-Math.abs(usage-referenceUsage)/referenceUsage):valid(usage)?Math.min(usage/10,1):0
    let roleScore=null,matchedRole=null
    if(pos==='WR'){
      const playerRole=wrLookup.get(player.name.trim().toLowerCase())
      const roleMatches=referenceWrRoles.map(role=>wrRoleSimilarity(playerRole,role)).filter(valid)
      if(roleMatches.length){roleScore=Math.max(...roleMatches);matchedRole=playerRole}
    }
    if(pos==='RB'){
      const playerRole=rbStarter(player.name)
      const roleMatches=referenceRbRoles.map(role=>rbRoleSimilarity(playerRole,role)).filter(valid)
      if(roleMatches.length){roleScore=Math.max(...roleMatches);matchedRole=playerRole}
    }
    const similarity=roleScore==null?usageScore:usageScore*.65+roleScore*.35
    return {...player,similarity,usage,role:matchedRole}
  }).sort((a,b)=>b.similarity-a.similarity||b.breakoutScore-a.breakoutScore)[0]
}
function CandidateList({theme,pos,side}){
  const closest=closestPlayer(theme.candidates,theme,pos)
  if(!closest)return <p className="flyers-no-player">No current active player with a recent role was identified for this position.</p>
  const evidence=pos==='RB'&&closest.role?rbEvidence(closest.role):pos==='WR'&&closest.role?`${closest.role.rank}${closest.role.slot?' · slot':''} · ${closest.role.alignment}/${closest.role.side}`:`Recent ${theme.spec.usage==='passAtt'?'pass attempts':theme.spec.usage} role`
  return <div className="flyers-match"><div className="flyers-player-name"><b>{closest.name}</b><BreakoutIndexChip player={closest}/></div><span>{closest.team?.abbr||side.offense.abbr} · {closest.position}</span><RoleTags player={{name:closest.name,pos:pos==='RB'?'RB':closest.position}}/><small>Closest role match · {Math.round(closest.similarity*100)}% similarity · {evidence}</small></div>
}
function BreakoutIndexChip({player}){
  const score=breakoutRating(player)
  if(score==null)return <span className="breakout-index-chip breakout-unknown">Breakout index —</span>
  return <span className={`breakout-index-chip breakout-${ratingLevel(score)}`}>Breakout index {score}</span>
}
function BreakoutCard({player, index, window}){
  const score = breakoutRating(player)
  const level = ratingLevel(score)
  const isRunner = ['RB','FB'].includes(player.position)
  const stat = player.position === 'QB' ? 'passYds' : isRunner ? 'rushYds' : 'recYds'
  const statLabel = player.position === 'QB' ? 'passing yards' : isRunner ? 'rushing yards' : 'receiving yards'
  const usage = player.position === 'QB' ? 'passAtt' : isRunner ? 'carries' : 'targets'
  const usageLabel = player.position === 'QB' ? 'attempts' : isRunner ? 'carries' : 'targets'
  const logs = player.logs.slice(-window)
  const yards = logs.map(game=>game[stat]).filter(valid).sort((a,b)=>a-b)
  const strongerGames = yards.slice(Math.floor(yards.length / 2))
  const low = strongerGames[0], high = strongerGames.at(-1)
  const recentUsage = mean(logs.slice(-3).map(game=>game[usage]))
  const factor = player.stats[stat]?.defense?.factor
  const supportLabel = {high:'Higher breakout support',moderate:'Moderate breakout support',low:'Lower breakout support',unknown:'Breakout support not rated'}[level]
  return <li>
    <span className="flyer-favorite-rank">#{index+1}</span>
    <div>
      <div className="flyers-player-name"><b>{player.name}</b><BreakoutIndexChip player={player}/></div>
      <RoleTags player={player}/>
      <small>{player.offense.abbr} · {player.position}</small>
    </div>
    <div>
      <b>If he breaks out</b>
      <div>{yards.length>=4?`${low===high?fmt(high):`${fmt(low)}–${fmt(high)}`} ${statLabel}`:'Limited data for an upside range'}</div>
      {yards.length>=4&&<small>Upper half of {yards.length} recent games</small>}
    </div>
    <details className="prop-method">
      <summary>{supportLabel}</summary>
      <p><b>Recent Opportunity</b> {valid(recentUsage)?`${recentUsage.toFixed(1)} ${usageLabel} per game over the latest ${Math.min(logs.length,3)} appearances`:'Limited usage data'}</p>
      <p><b>Matchup Context</b> {player.opponent.name} · {valid(factor)?`${((factor-1)*100).toFixed(0)}% model adjustment for ${statLabel}`:'Limited defensive data'}</p>
    </details>
  </li>
}
function FlyerTheme({theme,index,offenses,roster,halfLife,window}){
  const pos=theme.position
  return <article className={`flyer-theme flyer-${theme.tier.toLowerCase()}`}>
    <div className="flyer-rank">#{index+1}</div>
    <div className="flyer-theme-main"><div className="flyer-theme-top"><span className="flyer-tier">{theme.tier}</span><span className="flyer-position">{roleName(pos)}</span></div>
      <h4>{theme.spec.title} · {fmt(theme.threshold)}+</h4>
      <strong className="flyer-rate">{theme.rate===null?'—':`${Math.round(theme.rate*100)}%`}</strong>
      <span className="flyer-count">{theme.hits}/{theme.n} recent opponent games</span>
      <small>Defense: {theme.defense.name} · most recent {window} usable games with this stat data</small>
    </div>
    <div className="flyer-similar"><small>MOST SIMILAR UPCOMING PLAYER</small>
      <CandidateList theme={theme} pos={pos} side={offenses.find(s=>s.defense.id===theme.defense.id)}/>
      <small className="flyer-explainer">Role match uses recent box-score workload; WRs also use the Week 12 starter/slot sheet; RBs use the Week 12 RB starters sheet (depth label, primary role, goal-line/red-zone role) when a matching name is available.</small>
    </div>
  </article>
}
export function buildFlyerThemes(data,matchup,roster,halfLife,window){
  const offenses=[{offense:matchup.away,defense:matchup.home},{offense:matchup.home,defense:matchup.away}]
  const rows=[]
  for(const side of offenses){
    const games=recentDefenseGames(data,side.defense,window,matchup)
    const currentPlayers=projectTeam(data,side.offense,side.defense,roster,halfLife,window)
    for(const position of Object.keys(THRESHOLDS))for(const spec of THRESHOLDS[position])for(const tier of ['Safe','Breakout']){
      const threshold=tier==='Safe'?spec.safe:spec.breakout
      const result=rateForTheme(games,side.defense,position,spec,threshold,roster)
      if(result.n<2||result.hits===0)continue
      rows.push({...result,position,spec,tier,threshold,defense:side.defense,offense:side.offense,data,
        candidates:currentPlayers.filter(p=>posMatch(p,position,roster)&&!p.unavailable&&!p.stale)})
    }
  }
  return rows.sort((a,b)=>(b.rate??-1)-(a.rate??-1)||b.hits-a.hits|| (a.tier==='Safe'?-1:1)||a.position.localeCompare(b.position)||a.spec.title.localeCompare(b.spec.title))
}
export default function Flyers({data,matchup,roster,halfLife,window}){
  const [teamFilter,setTeamFilter]=useState('all')
  const [positionFilter,setPositionFilter]=useState('all')
  const offenses=[{offense:matchup.away,defense:matchup.home},{offense:matchup.home,defense:matchup.away}]
  const themes=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window),[data,matchup,roster,halfLife,window])
  const teams=[...new Map(offenses.map(side=>[side.offense.id,side.offense])).values()]
  const filtered=themes.filter(theme=>theme.tier==='Breakout'&&(teamFilter==='all'||theme.offense.id===teamFilter)&&
    (positionFilter==='all'||theme.position===positionFilter))
  const candidates=useMemo(()=>[
    [matchup.away,matchup.home],[matchup.home,matchup.away]
  ].flatMap(([offense,opponent])=>projectTeam(data,offense,opponent,roster,halfLife,window)
    .filter(player=>!player.unavailable&&!player.stale&&['QB','RB','FB','WR','TE'].includes(player.position))
    .map(player=>({...player,offense,opponent,signal:betSignalScore(player),indexScore:breakoutRating(player)}))
  ).sort((a,b)=>b.signal-a.signal||(b.indexScore??-1)-(a.indexScore??-1)||a.name.localeCompare(b.name)),
  [data,matchup,roster,halfLife,window])
  const visible=candidates.filter(player=>(teamFilter==='all'||player.offense.id===teamFilter)&&
    (positionFilter==='all'||player.position===positionFilter||(positionFilter==='RB'&&player.position==='FB')))
  const items=filtered.map((theme,index)=>({...theme,index}))

  return <section className="flyers-section" aria-label="Flyers threshold themes">
    <div className="prop-section-title"><h3>Flyers · most common opponent themes</h3><span>Position + stat + threshold · ranked by recent hit rate</span></div>
    <p className="prop-help">Each row shows how often a player at that position crossed the <b>Breakout</b> line in the defense’s recent games, then identifies the closest-role player on the upcoming offense. Safe thresholds are retained as background support for the PARLAYS overlap range. The hit rate is historical evidence, not a forecast probability. QB “TDs” means rushing TDs; other positions’ TDs combine rushing and receiving.</p>
    <div className="flyers-filters" aria-label="Filter Flyers themes">
      <label>Team<select value={teamFilter} onChange={event=>setTeamFilter(event.target.value)}><option value="all">All teams</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Position<select value={positionFilter} onChange={event=>setPositionFilter(event.target.value)}><option value="all">All positions</option>{Object.keys(THRESHOLDS).map(pos=><option key={pos} value={pos}>{roleName(pos)}</option>)}</select></label>
      <button type="button" onClick={()=>{setTeamFilter('all');setPositionFilter('all')}}>Reset</button>
    </div>
    <div className="flyers-legend"><span className="flyer-breakout-swatch">Breakout · green</span><span>Safe thresholds remain as background support for PARLAYS overlap ranges</span></div>
    <section className="flyer-favorites" aria-label="Player breakout outlook">
      <div className="flyer-favorites-heading"><h4>Player Breakout Outlook</h4></div>
      {!visible.length?<p className="prop-warning">No breakout candidates match these filters.</p>:
        <ol className="flyer-favorites-list">{visible.map((player,index)=>
          <BreakoutCard key={`${player.offense.id}:${player.id}`} player={player} index={index} window={window}/>
        )}</ol>}
    </section>
    {!items.length?<p className="prop-warning">No themes match these filters.</p>:<div className="flyers-board">{items.map((theme,index)=><FlyerTheme key={`${theme.defense.id}:${theme.position}:${theme.spec.key}:${theme.tier}`} theme={theme} index={index} offenses={offenses} roster={roster} halfLife={halfLife} window={window}/>)}</div>}
    <details className="prop-method"><summary>Threshold rules and data sources</summary>
      <p>Thresholds come from your supplied reference: QB pass yards 260/300, pass TDs 2/3, rush yards 20/35, rushing TDs 1/2; RB rush yards 90/110, receptions 4/6, receiving yards 15/25, total TDs 1/2; WR receptions 6/8, receiving yards 90/110, total TDs 1/2; TE receptions 5/7, receiving yards 40/60, total TDs 1/2. “Safe” and “Breakout” list first and second values respectively.</p>
      <p>For each game, the position group counts as crossing when at least one player at that position reaches the threshold. Hit rates use only recent games with complete box-score categories and position data. A theme enters the ranking with at least two usable games and one crossing; all qualifying themes are shown, ordered by percentage and hit count. Closest player selection uses current-team recent workload compared with the workloads of historical players who crossed the threshold. WR role matching also consults the supplied Ourlads-derived Week 12 sheet (slot/depth/alignment fields marked inferred in that source); it is a supplemental role hint, not tracking data.</p>
      <p>Source: ESPN prior-week individual box scores and current roster positions; WR backup cross-reference: user-provided Week 12 WR starters workbook, snapshot Nov 23, 2026. RB role tags use the Week 12 RB starters sheet (depth, primary role, and goal-line role). No sportsbook prices, confirmed starters, snap counts, route participation or injury-driven role changes are modeled.</p>
    </details>
  </section>
}
