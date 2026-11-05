import { rosterPlayers } from './model.js'
const API='https://site.api.espn.com/apis/site/v2/sports/football/nfl'
let active
let latest
export async function getRosters(data,progress,force=false) {
  if (!force && latest?.year === data.year && Date.now()-latest.time < 1800000) return latest
  if (active) return active
  active=(async()=>{
    const roster={}, failed=[]
    const ids=Object.keys(data.teams)
    for(let i=0;i<ids.length;i+=4){
      progress(`Resolving player positions and roster status ${i+1}–${Math.min(i+4,ids.length)} of ${ids.length}…`)
      const batch=await Promise.allSettled(ids.slice(i,i+4).map(async id=>{
        const r=await fetch(`${API}/teams/${id}/roster?season=${data.year}`,{signal:AbortSignal.timeout(20000)})
        if(!r.ok)throw new Error(`Roster HTTP ${r.status}`)
        const payload=await r.json()
        const players=rosterPlayers(payload,id)
        if(!players.length)throw new Error('Empty roster')
        return {players,id}
      }))
      batch.forEach((r,j)=>{
        if(r.status==='fulfilled')r.value.players.forEach(p=>{roster[p.id]=p})
        else failed.push(ids[i+j])
      })
    }
    const result={roster,failed,time:Date.now(),year:data.year}
    if(!Object.keys(roster).length)throw new Error('Player rosters could not load. Team analytics remain available; try again.')
    latest=result
    return result
  })()
  try{return await active}finally{active=null}
}
