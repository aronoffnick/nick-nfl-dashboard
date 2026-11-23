import { useState } from 'react'
import { projectTeam, valid } from './model.js'

function average(games, key) {
  if (!games.every(game => valid(game[key]))) return null
  return games.reduce((sum, game) => sum + game[key], 0) / games.length
}

function candidates(players) {
  const momentum = []
  const bounceBack = []
  for (const player of players) {
    if (player.unavailable || player.stale || player.logs.length < 6) continue
    const recent = player.logs.slice(-3)
    const prior = player.logs.slice(-6, -3)
    const markets = {
      QB: [['passAtt', 'passYds', 'passing yards', 'attempts']],
      RB: [['carries', 'rushYds', 'rushing yards', 'carries']],
      FB: [['carries', 'rushYds', 'rushing yards', 'carries']],
      WR: [['targets', 'recYds', 'receiving yards', 'targets']],
      TE: [['targets', 'recYds', 'receiving yards', 'targets']],
    }
    for (const [usage, stat, market, unit] of markets[player.position]) {
      const before = average(prior, usage)
      const now = average(recent, usage)
      const projection = player.stats[stat].projection
      if (!valid(before) || !valid(now) || now < 4 || !valid(projection)) continue
      const workload = `${now.toFixed(1)} ${unit} per game over the last three, versus ${before.toFixed(1)} in the previous three.`
      const name = `${player.name} · ${market}`
      if (now - before >= 2 && now >= before * 1.2) {
        momentum.push({ name, reason: workload, score: now - before })
      }
      const yards = average(recent, stat)
      const oldYards = average(prior, stat)
      if (now >= before * 0.9 && valid(yards) && valid(oldYards) && oldYards > 0 && yards <= oldYards * 0.75) {
        bounceBack.push({ name, reason: `Yards fell from ${oldYards.toFixed(1)} to ${yards.toFixed(1)} per game. ${workload}`, score: 1 - yards / oldYards })
      }
      const touchdown = game => valid(game.rushTD) && valid(game.recTD) ? game.rushTD + game.recTD : null
      const priorScores = prior.map(touchdown)
      if (player.position !== 'QB' && now >= before * 0.9 && recent.every(game => touchdown(game) === 0) &&
          priorScores.every(valid) && priorScores.some(total => total > 0)) {
        bounceBack.push({ name: `${player.name} · anytime touchdown`, reason: `No touchdowns in the last three appearances. ${workload}`, score: priorScores.filter(total => total > 0).length / 3 })
      }
    }
  }
  return [momentum, bounceBack].map(group => group.sort((a, b) => b.score - a.score)[0])
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const numberStats = player => player.position === 'QB'
  ? ['passYds', 'passTD', 'rushYds', 'rushTD']
  : player.position === 'WR' || player.position === 'TE'
    ? ['recYds', 'rec', 'recTD']
    : ['rushYds', 'recYds', 'carries', 'rec', 'rushTD', 'recTD']
const statLabels = { passYds:'Pass yd', passTD:'Pass TD', rushYds:'Rush yd', rushTD:'Rush TD', recYds:'Rec yd', rec:'Rec', recTD:'Rec TD' }

function breakoutRating(player) {
  const usageKey = player.position === 'QB' ? 'passAtt' : ['RB','FB'].includes(player.position) ? 'carries' : 'targets'
  const recent = average(player.logs.slice(-3), usageKey)
  const prior = average(player.logs.slice(-6, -3), usageKey)
  const trend = valid(recent) && valid(prior) && prior > 0 ? clamp(50 + 125 * (recent / prior - 1), 0, 100) : 50
  const mainStat = player.position === 'QB' ? 'passYds' : ['RB','FB'].includes(player.position) ? 'rushYds' : 'recYds'
  const factor = player.stats[mainStat].defense.factor
  const matchup = valid(factor) ? clamp((factor - 0.75) / 0.5 * 100, 0, 100) : 50
  const reliability = clamp(player.stats[mainStat].sample / 8 * 100, 0, 100)
  return Math.round(trend * 0.4 + matchup * 0.35 + reliability * 0.25)
}

function recentRange(player, key, window) {
  const values = player.logs.slice(-window).map(game => game[key]).filter(valid)
  return values.length ? `${Math.min(...values)}–${Math.max(...values)}` : '—'
}

export default function Bets({ data, matchup, roster, halfLife, window }) {
  const { away, home, winner, margin } = matchup
  const [projectionFilter, setProjectionFilter] = useState('favorites')
  const players = [
    ...projectTeam(data, away, home, roster, halfLife, window).map(player => ({ ...player, offense:away })),
    ...projectTeam(data, home, away, roster, halfLife, window).map(player => ({ ...player, offense:home })),
  ].map(player => ({ ...player, breakoutScore:breakoutRating(player) }))
  const [momentum, bounceBack] = candidates(players)
  const ranked = [...players].sort((a,b) => b.breakoutScore - a.breakoutScore)
  const visible = ranked.filter(player => projectionFilter === 'all' || player.breakoutScore >= 65)
  return <section aria-label="Bets">
    <p className="prop-help">Player projections and a directional breakout composite built from recent role trend (40%), matchup adjustment (35%), and sample reliability (25%). It is a ranking aid, not a probability or betting guarantee.</p>
    <div className="prop-section-title"><h3>Player projections & breakout potential</h3><span>Green = high · yellow = moderate · red = lower</span></div>
    <label className="prop-filter">Show players<select value={projectionFilter} onChange={event=>setProjectionFilter(event.target.value)}><option value="favorites">Favorites · score 65+</option><option value="all">All projections</option></select></label>
    <div className="table-wrap"><table><thead><tr><th>Player</th><th>Composite</th><th>Projected markets</th><th>Recent range</th><th>Breakout angles</th></tr></thead>
      <tbody>{visible.map(player=>{
        const markets=numberStats(player).filter(key=>valid(player.stats[key]?.projection))
        const angles=markets.filter(key=>player.breakoutScore>=70&&['passYds','rushYds','recYds','rec'].includes(key))
        const tdKeys=player.position==='QB'?['passTD','rushTD']:['rushTD','recTD']
        const tdProjection=tdKeys.reduce((sum,key)=>sum+(player.stats[key]?.projection||0),0)
        const tdValues=player.logs.slice(-window).map(game=>tdKeys.every(key=>valid(game[key]))?tdKeys.reduce((sum,key)=>sum+game[key],0):null).filter(valid)
        const multipleTD=tdValues.some(value=>value>=2)
        const level=player.breakoutScore>=70?'high':player.breakoutScore>=45?'moderate':'low'
        return <tr key={`${player.offense.id}-${player.id}`}>
          <td>{player.name}<small>{player.offense.abbr} · {player.position}</small></td>
          <td><span className={`breakout-score breakout-${level}`}>{player.breakoutScore}/100 · {level==='high'?'High':level==='moderate'?'Moderate':'Lower'}</span></td>
          <td>{markets.map(key=><span className="projection-chip" key={key}>{statLabels[key]} {player.stats[key].projection.toFixed(1)}</span>)}</td>
          <td>{markets.filter(key=>['passYds','rushYds','recYds','rec'].includes(key)).map(key=><span className="projection-chip" key={key}>{statLabels[key]} {recentRange(player,key,window)}</span>)}</td>
          <td>{player.breakoutScore>=70?angles.map(key=><span className="projection-chip" key={key}>{statLabels[key]} upside: {recentRange(player,key,window)}</span>):'No high breakout signal'}{tdProjection>=0.75&&<span className="projection-chip">TD projection {tdProjection.toFixed(1)} / game{multipleTD?` · recent ${window}-game range includes 2+ TDs`:''}</span>}</td>
        </tr>
      })}</tbody></table></div>
    {!visible.length&&<p className="prop-warning">No players meet the Favorites threshold. Choose All projections to see every eligible player.</p>}
    <p className="prop-help">Recent ranges show actual minimum–maximum results in the selected lookback, not a predicted confidence interval. “2+ TD” notes a recent ceiling game; it does not estimate the chance of multiple touchdowns.</p>
    <div className="prop-section-title"><h3>Other bet notes</h3><span>Compare with sportsbook lines and prices</span></div>
    <div className="table-wrap"><table>
      <thead><tr><th>Category</th><th>Candidate</th><th>Why it stands out</th></tr></thead>
      <tbody>
        <tr><th scope="row">Best Bet</th><td>Pass</td><td>{margin < 0.05 ? 'Team projection is a toss-up.' : `Team lean: ${winner.abbr} by ${margin.toFixed(1)}.`} Sportsbook prices are unavailable.</td></tr>
        {[['Momentum', momentum], ['Bounce-Back', bounceBack]].map(([label, pick]) =>
          <tr key={label}><th scope="row">{label}</th><td>{pick?.name ?? 'Pass'}</td><td>{pick?.reason ?? 'No qualifying candidate.'}</td></tr>
        )}
      </tbody>
    </table></div>
  </section>
}
