import {anticipatedBreakout,performance} from './performance.js'
import {valid} from './model.js'
import {metricLabel} from './analysis.js'
import './performance.css'
const fmt=(n,key)=>valid(n)?n.toFixed(key.endsWith('TD')?2:1):'—'
export function PerformanceLegend(){return <div className="performance-legend"><strong>Big-game support</strong><span className="support-low">Amber · lower</span><span className="support-medium">Blue · mixed</span><span className="support-high">Green · higher</span><span>Gray · not rated</span><p>Colors describe recent weighted frequency at the displayed benchmark: below one-third, one-third to under two-thirds, or two-thirds and above. They are not forecast probabilities. The range is the observed weighted 20th–80th percentile, not a floor, ceiling or prediction interval. Numbers below the scale mark range endpoints; labels above dashed markers show big-game benchmarks. TD scored also includes a separate 2+ marker and historical frequency in the expanded details. Missing stats stay missing; recorded zeros count. Expand a support headline for benchmark details and line/odds comparisons where available.</p></div>}
export default function Performance({player,metric,halfLife,lookback,children,label,breakoutScore=null}){
  const name=label||metricLabel(metric)
  const r=performance(player,metric,halfLife,lookback),projection=player.unavailable?null:r.stat?.projection
  const twoTD=metric==='totalTD'?performance(player,metric,halfLife,lookback,2):null
  const breakoutLine=anticipatedBreakout(player,metric,halfLife,lookback,breakoutScore)
  const min=Math.min(0,r.low||0,projection||0,breakoutLine||0),max=Math.max(r.high||0,r.threshold,twoTD?2:0,projection||0,breakoutLine||0,1)*1.15
  const point=v=>(v-min)/(max-min)*100
  const low=point(r.low),high=point(r.high),close=high-low<20
  const labelStyle=x=>({left:`${x}%`,transform:`translateX(-${x}%)`})
  return <div className={`performance-stat support-${r.level}${breakoutLine!=null?' has-breakout-line':''}`} aria-label={`${name} performance`}>
    <div className="performance-head"><strong>{name}</strong><span>Projected <b>{player.unavailable?'Withheld':fmt(projection,metric)}</b></span></div>
    {r.low!=null?<div className="performance-scale" role="img" aria-label={`Observed middle range ${fmt(r.low,metric)} to ${fmt(r.high,metric)}; projection ${fmt(projection,metric)}; big-game benchmark ${r.threshold} plus${breakoutLine!=null?`; anticipated breakout ${fmt(breakoutLine,metric)}`:''}${twoTD?'; second touchdown benchmark 2 plus':''}`}>
      <span className="performance-band" style={{left:`${low}%`,width:`${Math.max(1,high-low)}%`}}/>
      <span className="performance-benchmark" style={{left:`${point(r.threshold)}%`}}/><span className="benchmark-axis-label" style={labelStyle(point(r.threshold))}>{r.threshold}+</span>
      {breakoutLine!=null&&<><span className="breakout-level-mark" style={{left:`${point(breakoutLine)}%`}}/><span className="breakout-level-label" style={labelStyle(point(breakoutLine))}>Breakout {fmt(breakoutLine,metric)}</span></>}
      {twoTD&&<><span className="performance-benchmark second-td-benchmark" style={{left:`${point(2)}%`}}/><span className="benchmark-axis-label second-td-label" style={labelStyle(point(2))}>2+</span></>}
      {valid(projection)&&<span className="performance-marker" style={{left:`${point(projection)}%`}}/>}
      <span className="range-tick" style={{left:`${low}%`}}/><span className="range-tick" style={{left:`${high}%`}}/>
      {close?<span className="range-axis-label" style={labelStyle((low+high)/2)}>{fmt(r.low,metric)}{r.low!==r.high?`–${fmt(r.high,metric)}`:''}</span>:<><span className="range-axis-label" style={labelStyle(low)}>{fmt(r.low,metric)}</span><span className="range-axis-label" style={labelStyle(high)}>{fmt(r.high,metric)}</span></>}
    </div>:<p className="performance-range">Range unavailable</p>}
    <details className="performance-disclosure"><summary className="performance-support"><strong>{r.label}</strong><span className="support-chevron" aria-hidden="true"/></summary>
      <div className="performance-expanded"><p className="performance-evidence"><b>{r.threshold}+ benchmark</b> · {r.n} valid appearances</p>
      <p className="performance-evidence">{r.weightedRate!=null?`${Math.round(r.weightedRate*100)}% recent weighted frequency · ${r.hits}/${r.n} appearances reached ${r.threshold}+`:`${r.reason}. Historical count: ${r.hits}/${r.n} reached ${r.threshold}+.`}</p>
      {twoTD&&<p className={`performance-evidence support-${twoTD.level}`}><b>2+ touchdowns scored</b>: {twoTD.hits}/{twoTD.n} recent appearances{twoTD.weightedRate!=null?` · ${Math.round(twoTD.weightedRate*100)}% recent weighted frequency`:` · ${twoTD.reason}`}.</p>}
      {children}</div>
    </details>
  </div>
}
export function StatScale({player,metric,halfLife=3,lookback=4,baseline=null}){
  const r=performance(player,metric,halfLife,lookback)
  const projection=player.unavailable?null:r.stat?.projection
  const base=valid(baseline)?baseline:r.stat?.baseline
  const hasRange=r.low!=null&&r.high!=null
  const hasProj=valid(projection)
  const hasBase=valid(base)
  const min=Math.min(0,hasRange?r.low:0,hasProj?projection:0,hasBase?base:0)
  const max=Math.max(hasRange?r.high:0,hasProj?projection:0,hasBase?base:0,1)*1.15
  const point=v=>(v-min)/(max-min)*100
  const labelStyle=x=>({left:`${x}%`,transform:`translateX(-${x}%)`})
  const lowPoint=hasRange?point(r.low):null,highPoint=hasRange?point(r.high):null,close=hasRange&&highPoint-lowPoint<22
  const notes=[!hasProj&&'Projection unavailable',!hasRange&&'Observed range unavailable',!hasBase&&'Baseline unavailable'].filter(Boolean)
  return <div className={`flyer-stat-scale performance-stat support-${r.level}`}>
    <div className="performance-scale" role="img" aria-label={[hasRange?`Observed range ${fmt(r.low,metric)} to ${fmt(r.high,metric)}`:null,hasProj?`projection ${fmt(projection,metric)}`:null,hasBase?`baseline ${fmt(base,metric)}`:null,notes.join('; ')].filter(Boolean).join('; ')}>
      {hasRange&&<>
        <span className="performance-band" style={{left:`${lowPoint}%`,width:`${Math.max(1,highPoint-lowPoint)}%`}}/>
        <span className="range-tick" style={{left:`${lowPoint}%`}}/><span className="range-tick" style={{left:`${highPoint}%`}}/>
        {close?<span className="range-axis-label" style={labelStyle((lowPoint+highPoint)/2)}>{fmt(r.low,metric)}{r.low!==r.high?`–${fmt(r.high,metric)}`:''}</span>:<><span className="range-axis-label" style={labelStyle(lowPoint)}>{fmt(r.low,metric)}</span><span className="range-axis-label" style={labelStyle(highPoint)}>{fmt(r.high,metric)}</span></>}
      </>}
      {hasProj&&<><span className="performance-marker" style={{left:`${point(projection)}%`}}/><span className="benchmark-axis-label" style={labelStyle(point(projection))}>{fmt(projection,metric)}</span></>}
      {hasBase&&<><span className="performance-benchmark flyer-baseline-marker" style={{left:`${point(base)}%`}}/><span className="benchmark-axis-label flyer-baseline-label" style={labelStyle(point(base))}>base {fmt(base,metric)}</span></>}
    </div>
    <small className="flyer-scale-readout">{hasProj?`${fmt(projection,metric)} projected`:'Projection unavailable'} · {hasRange?`${fmt(r.low,metric)}–${fmt(r.high,metric)} range`:'Observed range unavailable'} · {hasBase?`${fmt(base,metric)} baseline`:'Baseline unavailable'}</small>
  </div>
}
