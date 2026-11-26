import {useMemo,useState} from 'react'
import {historyFor,sides,positionOf,projectTeam,valid,weighted} from './model.js'
import {rbStarter} from './roleData.js'
import {findRb,roleDecision} from './roleEligibility.js'
import RoleTags from './RoleTags.jsx'
import {fileForWeek,roleBookForWeek} from '../data/weekFiles.js'
import {raisedBreakoutLine,scatterProjection} from './scatterCheck.js'
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
const wrLookupFor=week=>{
  const file=fileForWeek('wr',week)
  return file.matched?new Map(file.data.map(row=>[row.name.trim().toLowerCase(),row])):new Map()
}
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
  return {hits: hits.length,n:outcomes.length,rate:outcomes.length?hits.length/outcomes.length:null,hitPlayers:players,gameHighs:outcomes.map(row=>row.highest)}
}
export function rateAtLine(theme,line){
  const highs=theme.gameHighs
  if(!highs?.length)return {hits:theme.hits,n:theme.n,rate:theme.rate}
  const hits=highs.filter(value=>value>=line).length
  return {hits,n:highs.length,rate:hits/highs.length}
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
export function closestPlayer(candidates,theme,pos,week){
  if(!candidates.length)return null
  const referenceUsage=mean(theme.hitPlayers.map(row=>row.usage))
  const wrLookup=wrLookupFor(week)
  const book=roleBookForWeek(week)
  const referenceWrRoles=pos==='WR'?theme.hitPlayers.map(row=>wrLookup.get(row.player.name.trim().toLowerCase())).filter(Boolean):[]
  const referenceRbRoles=pos==='RB'?theme.hitPlayers.map(row=>rbStarter(row.player.name,week)).filter(Boolean):[]
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
      const playerRole=rbStarter(player.name,week)
      const roleMatches=referenceRbRoles.map(role=>rbRoleSimilarity(playerRole,role)).filter(valid)
      if(roleMatches.length){roleScore=Math.max(...roleMatches);matchedRole=playerRole}
    }
    const similarity=roleScore==null?usageScore:usageScore*.65+roleScore*.35
    const sheet=pos==='RB'?findRb(player.name,book):null
    return {...player,similarity,usage,role:matchedRole,carryShare:sheet?.recentCarryShare??null}
  }).sort((a,b)=>b.similarity-a.similarity||(theme.spec.key==='rushYds'?(b.carryShare??-1)-(a.carryShare??-1):0)||(b.breakoutScore??-1)-(a.breakoutScore??-1))[0]
}
function matchEvidence(theme,closest){
  const pos=theme.position
  if(pos==='RB'&&closest.role)return rbEvidence(closest.role)
  if(pos==='WR'&&closest.role)return `${closest.role.rank}${closest.role.slot?' · slot':''} · ${closest.role.alignment}/${closest.role.side}`
  return `Recent ${theme.spec.usage==='passAtt'?'pass attempts':theme.spec.usage} role`
}
export function breakoutView(theme,matchup){
  const book=roleBookForWeek(theme.week)
  const closest=closestPlayer(theme.candidates,theme,theme.position,theme.week)
  const decision=closest?.gate||(closest?roleDecision({name:closest.name,position:theme.position,team:{name:theme.offense.name}},{statKey:theme.spec.key,book,includeBackups:theme.includeBackups,teammates:theme.teammates}):null)
  let line=theme.threshold,hits=theme.hits,n=theme.n,rate=theme.rate,note=null
  if(theme.tier==='Breakout'&&(theme.position==='RB'||theme.position==='WR')&&closest){
    const scatter=scatterProjection(fileForWeek('scatter',theme.week).data?.games,{awayAbbr:matchup.away.abbr,homeAbbr:matchup.home.abbr,playerName:closest.name,statKey:theme.spec.key})
    const raised=raisedBreakoutLine(theme.threshold,scatter)
    note=raised.note
    if(raised.raised){
      const rated=rateAtLine(theme,raised.line)
      line=raised.line;hits=rated.hits;n=rated.n;rate=rated.rate
    }
  }
  return {closest,decision,line,hits,n,rate,note}
}
function FlyerTheme({theme,index,window,view}){
  const pos=theme.position
  const closest=view.closest
  return <article className={`flyer-theme flyer-${theme.tier.toLowerCase()} flyer-player-prop`}>
    <div className="flyer-rank">#{index+1}</div>
    <div className="flyer-player-side">
      <div className="flyer-theme-top"><span className="flyer-tier">{theme.tier}</span><span className="flyer-position">{roleName(pos)}</span></div>
      {closest?<>
          <h4>{closest.name}{view.decision?.flag?<em className="role-flag">{view.decision.flag}</em>:null}<RoleMark decision={view.decision}/></h4>
        <span className="flyer-player-meta">{closest.team?.abbr||theme.offense.abbr} · {closest.position}</span>
        <RoleTags player={{name:closest.name,pos:pos==='RB'?'RB':closest.position}} week={theme.week}/>
        <small>Closest role match · {Math.round(closest.similarity*100)}% similarity · {matchEvidence(theme,closest)}</small>
      </>:<p className="flyers-no-player">No current active player with a recent role was identified for this position.</p>}
    </div>
    <div className="flyer-prop-side">
      <h4>{theme.spec.title} · {fmt(view.line)}+</h4>
      <strong className="flyer-rate">{view.rate==null?'—':`${Math.round(view.rate*100)}%`}</strong>
      <span className="flyer-count">{view.hits}/{view.n} recent opponent games</span>
      <small>Defense: {theme.defense.name} · most recent {window} usable games with this stat data</small>
      {view.note?<small className="flyer-line-note">{view.note}</small>:null}
    </div>
  </article>
}
function RoleMark({decision}){
  if(decision?.note==='Shared role'||decision?.note==='Backup')return <em className={decision.note==='Shared role'?'role-shared':'role-backup'}>{decision.note}</em>
  if(decision?.note)return <em className="role-note">{decision.note}</em>
  return null
}
export function buildFlyerThemes(data,matchup,roster,halfLife,window,includeBackups=false){
  const offenses=[{offense:matchup.away,defense:matchup.home},{offense:matchup.home,defense:matchup.away}]
  const rows=[]
  for(const side of offenses){
    const games=recentDefenseGames(data,side.defense,window,matchup)
    const currentPlayers=projectTeam(data,side.offense,side.defense,roster,halfLife,window)
    for(const position of Object.keys(THRESHOLDS))for(const spec of THRESHOLDS[position])for(const tier of ['Safe','Breakout']){
      const threshold=tier==='Safe'?spec.safe:spec.breakout
      const result=rateForTheme(games,side.defense,position,spec,threshold,roster)
      if(result.n<2||result.hits===0)continue
      const book=roleBookForWeek(data.week)
      const teammates=currentPlayers.filter(p=>!p.unavailable&&!p.stale)
      rows.push({...result,position,spec,tier,threshold,defense:side.defense,offense:side.offense,data,
        week:data.week,includeBackups,teammates,candidates:teammates.filter(p=>posMatch(p,position,roster)).flatMap(p=>{
          const gate=roleDecision({...p,team:{name:side.offense.name}},{statKey:spec.key,book,includeBackups,teammates})
          return gate.eligible?[{...p,gate}]:[]
        })})
    }
  }
  return rows.sort((a,b)=>(b.rate??-1)-(a.rate??-1)||b.hits-a.hits|| (a.tier==='Safe'?-1:1)||a.position.localeCompare(b.position)||a.spec.title.localeCompare(b.spec.title))
}
export default function Flyers({data,matchup,roster,halfLife,window,includeBackups=false}){
  const [teamFilter,setTeamFilter]=useState('all')
  const [positionFilter,setPositionFilter]=useState('all')
  const offenses=[{offense:matchup.away,defense:matchup.home},{offense:matchup.home,defense:matchup.away}]
  const themes=useMemo(()=>buildFlyerThemes(data,matchup,roster,halfLife,window,includeBackups),[data,matchup,roster,halfLife,window,includeBackups])
  const teams=[...new Map(offenses.map(side=>[side.offense.id,side.offense])).values()]
  const filtered=themes.filter(theme=>theme.tier==='Breakout'&&(teamFilter==='all'||theme.offense.id===teamFilter)&&
    (positionFilter==='all'||theme.position===positionFilter))
  const items=filtered.map(theme=>({theme,view:breakoutView(theme,matchup)}))
    .sort((a,b)=>(b.view.rate??-1)-(a.view.rate??-1)||b.view.hits-a.view.hits||a.theme.position.localeCompare(b.theme.position)||a.theme.spec.title.localeCompare(b.theme.spec.title))

  return <section className="flyers-section" aria-label="Flyers threshold themes">
    <div className="prop-section-title"><h3>Flyers · most common opponent themes</h3><span>Position + stat + threshold · ranked by recent hit rate</span></div>
    <p className="prop-help">Each row shows how often a player at that position crossed the <b>Breakout</b> line in the defense’s recent games, then identifies the closest-role player on the upcoming offense. Safe thresholds are retained as background support for the PARLAYS overlap range. The hit rate is historical evidence, not a forecast probability. QB “TDs” means rushing TDs; other positions’ TDs combine rushing and receiving. Include backups is off until you turn it on. A backup tagged Shared role already overlaps a listed starter, so that card stays either way.</p>
    <div className="flyers-filters" aria-label="Filter Flyers themes">
      <label>Team<select value={teamFilter} onChange={event=>setTeamFilter(event.target.value)}><option value="all">All teams</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Position<select value={positionFilter} onChange={event=>setPositionFilter(event.target.value)}><option value="all">All positions</option>{Object.keys(THRESHOLDS).map(pos=><option key={pos} value={pos}>{roleName(pos)}</option>)}</select></label>
      <button type="button" onClick={()=>{setTeamFilter('all');setPositionFilter('all')}}>Reset</button>
    </div>
    <div className="flyers-legend"><span className="flyer-breakout-swatch">Breakout · green</span><span>Safe thresholds remain as background support for PARLAYS overlap ranges. RB and WR lines use the higher of the sheet threshold and that player’s Week 12 scatter projection.</span></div>
    {!items.length?<p className="prop-warning">No themes match these filters.</p>:<div className="flyers-board">{items.map(({theme,view},index)=><FlyerTheme key={`${theme.defense.id}:${theme.position}:${theme.spec.key}:${theme.tier}`} theme={theme} view={view} index={index} window={window}/>)}</div>}
    <details className="prop-method"><summary>Threshold rules and data sources</summary>
      <p>Thresholds come from your supplied reference: QB pass yards 260/300, pass TDs 2/3, rush yards 20/35, rushing TDs 1/2; RB rush yards 90/110, receptions 4/6, receiving yards 15/25, total TDs 1/2; WR receptions 6/8, receiving yards 90/110, total TDs 1/2; TE receptions 5/7, receiving yards 40/60, total TDs 1/2. “Safe” and “Breakout” list first and second values respectively.</p>
      <p>For each game, the position group counts as crossing when at least one player at that position reaches the threshold. Hit rates use only recent games with complete box-score categories and position data. A theme enters the ranking with at least two usable games and one crossing; all qualifying themes are shown, ordered by percentage and hit count. Closest player selection uses current-team recent workload compared with the workloads of historical players who crossed the threshold. WR role matching also consults the supplied Ourlads-derived Week 12 sheet (slot/depth/alignment fields marked inferred in that source); it is a supplemental role hint, not tracking data.</p>
      <p>Source: ESPN prior-week individual box scores and current roster positions. WR and RB starter files are built from ESPN depth charts and box scores for the current week when that week's file is in the app; slot, alignment, and goal-line fields ESPN does not publish are marked Uncertain. No sportsbook prices, confirmed starters, snap counts, or route participation are modeled.</p>
      <p>Role gate, with Include backups off: a WR must be WR1, WR2, or WR3 for his current team. An RB receiving theme requires at least 25% of team RB targets or a pass-catching or 3rd-down tag. Rush closest-match ties prefer the higher recent carry share. Questionable backs stay and are flagged; Doubtful and Out stay out, and so do players the roster marks inactive, injured reserve, suspended, retired, or stale from the last game. Depth or minimal-use backs are excluded unless a shared-role signal below lets them back in. A back missing from the sheet stays in and is marked “No role data.” Turning Include backups on adds the remaining depth backs and receivers outside the top three. It does not bring Out, Doubtful, unavailable, or stale players back.</p>
      <p>Shared role, still shown with the toggle off: a third-string or depth/minimal back matches the team’s RB1 when any recorded signal clears a floor or sits near that starter. Goal-line role shared or primary, or an inside-5 carry share of at least 20%. Target share of at least 20%, or at least 12% and within 8 percentage points of the RB1. Carry share of at least 25%, or at least 15% and within 12 points of the RB1. A pass-catching or 3rd-down tag counts only with at least 15% of team RB targets. Receiving cards use the target and tag signals. Rushing cards use the carry and goal-line signals. Blank or “uncertain” goal-line fields are ignored. A receiver outside WR1–WR3 matches when his own ESPN targets are at least 10 over his last 3–4 games and his share of team WR targets is at least 18%, or at least 12% and within 8 points of a listed starter. The WR sheet has no target, red-zone, or slot/deep fields for anyone outside the top three, so those signals are not invented. The card is tagged Shared role. RB and WR breakout lines still use max(sheet breakout line, that player’s scatter projection rounded to the nearest 0.5) when a scatter file exists. The hit rate on those cards is recomputed at the line shown.</p>
    </details>
  </section>
}
