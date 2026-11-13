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

export default function Bets({ data, matchup, roster, halfLife, window }) {
  const { away, home, winner, margin } = matchup
  const players = [
    ...projectTeam(data, away, home, roster, halfLife, window),
    ...projectTeam(data, home, away, roster, halfLife, window),
  ]
  const [momentum, bounceBack] = candidates(players)
  return <section aria-label="Bets">
    <p className="prop-help">Candidates based on recent workload and box scores. Compare with the book’s line and price before betting.</p>
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
