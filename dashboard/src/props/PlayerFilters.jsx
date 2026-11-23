import {DISPLAY_METRICS} from './analysis.js'
import {POSITIONS} from './filters.js'
export const defaultFilters=matchup=>({teams:[matchup.away.id,matchup.home.id],positions:[...POSITIONS],stats:DISPLAY_METRICS.map(([key])=>key)})
export default function PlayerFilters({matchup,filters,onChange}){
 const toggle=(group,key)=>onChange({...filters,[group]:filters[group].includes(key)?filters[group].filter(v=>v!==key):[...filters[group],key]})
 return <div className="player-filters" aria-label="Player filters">{[['teams','Teams',[[matchup.away.id,matchup.away.name],[matchup.home.id,matchup.home.name]]],['positions','Positions',POSITIONS.map(p=>[p,p])],['stats','Stat categories',DISPLAY_METRICS]].map(([group,label,options])=><fieldset key={group}><legend>{label}</legend>{options.map(([key,name])=><label key={key}><input type="checkbox" checked={filters[group].includes(key)} onChange={()=>toggle(group,key)}/>{name}</label>)}</fieldset>)}<button className="prop-action" onClick={()=>onChange(defaultFilters(matchup))}>Reset filters</button><small>Filters apply to player rows in both tabs. The matchup SGP remains separate.</small></div>
}
