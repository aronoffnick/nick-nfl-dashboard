import {DISPLAY_METRICS} from './analysis.js'
import {POSITIONS} from './filters.js'
const projectionPositions=POSITIONS.filter(position=>position!=='FB')
export const defaultFilters=matchup=>({highSupport:false,teams:[matchup.away.id,matchup.home.id],positions:[...projectionPositions],stats:DISPLAY_METRICS.map(([key])=>key)})
export default function PlayerFilters({matchup,filters,onChange}){
 const toggle=(group,key)=>onChange({...filters,[group]:filters[group].includes(key)?filters[group].filter(v=>v!==key):[...filters[group],key]})
 return <div className="player-filters" aria-label="Player filters">{[['teams','Teams',[[matchup.away.id,matchup.away.name],[matchup.home.id,matchup.home.name]]],['positions','Positions',projectionPositions.map(p=>[p,p])],['stats','Stat categories',DISPLAY_METRICS]].map(([group,label,options])=><fieldset key={group}><legend>{label}</legend>{options.map(([key,name])=><label key={key}><input type="checkbox" checked={filters[group].includes(key)} onChange={()=>toggle(group,key)}/>{name}</label>)}</fieldset>)}<button className="prop-action" onClick={()=>onChange(defaultFilters(matchup))}>Reset filters</button></div>
}
