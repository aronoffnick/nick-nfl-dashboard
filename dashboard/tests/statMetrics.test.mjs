import assert from 'node:assert/strict'
import test from 'node:test'
import stocks from '../src/data/stocks-wk13.json' with { type: 'json' }
import momentum from '../src/data/momentum-wk13.json' with { type: 'json' }
import { statMetricPlayers } from '../src/props/statMetrics.js'

const players = [
  { name: 'Aaron Rodgers', team: 'PIT', position: 'QB' },
  { name: 'C.J. Stroud', team: 'HOU', position: 'QB' },
  { name: 'Patrick Mahomes', team: 'KC', position: 'QB' },
  { name: 'Jaylen Warren', team: 'PIT', position: 'RB' },
  { name: 'Terry McLaurin', team: 'WAS', position: 'WR' },
  { name: 'Puka Nacua', team: 'LAR', position: 'WR' },
]

test('All players inside a game is both teams, not the league', () => {
  const rows = statMetricPlayers(players, { away: 'HOU', home: 'PIT', position: 'All' })
  assert.deepEqual(rows.map(player => player.name).sort(), ['Aaron Rodgers', 'C.J. Stroud', 'Jaylen Warren'])
})

test('a position still narrows the two teams', () => {
  const rows = statMetricPlayers(players, { away: 'HOU', home: 'PIT', position: 'RB' })
  assert.deepEqual(rows.map(player => player.name), ['Jaylen Warren'])
})

test('Commanders and Rams abbreviations match the stat files', () => {
  const rows = statMetricPlayers(players, { away: 'WSH', home: 'LA', position: 'All' })
  assert.deepEqual(rows.map(player => `${player.team} ${player.name}`).sort(), ['LAR Puka Nacua', 'WAS Terry McLaurin'])
})

test('week 13 Steelers game keeps both clubs and drops the rest of the league', () => {
  const merged = new Map()
  for (const player of [...stocks.players, ...momentum.players]) merged.set(`${player.team}|${player.name}`, player)
  const league = [...merged.values()]
  const rows = statMetricPlayers(league, { away: 'HOU', home: 'PIT', position: 'All' })
  assert.ok(rows.length > 0)
  assert.ok(rows.length < league.length)
  assert.ok(rows.some(player => player.team === 'HOU'))
  assert.ok(rows.some(player => player.team === 'PIT'))
  assert.equal(rows.every(player => player.team === 'HOU' || player.team === 'PIT'), true)
})
