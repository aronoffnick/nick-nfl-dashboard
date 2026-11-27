import { projectTeam } from './model.js'
import { betSignalScore } from './signals.js'
import { fileForWeek } from '../data/weekFiles.js'
import { scatterAbbrev } from './scatterCheck.js'
import { applyScatter } from './pipelineProjection.js'
import { applyQbStarter } from './qbStarter.js'

export { betSignalScore }

export const THRESHOLDS = {
  QB: [
    { key: 'passYds', title: 'Pass yards', usage: 'passAtt', group: ['passing'], safe: 260, breakout: 300 },
    { key: 'passTD', title: 'Pass TDs', usage: 'passAtt', group: ['passing'], safe: 2, breakout: 3 },
    { key: 'rushYds', title: 'Rush yards', usage: 'carries', group: ['rushing'], safe: 20, breakout: 35 },
    { key: 'rushTD', title: 'TDs (rushing)', usage: 'carries', group: ['rushing'], safe: 1, breakout: 2 },
  ],
  RB: [
    { key: 'rushYds', title: 'Rush yards', usage: 'carries', group: ['rushing'], safe: 90, breakout: 110 },
    { key: 'rec', title: 'Receptions', usage: 'targets', group: ['receiving'], safe: 4, breakout: 6 },
    { key: 'recYds', title: 'Receiving yards', usage: 'targets', group: ['receiving'], safe: 15, breakout: 25 },
    { key: 'totalTD', title: 'TDs (rush + receiving)', usage: 'carries', group: ['rushing', 'receiving'], safe: 1, breakout: 2 },
  ],
  WR: [
    { key: 'rec', title: 'Receptions', usage: 'targets', group: ['receiving'], safe: 6, breakout: 8 },
    { key: 'recYds', title: 'Receiving yards', usage: 'targets', group: ['receiving'], safe: 90, breakout: 110 },
    { key: 'totalTD', title: 'TDs (rush + receiving)', usage: 'targets', group: ['rushing', 'receiving'], safe: 1, breakout: 2 },
  ],
  TE: [
    { key: 'rec', title: 'Receptions', usage: 'targets', group: ['receiving'], safe: 5, breakout: 7 },
    { key: 'recYds', title: 'Receiving yards', usage: 'targets', group: ['receiving'], safe: 40, breakout: 60 },
    { key: 'totalTD', title: 'TDs (rush + receiving)', usage: 'targets', group: ['rushing', 'receiving'], safe: 1, breakout: 2 },
  ],
}

const cache = new Map()

/** One projectTeam pass per game, then the week file's projections where they exist. */
export function boardFor(data, matchup, roster, halfLife, window) {
  const key = [data?.year, data?.week, matchup?.id, halfLife, window, roster ? Object.keys(roster).length : 0].join('|')
  const saved = cache.get(key)
  if (saved) return saved
  const players = [[matchup.away, matchup.home], [matchup.home, matchup.away]].flatMap(([offense, opponent]) =>
    projectTeam(data, offense, opponent, roster, halfLife, window).map(player => ({ ...player, offense, opponent, team: offense }))
  )
  const file = fileForWeek('scatter', data?.week)
  const gameKey = `${scatterAbbrev(matchup.away.abbr)}-${scatterAbbrev(matchup.home.abbr)}`
  const scatterPlayers = file.matched ? file.data?.games?.[gameKey]?.players : null
  const used = scatterPlayers ? applyScatter(players, scatterPlayers) : 0
  const adjusted = applyQbStarter(players, data?.week)
  const result = { players: adjusted, source: used ? 'pipeline' : 'browser', asOf: file.data?.source || null }
  cache.set(key, result)
  return result
}
