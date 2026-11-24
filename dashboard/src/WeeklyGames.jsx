import {useMemo} from 'react'

const fmt=value=>Number.isFinite(value)?value.toFixed(1):'—'
const winRate=team=>{
  const games=team.wins+team.losses+team.ties
  return games?(team.wins+team.ties*.5)/games:0
}
const record=team=>`${team.wins}–${team.losses}${team.ties?`–${team.ties}`:''}`
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
function explain(game){
  const winner=game.winner,opponent=opponentFor(game)
  const winnerPoints=winner.id===game.away.id?game.awayPoints:game.homePoints
  const opponentPoints=winner.id===game.away.id?game.homePoints:game.awayPoints
  const scoringEdge=winner.pf-opponent.pf
  return [
    `Projected score: ${winner.abbr} ${fmt(winnerPoints)}, ${opponent.abbr} ${fmt(opponentPoints)} — ${winner.abbr} by ${fmt(game.margin)}.`,
    matchupReason(game).text,
    scoringEdge>=0
      ? `${winner.name} has scored ${fmt(scoringEdge)} more points per game recently than ${opponent.name}.`
      : `${winner.name} gets the model's nod from the matchup even though ${opponent.name} has scored ${fmt(Math.abs(scoringEdge))} more points per game recently.`,
  ]
}
function classify(game){
  const opponent=opponentFor(game)
  return winRate(game.winner)+.05<winRate(opponent)?'upset':'favorite'
}

function GameCard({game,index,onOpen}){
  const winner=game.winner,opponent=opponentFor(game),upset=classify(game)==='upset'
  const reasons=explain(game)
  return <article className={`weekly-game-card ${upset?'upset-watch':''}`}>
    <header>
      <div><span className="weekly-game-label">{upset?'POSSIBLE UPSET':index===0?'TOP GAME':'MODEL FAVORITE'}</span><h3>{winner.logo&&<img src={winner.logo} alt=""/>}{winner.name}</h3><p>over {opponent.name}</p></div>
      <div className="weekly-margin"><strong>{winner.abbr} by {fmt(game.margin)}</strong><span>{winner.id===game.home.id?'Home':'Away'} pick</span></div>
    </header>
    <ul>{reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
    <button className="weekly-open" onClick={()=>onOpen(game.id)}>Open matchup</button>
    <details><summary>More model detail</summary>
      <div className="weekly-detail-grid">
        <p><b>Records</b><span>{winner.abbr} {record(winner)} · {opponent.abbr} {record(opponent)}</span></p>
        <p><b>Recent scoring</b><span>{winner.abbr} {fmt(winner.pf)} scored / {fmt(winner.pa)} allowed</span></p>
        <p><b>{winner.abbr} offense</b><span>Pass #{winner.ranks.passO} · Rush #{winner.ranks.rushO}</span></p>
        <p><b>{opponent.abbr} defense</b><span>Pass #{opponent.ranks.passD} · Rush #{opponent.ranks.rushD}</span></p>
      </div>
      <p className="weekly-caveat">{upset?'Upset status means the model selected the team with the worse current record; it is not based on a sportsbook spread. ':''}The ranking uses projected margin, recent scoring form, and offense-versus-defense matchup ranks. It does not include current injuries, confirmed starting quarterbacks, weather, or betting lines.</p>
    </details>
  </article>
}

export default function WeeklyGames({matchups,onOpen}){
  const featured=useMemo(()=>{
    const available=(matchups||[]).filter(game=>!game.started&&Number.isFinite(game.margin)&&game.margin>=.5)
    const ranked=[...available].sort((a,b)=>featureScore(b)-featureScore(a))
    const upsets=ranked.filter(game=>classify(game)==='upset').slice(0,2)
    const favorites=ranked.filter(game=>classify(game)!=='upset').slice(0,Math.max(3,5-upsets.length))
    return [...favorites,...upsets].slice(0,5)
  },[matchups])
  if(!featured.length)return null
  return <section className="weekly-games" aria-label="Favorite games of the week">
    <div className="weekly-games-heading"><div><p className="eyebrow">GAMES TO WATCH</p><h2>Model favorites this week.</h2></div><p>Top projected matchups, plus record-based upset possibilities.</p></div>
    <div className="weekly-games-grid">{featured.map((game,index)=><GameCard key={game.id} game={game} index={index} onOpen={onOpen}/>)}</div>
  </section>
}
