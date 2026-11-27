import {useMemo} from 'react'

const winRate=team=>{
  const games=team.wins+team.losses+team.ties
  return games?(team.wins+team.ties*.5)/games:0
}
const opponentFor=game=>game.winner.id===game.away.id?game.home:game.away

function matchupReason(game){
  const winner=game.winner,opponent=opponentFor(game)
  const options=[
    {score:opponent.ranks.passD-winner.ranks.passO,text:`Passing matchup: No. ${winner.ranks.passO} pass offense against the No. ${opponent.ranks.passD} pass defense.`},
    {score:opponent.ranks.rushD-winner.ranks.rushO,text:`Rushing matchup: No. ${winner.ranks.rushO} run offense against the No. ${opponent.ranks.rushD} run defense.`},
    {score:opponent.ranks.passO-winner.ranks.passD,text:`Pass defense edge: No. ${winner.ranks.passD} defense against the No. ${opponent.ranks.passO} passing attack.`},
    {score:opponent.ranks.rushO-winner.ranks.rushD,text:`Run defense edge: No. ${winner.ranks.rushD} defense against the No. ${opponent.ranks.rushO} rushing attack.`},
  ]
  return options.sort((a,b)=>b.score-a.score)[0]
}
function featureScore(game){
  const winner=game.winner,opponent=opponentFor(game)
  const matchup=Math.max(0,matchupReason(game).score)
  const formGap=(winner.pf-winner.pa)-(opponent.pf-opponent.pa)
  return game.margin+matchup*.08+Math.max(-4,Math.min(8,formGap))*.12
}
function classify(game){
  const opponent=opponentFor(game)
  return winRate(game.winner)+.05<winRate(opponent)?'upset':'favorite'
}
function teamLabel(team){
  const name=String(team?.name||'').trim()
  return name.split(/\s+/).filter(Boolean).at(-1)||team?.abbr||'Team'
}
function marginLabel(margin){
  const text=margin.toFixed(1)
  return text.endsWith('.0')?text.slice(0,-2):text
}
function chipText(game){
  if(game.margin<.05)return `${teamLabel(game.winner)} (Toss-up)`
  return `${teamLabel(game.winner)} (${marginLabel(game.margin)})`
}

export default function WeeklyGames({matchups,onOpen}){
  const {favorites,upsets}=useMemo(()=>{
    const eligible=(matchups||[]).filter(game=>Number.isFinite(game.margin)&&game.margin>=.5)
    const upcoming=eligible.filter(game=>!game.started)
    const available=upcoming.length?upcoming:eligible
    const ranked=[...available].sort((a,b)=>featureScore(b)-featureScore(a))
    const upsets=ranked.filter(game=>classify(game)==='upset').slice(0,2)
    const favorites=ranked.filter(game=>classify(game)!=='upset').slice(0,Math.max(3,5-upsets.length))
    return {favorites,upsets}
  },[matchups])
  const chips=[...favorites.map(game=>({game,upset:false})),...upsets.map(game=>({game,upset:true}))]
  if(!chips.length)return null
  return <div className="model-picks-row" role="region" aria-label="Model favorites and possible upsets">
    {chips.map(({game,upset})=>{
      const logo=game.winner?.logo
      return <button key={game.id} type="button" className={upset?'model-pick model-pick-upset':'model-pick'} onClick={()=>onOpen(game.id)}>
        {logo?<img src={logo} alt="" onError={event=>event.currentTarget.remove()}/>:null}
        <span className="pick-card-copy">
          <span className="pick-card-name">{chipText(game)}</span>
          {upset?<span className="pick-card-tag">(upset)</span>:null}
        </span>
      </button>
    })}
  </div>
}
