import { valid, weighted } from './model.js'
export const DISPLAY_METRICS = [['passYds','Pass yards'],['passTD','Pass TD'],['rushYds','Rush yards'],['rec','Receptions'],['recYds','Rec yards'],['totalTD','TD scored']]
export const metricLabel = key => DISPLAY_METRICS.find(([k])=>k===key)?.[1] || key
export const valueFor = (row,key) => key==='totalTD' ? (valid(row.rushTD)&&valid(row.recTD)?row.rushTD+row.recTD:null) : row[key]
export function statFor(player,key,halfLife=3,lookback=4){
  if(key!=='totalTD')return player.stats[key]
  const logs=player.logs.map(log=>({...log,totalTD:valueFor(log,'totalTD')}))
  const values=logs.slice(-lookback).map(l=>l.totalTD).filter(valid)
  const sample=logs.filter(l=>valid(l.totalTD)).length
  const baseline=weighted(logs,'totalTD',halfLife)
  const rush=player.stats.rushTD,rec=player.stats.recTD
  const projection=sample>=3&&valid(rush?.projection)&&valid(rec?.projection)?rush.projection+rec.projection:null
  return {baseline,projection,sample,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,
    defense:{factor:baseline>0&&valid(projection)?projection/baseline:1,adjusted:!!rush?.defense?.adjusted||!!rec?.defense?.adjusted,sample:Math.min(rush?.defense?.sample||0,rec?.defense?.sample||0)}}
}
export function lineComparison(player,key,line,halfLife,lookback){
  if(String(line).trim()===''||!valid(Number(line))||Number(line)<0)return null
  const values=player.logs.slice(-lookback).map(log=>valueFor(log,key)).filter(valid)
  const s=statFor(player,key,halfLife,lookback)
  return {projection:player.unavailable?null:s.projection,delta:!player.unavailable&&valid(s.projection)?s.projection-Number(line):null,
    over:values.filter(v=>v>Number(line)).length,push:values.filter(v=>v===Number(line)).length,n:values.length}
}
export function breakEven(odds){
  if(!/^[+-]?\d+$/.test(String(odds).trim()))return null
  const n=Number(odds)
  if(Math.abs(n)<100)return null
  return n>0?100/(n+100):(-n)/(-n+100)
}
const average=(rows,key)=>rows.length&&rows.every(r=>valid(r[key]))?rows.reduce((s,r)=>s+r[key],0)/rows.length:null
export function buildCandidates(players,halfLife,lookback){
  const picks=[]
  for(const p of players){
    if(p.unavailable||p.stale||p.logs.length<3)continue
    for(const key of ['passYds','rushYds','rec','recYds','totalTD']){
      if(key==='passYds'&&p.position!=='QB')continue
      const s=statFor(p,key,halfLife,lookback)
      const minimum={passYds:75,rushYds:10,rec:1,recYds:10,totalTD:.1}[key]
      if(!valid(s.projection)||s.projection<minimum)continue
      const usageKey=key==='passYds'?'passAtt':key==='rushYds'?'carries':key==='totalTD'&&['RB','FB','QB'].includes(p.position)?'carries':'targets'
      const recent=p.logs.slice(-3),prior=p.logs.slice(-6,-3)
      const now=average(recent,usageKey),before=prior.length===3?average(prior,usageKey):null
      const trend=valid(now)&&valid(before)&&before>0?(now-before)/before:null
      const recentValue=average(recent.map(log=>({value:valueFor(log,key)})),'value')
      const oldValue=prior.length===3?average(prior.map(log=>({value:valueFor(log,key)})),'value'):null
      const momentum=valid(trend)&&trend>=.2&&now-before>=1
      // A yardage drop with steady usage is a research flag, never an assumption a player is due.
      const efficiencyDip=key!=='totalTD'&&valid(trend)&&trend>=-.1&&valid(recentValue)&&oldValue>0&&recentValue<=oldValue*.75
      const favorable=s.defense.adjusted&&s.defense.factor>=1.05
      const risk=/questionable|day.to.day/i.test(`${p.status} ${p.injury}`)
      const badges=[momentum?'Rising workload':null,favorable?'Favorable matchup':null,efficiencyDip?'Usage holds; output down':null,key==='totalTD'?'TD involvement':null].filter(Boolean)
      const score=(momentum?2:0)+(favorable?2:0)+(efficiencyDip?1:0)+(key==='totalTD'?Math.min(s.projection,1):0)+Math.min(p.logs.length,8)/8-(risk?1:0)
      const evidence=p.logs.length>=6&&s.defense.sample>=3&&!risk?'More data':'Limited data'
      const reasons=[]
      if(valid(now))reasons.push(`${now.toFixed(1)} ${usageKey==='passAtt'?'attempts':usageKey} per appearance over the last ${recent.length}${valid(before)?`, versus ${before.toFixed(1)} in the previous three`:''}`)
      if(s.defense.adjusted)reasons.push(`Opponent adjustment ${s.defense.factor>=1?'+':''}${((s.defense.factor-1)*100).toFixed(1)}%`)
      if(efficiencyDip)reasons.push('Recent output fell despite sustained usage; recovery is not assured')
      if(key==='totalTD')reasons.push('Rushing + receiving TDs only; passing TDs excluded')
      if(risk)reasons.push(`Availability flag: ${p.injury||p.status}`)
      picks.push({id:`${p.id}:${key}`,player:p,key,stat:s,badges:badges.length?badges:['Baseline watch'],score,evidence,reasons,trend,risk})
    }
  }
  return picks.sort((a,b)=>b.score-a.score||b.stat.projection-a.stat.projection)
}
