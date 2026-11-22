import {performance} from './performance.js'
import {valid} from './model.js'
import {metricLabel} from './analysis.js'
import './performance.css'
const fmt=(n,key)=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
export function PerformanceLegend(){return <div className="performance-legend"><strong>Big-game support</strong><span className="support-low">Amber · lower</span><span className="support-medium">Blue · mixed</span><span className="support-high">Green · higher</span><span>Gray · not rated</span><p>Colors describe recent weighted frequency at the displayed benchmark: below one-third, one-third to under two-thirds, or two-thirds and above. They are not forecast probabilities. The range is the observed weighted 20th–80th percentile, not a floor, ceiling or prediction interval. Numbers on the scale mark that range's endpoints. Missing stats stay missing; recorded zeros count. Expand a support headline for benchmark details and line/odds comparisons where available.</p></div>}
export default function Performance({player,metric,halfLife,lookback,children}){
  const r=performance(player,metric,halfLife,lookback),projection=player.unavailable?null:r.stat?.projection
  const min=Math.min(0,r.low||0,projection||0),max=Math.max(r.high||0,r.threshold,projection||0,1)*1.15
  const point=v=>(v-min)/(max-min)*100
  const low=point(r.low),high=point(r.high),close=high-low<20
  const labelStyle=x=>({left:`${x}%`,transform:`translateX(-${x}%)`})
  return <div className={`performance-stat support-${r.level}`} aria-label={`${metricLabel(metric)} performance`}>
    <div className="performance-head"><strong>{metricLabel(metric)}</strong><span>Projected <b>{player.unavailable?'Withheld':fmt(projection,metric)}</b></span></div>
    {r.low!=null?<div className="performance-scale" role="img" aria-label={`Observed middle range ${fmt(r.low,metric)} to ${fmt(r.high,metric)}; projection ${fmt(projection,metric)}; big-game benchmark ${r.threshold} plus`}>
      <span className="performance-band" style={{left:`${low}%`,width:`${Math.max(1,high-low)}%`}}/>
      <span className="performance-benchmark" style={{left:`${point(r.threshold)}%`}}/>
      {valid(projection)&&<span className="performance-marker" style={{left:`${point(projection)}%`}}/>}
      <span className="range-tick" style={{left:`${low}%`}}/><span className="range-tick" style={{left:`${high}%`}}/>
      {close?<span className="range-axis-label" style={labelStyle((low+high)/2)}>{fmt(r.low,metric)}{r.low!==r.high?`–${fmt(r.high,metric)}`:''}</span>:<><span className="range-axis-label" style={labelStyle(low)}>{fmt(r.low,metric)}</span><span className="range-axis-label" style={labelStyle(high)}>{fmt(r.high,metric)}</span></>}
    </div>:<p className="performance-range">Range unavailable</p>}
    <details className="performance-disclosure"><summary className="performance-support"><strong>{r.label}</strong><span className="support-chevron" aria-hidden="true"/></summary>
      <div className="performance-expanded"><p className="performance-evidence"><b>{r.threshold}+ benchmark</b> · {r.n} valid appearances</p>
      <p className="performance-evidence">{r.weightedRate!=null?`${Math.round(r.weightedRate*100)}% recent weighted frequency · ${r.hits}/${r.n} appearances reached ${r.threshold}+`:`${r.reason}. Historical count: ${r.hits}/${r.n} reached ${r.threshold}+.`}</p>
      {children}</div>
    </details>
  </div>
}
