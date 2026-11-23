import { historyFor, sides, projectTeam, valid } from './model.js'
import { statFor, valueFor, metricLabel } from './analysis.js'
const milestones={passYds:[150,175,200,225,250,275],rushYds:[25,50,75,100],recYds:[25,50,75,100],rec:[2,3,4,5,6],totalTD:[1]}
// These are hypothetical at-least milestones, not sportsbook inventory or odds.
export function sgpLegs(players,halfLife=3){
  const legs=[]
  for(const p of players){
    if(p.unavailable||p.stale||p.logs.length<6||/questionable|day.to.day/i.test(`${p.status} ${p.injury}`))continue
    for(const [key,thresholds] of Object.entries(milestones)){
      if(key==='passYds'&&p.position!=='QB')continue
      const s=statFor(p,key,halfLife,6)
      if(!valid(s?.projection)||s.projection<=0)continue
      const observations=p.logs.slice(-6).map(l=>valueFor(l,key)).filter(valid)
      if(observations.length<5)continue
      const usageKey=['passYds','passTD'].includes(key)?'passAtt':key==='rushYds'?'carries':key==='totalTD'&&['RB','FB','QB'].includes(p.position)?'carries':'targets'
      const recentUsage=p.logs.slice(-3).map(g=>g[usageKey]).filter(valid),priorUsage=p.logs.slice(-6,-3).map(g=>g[usageKey]).filter(valid)
      const usageAvg=recentUsage.length===3?recentUsage.reduce((a,b)=>a+b,0)/3:null,priorAvg=priorUsage.length===3?priorUsage.reduce((a,b)=>a+b,0)/3:null
      const recentStat=p.logs.slice(-3).map(g=>valueFor(g,key)).filter(valid),priorStat=p.logs.slice(-6,-3).map(g=>valueFor(g,key)).filter(valid)
      const statAvg=recentStat.length===3?recentStat.reduce((a,b)=>a+b,0)/3:null,priorStatAvg=priorStat.length===3?priorStat.reduce((a,b)=>a+b,0)/3:null
      const signals=[usageAvg!=null&&priorAvg>0&&usageAvg>=priorAvg*1.15?'Rising workload':null,
        s.defense.adjusted&&s.defense.factor>=1.05?'Favorable matchup':null,
        statAvg!=null&&priorStatAvg>0&&statAvg>=priorStatAvg*1.15?'Momentum':null,
        statAvg!=null&&priorStatAvg>0&&usageAvg!=null&&priorAvg>0&&usageAvg>=priorAvg*.9&&statAvg<=priorStatAvg*.8?'Bounce back':null,
        key==='totalTD'&&observations.some(n=>n>=1)?'TD involvement':null].filter(Boolean)
      if(!signals.length)continue
      const choices=thresholds.map(threshold=>{
        const hits=observations.filter(n=>n>=threshold).length
        const rate=hits/observations.length,cushion=(s.projection-threshold)/threshold
        if(rate<2/3||cushion<.2)return null
        const signal=rate*.55+Math.min(cushion,1)*.15+observations.length/6*.1+Math.min(signals.length,3)*.05+(s.defense.adjusted&&s.defense.factor>1?.05:0)
        return {id:`${p.team.id}:${p.id}:${key}`,player:p,key,label:metricLabel(key),threshold,hits,n:observations.length,projection:s.projection,baseline:s.baseline,signal,signals,
          text:`${p.name}: ${threshold}+ ${key==='totalTD'?'TD scored':metricLabel(key).toLowerCase()}`}
      }).filter(Boolean)
      // Retain the highest milestone satisfying both the historical and projection checks.
      if(choices.length)legs.push(choices.at(-1))
    }
  }
  return legs
}
export function chooseSGPPair(legs){
  let best=null
  for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
    const a=legs[i],b=legs[j]
    if(a.player.id===b.player.id)continue
    if(a.key==='totalTD'&&b.key==='totalTD')continue
    // Avoid stacking a quarterback's passing yards with their own team's receiving market.
    const receiving=k=>['rec','recYds'].includes(k)
    if(a.player.team.id===b.player.team.id&&((a.key==='passYds'&&receiving(b.key))||(b.key==='passYds'&&receiving(a.key))))continue
    const signal=Math.min(a.signal,b.signal)*.7+(a.signal+b.signal)/2*.3
    if(!best||signal>best.signal)best={legs:[a,b],signal,
      dependence:a.player.team.id===b.player.team.id?'Same-team usage and game-script dependence.':'Both legs still share pace and game-script risk.'}
  }
  return best
}
export function quarterbackConcern(data,team,roster){
  const recent=historyFor(data,team.id).slice(-2)
  const primary=g=>sides(g,team.id)[0].playerBox?.players.filter(p=>valid(p.passAtt)&&p.passAtt>0).sort((a,b)=>b.passAtt-a.passAtt)[0]
  const latest=recent.at(-1)&&primary(recent.at(-1))
  if(!latest)return `${team.abbr}: recent quarterback usage unavailable`
  const status=roster[latest.id]
  if(!status)return `${team.abbr}: recent quarterback roster status unresolved`
  if(/inactive|injured|reserve|suspended|retired|out|doubtful|questionable|day.to.day/i.test(`${status.status} ${status.injury}`))return `${team.abbr}: recent quarterback availability needs review`
  const earlier=recent.length>1?primary(recent[0]):null
  if(earlier&&latest.id!==earlier.id)return `${team.abbr}: recent quarterback change needs review`
  return null
}
export function sameGameFavorite(data,matchup,roster,halfLife=3,lookback=4,now=Date.now(),existingPlayers=null){
  if(matchup.started||Date.parse(matchup.date)<=now)return {pair:null,reason:'Game has started or finished.'}
  for(const team of [matchup.away,matchup.home]){
    const concern=quarterbackConcern(data,team,roster)
    if(concern)return {pair:null,reason:concern}
  }
  const players=existingPlayers||[[matchup.away,matchup.home],[matchup.home,matchup.away]].flatMap(([team,opponent])=>projectTeam(data,team,opponent,roster,halfLife,lookback).map(p=>({...p,team,opponent})))
  const pair=chooseSGPPair(sgpLegs(players,halfLife))
  return {pair,reason:pair?null:'Fewer than two different players meet the recent-history and projection checks.'}
}
export function weeklySGPFavorites(data,matchups,roster,halfLife=3,lookback=4,now=Date.now()){
  const reviewed=(matchups||[]).map(matchup=>({...sameGameFavorite(data,matchup,roster,halfLife,lookback,now),matchup}))
  return {favorites:reviewed.filter(r=>r.pair).sort((a,b)=>b.pair.signal-a.pair.signal).slice(0,3),skipped:reviewed.filter(r=>!r.pair)}
}
