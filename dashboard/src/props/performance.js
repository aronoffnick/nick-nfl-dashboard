import {valid} from './model.js'
import {DISPLAY_METRICS,statFor,valueFor} from './analysis.js'
import {ratingLevel} from './breakout.js'
// One fixed set per role. Fullbacks use the running-back columns. Receivers never pick up a rush column from a one-off carry.
export function roleMetricKeys(position){
  if(position==='QB')return ['passYds','passTD','rushYds','totalTD']
  if(position==='RB'||position==='FB')return ['rushYds','rec','recYds','totalTD']
  if(position==='WR'||position==='TE')return ['rec','recYds','totalTD']
  return []
}
export function relevantMetrics(p){
  return roleMetricKeys(p.position).map(k=>DISPLAY_METRICS.find(([key])=>key===k)).filter(Boolean)
}
/** High breakout index only. The mark is the player's own weighted 90th percentile in the selected window, lifted up to 15% as the index goes from 70 to 100. */
export function anticipatedBreakout(player,key,halfLife,lookback,score){
  if(ratingLevel(score)!=='high')return null
  const raw=player.logs.slice(-lookback)
  const rows=raw.flatMap((log,i)=>{const value=valueFor(log,key);return valid(value)?[{value,weight:2**(-(raw.length-1-i)/halfLife)}]:[]})
  if(rows.length<3)return null
  const own=weightedQuantile(rows,.9)
  if(!valid(own))return null
  const lift=(Math.min(100,score)-70)/30
  const line=own*(1+.15*lift)
  if(line<=0)return null
  const places=String(key).endsWith('TD')?2:1
  const factor=10**places
  return Math.round(line*factor)/factor
}
export function bigGameThreshold(p,key){
  return {passYds:275,passTD:3,rushYds:p.position==='QB'?40:['WR','TE'].includes(p.position)?25:75,
    rec:p.position==='TE'?5:p.position==='WR'?6:4,recYds:p.position==='TE'?50:p.position==='WR'?75:40,totalTD:1}[key]
}
export function weightedQuantile(rows,q){
  const sorted=[...rows].sort((a,b)=>a.value-b.value),total=sorted.reduce((s,r)=>s+r.weight,0)
  let sum=0
  for(const row of sorted){sum+=row.weight;if(sum>=total*q)return row.value}
  return sorted.at(-1)?.value??null
}
export function performance(p,key,halfLife=3,lookback=4,benchmark=null){
  const stat=statFor(p,key,halfLife,lookback),raw=p.logs.slice(-lookback),threshold=benchmark??bigGameThreshold(p,key)
  const rows=raw.flatMap((log,i)=>{const value=valueFor(log,key);return valid(value)?[{value,weight:2**(-(raw.length-1-i)/halfLife)}]:[]})
  const hits=rows.filter(r=>r.value>=threshold),n=rows.length
  const blocked=p.unavailable||p.stale||/questionable|day.to.day/i.test(`${p.status} ${p.injury}`)
  const ready=n>=3&&valid(stat?.projection)&&!blocked
  const weightedRate=ready?hits.reduce((s,r)=>s+r.weight,0)/rows.reduce((s,r)=>s+r.weight,0):null
  // Descriptive observed range: no invented forecast distribution or independent-leg probability.
  return {stat,threshold,n,hits:hits.length,weightedRate,low:n>=3?weightedQuantile(rows,.2):null,high:n>=3?weightedQuantile(rows,.8):null,
    level:!ready?'unknown':weightedRate>=2/3?'high':weightedRate>=1/3?'medium':'low',
    label:!ready?'Not rated':weightedRate>=2/3?'Higher recent support':weightedRate>=1/3?'Mixed recent support':'Lower recent support',
    reason:blocked?'Availability or recent-role concern':n<3?'Needs 3 valid appearances':!valid(stat?.projection)?'Projection unavailable':null}
}
export function groupCandidates(candidates){
  const grouped=new Map()
  for(const item of candidates){const id=`${item.player.team.id}:${item.player.id}`;if(!grouped.has(id))grouped.set(id,{id,player:item.player,items:[],score:item.score});grouped.get(id).items.push(item);grouped.get(id).score=Math.max(grouped.get(id).score,item.score)}
  return [...grouped.values()].sort((a,b)=>b.score-a.score||a.player.name.localeCompare(b.player.name))
}
// Rank by the strongest single relevant benchmark, never an invented joint probability.
export function rankPlayerGroups(groups,halfLife=3,lookback=4,stats=null){
  return groups.map(group=>{
    const support=relevantMetrics(group.player).filter(([key])=>!stats||stats.includes(key)).map(([key])=>({key,...performance(group.player,key,halfLife,lookback)}))
      .filter(s=>s.weightedRate!=null).sort((a,b)=>b.weightedRate-a.weightedRate||b.n-a.n)
    return {...group,bestSupport:support[0]||null}
  }).sort((a,b)=>(b.bestSupport?.weightedRate??-1)-(a.bestSupport?.weightedRate??-1)||(b.bestSupport?.n??0)-(a.bestSupport?.n??0)||b.score-a.score||a.player.name.localeCompare(b.player.name))
}
