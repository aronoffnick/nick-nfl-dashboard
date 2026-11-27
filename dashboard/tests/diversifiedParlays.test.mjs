import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDiversifiedParlays, favoriteWinEstimate, independentJoint, legHitEstimate, modelLine } from '../src/props/diversifiedParlays.js'

function log(stats, n = 8) {
  return Array.from({ length: n }, () => stats)
}
function player(id, name, position, team, stats, logs) {
  return {
    id, name, position, team, unavailable: false, stale: false,
    stats: Object.fromEntries(Object.entries(stats).map(([key, projection]) => [key, { projection }])),
    logs: logs || log(stats),
  }
}

const away = { id: 'gb', abbr: 'GB', name: 'Green Bay Packers' }
const home = { id: 'lar', abbr: 'LAR', name: 'Los Angeles Rams' }
const matchup = { away, home, margin: 7, winner: home }

test('model lines sit on a rung below the projection', () => {
  assert.equal(modelLine(253, 'passYds'), 225)
  assert.equal(modelLine(4.6, 'rec'), 3.5)
  assert.equal(modelLine(0.55, 'totalTD'), 0.5)
})

test('a seven-point favorite is about 73 percent, and the joint multiplies', () => {
  assert.ok(Math.abs(favoriteWinEstimate(7) - 0.731) < 0.01)
  assert.equal(independentJoint([{ hit: 0.5 }, { hit: 0.5 }]), 0.25)
})

test('the four categories use the favorite, each passing game, and the script split', () => {
  const players = [
    player('1', 'Jordan Love', 'QB', away, { passYds: 250, passTD: 1.6, rushTD: 0.1, recTD: 0 }),
    player('2', 'Christian Watson', 'WR', away, { recYds: 70, rec: 4.2, recTD: 0.4, rushTD: 0 }),
    player('3', 'Matthew Golden', 'WR', away, { recYds: 55, rec: 3.8, recTD: 0.3, rushTD: 0 }),
    player('4', 'Josh Jacobs', 'RB', away, { rushYds: 80, rec: 3, recYds: 20, rushTD: 0.4, recTD: 0.15 }),
    player('5', 'Matthew Stafford', 'QB', home, { passYds: 260, passTD: 1.8, rushTD: 0.05, recTD: 0 }),
    player('6', 'Tyler Higbee', 'TE', home, { recYds: 48, rec: 4, recTD: 0.3, rushTD: 0 }),
    player('7', 'Kyren Williams', 'RB', home, { rushYds: 75, rec: 4.4, recYds: 30, rushTD: 0.45, recTD: 0.2 }),
  ]
  const [overall, awayStack, homeStack, mix] = buildDiversifiedParlays({ matchup, players })
  assert.equal(overall.legs[0].kind, 'team')
  assert.equal(overall.legs[0].team.abbr, 'LAR')
  assert.ok(overall.legs.length >= 2 && overall.legs.length <= 3)
  assert.ok(awayStack.legs.every(leg => leg.kind === 'team' || leg.player.team.id === 'gb'))
  assert.equal(awayStack.legs[0].player.name, 'Jordan Love')
  assert.ok(awayStack.legs.filter(leg => leg.player?.name === 'Christian Watson').length >= 2)
  assert.equal(homeStack.legs[0].player.name, 'Matthew Stafford')
  assert.equal(mix.legs[0].player.name, 'Kyren Williams')
  assert.equal(mix.legs[0].key, 'rushYds')
  assert.equal(mix.legs[1].player.team.id, 'gb')
  assert.ok(mix.legs[1].why.includes('underdog'))
  assert.ok(overall.joint < Math.min(...overall.legs.map(leg => leg.hit)))
})

test('hit rate weights the full season toward recent games', () => {
  const logs = [...Array.from({ length: 6 }, () => ({ recYds: 10 })), ...Array.from({ length: 2 }, () => ({ recYds: 80 }))]
  const season = legHitEstimate({ logs, key: 'recYds', line: 50, projection: 70, halfLife: 3 })
  const last4 = legHitEstimate({ logs, key: 'recYds', line: 50, projection: 70, window: 4, halfLife: 3 })
  assert.equal(season.n, 8)
  assert.equal(last4.n, 4)
  assert.ok(season.recent > 0 && season.recent < last4.recent)
  assert.ok(season.hit > season.recent * 0.6)
})

test('unavailable players are left to the caller', () => {
  const hurt = player('9', 'Out Back', 'RB', home, { rushYds: 90, rushTD: 0.5, recTD: 0.1, rec: 2, recYds: 10 })
  hurt.unavailable = true
  const [,,, mix] = buildDiversifiedParlays({ matchup, players: [hurt] })
  assert.equal(mix.legs.length < 2, true)
})
