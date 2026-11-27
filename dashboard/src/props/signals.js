import { valid, weighted } from './model.js'

const average = (games, key) => games.length && games.every(game => valid(game[key]))
  ? games.reduce((sum, game) => sum + game[key], 0) / games.length : null

function totalTD(game, position) {
  const keys = position === 'QB' ? ['rushTD'] : ['rushTD', 'recTD']
  return keys.every(key => valid(game[key])) ? keys.reduce((total, key) => total + game[key], 0) : null
}

export function betSignalScore(player, halfLife = 3) {
  const usageKey = player.position === 'QB' ? 'passAtt' : ['RB', 'FB'].includes(player.position) ? 'carries' : 'targets'
  // Trend signal only: last 3 appearances versus the prior 3. Not the stat window.
  const now = average(player.logs.slice(-3), usageKey), before = average(player.logs.slice(-6, -3), usageKey)
  const stat = player.position === 'QB' ? 'passYds' : ['RB', 'FB'].includes(player.position) ? 'rushYds' : 'recYds'
  const outputNow = average(player.logs.slice(-3), stat), outputBefore = average(player.logs.slice(-6, -3), stat)
  const rising = valid(now) && valid(before) && before > 0 && now >= before * 1.15
  const momentum = valid(outputNow) && valid(outputBefore) && outputBefore > 0 && outputNow >= outputBefore * 1.15
  const bounce = valid(now) && valid(before) && before > 0 && now >= before * .9 && valid(outputNow) && valid(outputBefore) && outputBefore > 0 && outputNow <= outputBefore * .8
  const defense = player.stats?.[stat]?.defense
  const favorable = defense?.adjusted && defense.factor >= 1.05
  const tdRows = (player.logs || []).map(game => {
    const scored = totalTD(game, player.position)
    return { scored: valid(scored) ? (scored >= 1 ? 1 : 0) : null }
  })
  const tdRate = weighted(tdRows, 'scored', halfLife)
  return (rising ? 2 : 0) + (momentum ? 2 : 0) + (bounce ? 1 : 0) + (favorable ? 2 : 0) + (valid(tdRate) ? tdRate : 0)
}
