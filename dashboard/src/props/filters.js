import {relevantMetrics} from './performance.js'
import {statFor} from './analysis.js'
import {valid} from './model.js'
export const POSITIONS=['QB','RB','FB','WR','TE']
export const selectedMetrics=(p,filters)=>relevantMetrics(p).filter(([key])=>filters.stats.includes(key))
export const matchesPlayer=(p,filters)=>filters.teams.includes(p.team.id)&&filters.positions.includes(p.position)&&selectedMetrics(p,filters).length>0
export function projectedOrder(players,key,halfLife,lookback){
 const value=p=>p.unavailable?null:statFor(p,key,halfLife,lookback)?.projection
 return [...players].sort((a,b)=>{const av=value(a),bv=value(b);return valid(av)&&valid(bv)?bv-av||a.name.localeCompare(b.name):valid(av)?-1:valid(bv)?1:a.name.localeCompare(b.name)})
}
