import {valid,weighted} from './model.js'
import {DISPLAY_METRICS,statFor,valueFor} from './analysis.js'
// Position defaults plus meaningful secondary usage; never render unrelated zero categories.
export function relevantMetrics(p){
  const used=key=>p.logs.some(l=>valid(l[key])&&l[key]>0)
  let keys=p.position==='QB'?['passYds','passTD',...(used('carries')?['rushYds','totalTD']:[])]:
    ['RB','FB'].includes(p.position)?['rushYds',...(used('targets')||used('rec')?['rec','recYds']:[]),'totalTD']:
    ['rec','recYds',...(weighted(p.logs,'carries',3)>=3||weighted(p.logs,'rushYds',3)>=10?['rushYds']:[]),'totalTD']
  return keys.map(k=>DISPLAY_METRICS.find(([key])=>key===k))
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
