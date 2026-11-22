import {performance} from './performance.js'
import {valid} from './model.js'
import {metricLabel} from './analysis.js'
import './performance.css'
const fmt=(n,key)=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
export function PerformanceLegend(){return <div className="performance-legend"><strong>Big-game support</strong><span className="support-low">Amber · lower</span><span className="support-medium">Blue · mixed</span><span className="support-high">Green · higher</span><span>Gray · not rated</span><p>Colors describe recent weighted frequency at the displayed benchmark: below one-third, one-third to under two-thirds, or two-thirds and above. They are not forecast probabilities. The range is the observed weighted 20th–80th percentile, not a floor, ceiling or prediction interval. Missing stats stay missing; recorded zeros count.</p></div>}
export default function Performance({player,metric,halfLife,lookback}){
  const r=performance(player,metric,halfLife,lookback),projection=player.unavailable?null:r.stat?.projection
  const min=Math.min(0,r.low||0,projection||0),max=Math.max(r.high||0,r.threshold,projection||0,1)*1.15
  const point=v=>(v-min)/(max-min)*100
  return <div className={`performance-stat support-${r.level}`} aria-label={`${metricLabel(metric)} performance`}>
    <div className="performance-head"><strong>{metricLabel(metric)}</strong><span>Projected <b>{player.unavailable?'Withheld':fmt(projection,metric)}</b></span></div>
    {r.low!=null?<><div className="performance-scale" role="img" aria-label={`Observed middle range ${fmt(r.low,metric)} to ${fmt(r.high,metric)}; projection ${fmt(projection,metric)}; big-game benchmark ${r.threshold} plus`}>
      <span className="performance-band" style={{left:`${point(r.low)}%`,width:`${Math.max(1,(r.high-r.low)/(max-min)*100)}%`}}/>
      <span className="performance-benchmark" style={{left:`${point(r.threshold)}%`}}/>
      {valid(projection)&&<span className="performance-marker" style={{left:`${point(projection)}%`}}/>}</div>
      <div className="performance-range"><span>Recent middle range <b>{fmt(r.low,metric)}–{fmt(r.high,metric)}</b></span><span>{r.n} appearances</span></div></>:<p className="performance-range">Range unavailable · {r.n} valid appearances</p>}
    <div className="performance-support"><strong>{r.label}</strong><span>{r.threshold}+ benchmark</span></div>
    <p className="performance-evidence">{r.weightedRate!=null?`${Math.round(r.weightedRate*100)}% recent weighted frequency · ${r.hits}/${r.n} appearances reached ${r.threshold}+`:`${r.reason}. Historical count: ${r.hits}/${r.n} reached ${r.threshold}+.`}</p>
  </div>
}
