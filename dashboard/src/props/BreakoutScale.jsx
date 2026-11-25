import { ratingLevel } from './breakout.js'

export default function BreakoutScale({score, className=''}){
  const level=ratingLevel(score)
  const label=level==='unknown'?'Not rated':level==='moderate'?'Moderate':level[0].toUpperCase()+level.slice(1)
  return <div className={`breakout-gauge breakout-${level} ${className}`.trim()} aria-label={score==null?'Breakout index not rated':`Breakout index ${score} out of 100, ${level}`}>
    <div className="breakout-gauge-scale"><span/><span/><span/>{score!=null&&<i style={{left:`${score}%`}}/>}</div>
    <div className="breakout-gauge-labels"><span>Low</span><span>Moderate</span><span>High</span></div>
    <b>{score==null?'Breakout index —':`${score}/100 · ${label}`}</b>
  </div>
}
