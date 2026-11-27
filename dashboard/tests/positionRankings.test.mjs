import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { basisSentence, groupRankings, rankGroup, rankingsFromFile } from '../src/positionRankings.js'

const week13 = JSON.parse(readFileSync(new URL('../src/data/momentum-wk13.json', import.meta.url)))

test('equal adjusted projections share a rank and the next rank skips', () => {
  const { rows, missing } = rankGroup([
    { name: 'B', position: 'QB', adjusted: 10, primary: 'passYds' },
    { name: 'A', position: 'QB', adjusted: 10, primary: 'passYds' },
    { name: 'C', position: 'QB', adjusted: 9, primary: 'passYds' },
    { name: 'D', position: 'QB', adjusted: null, primary: 'passYds' },
    { name: 'E', position: 'QB', adjusted: 0, primary: 'passYds' },
  ])
  assert.deepEqual(rows.map(row => [row.name, row.rank, row.adjusted]), [
    ['A', 1, 10],
    ['B', 1, 10],
    ['C', 3, 9],
    ['E', 4, 0],
  ])
  assert.equal(missing.length, 1)
  assert.equal(missing[0].name, 'D')
})

test('core positions stay on the board and other positions appear only when the file has them', () => {
  const groups = groupRankings([
    { name: 'Q', position: 'QB', adjusted: 1, primary: 'passYds' },
    { name: 'K', position: 'K', adjusted: 2, primary: 'kick' },
  ])
  assert.deepEqual(groups.map(group => group.position), ['QB', 'RB', 'WR', 'TE', 'K'])
  assert.equal(groups.find(group => group.position === 'RB').rows.length, 0)
  assert.equal(groups.find(group => group.position === 'RB').inFile, 0)
  assert.equal(groups.find(group => group.position === 'K').rows[0].name, 'K')
  assert.equal(groups.find(group => group.position === 'K').primary, 'kick')
  assert.match(basisSentence('kick'), /adjusted projection stored/)
  assert.doesNotMatch(basisSentence('kick'), /fantasy/i)
})

test('a search that matches nobody does not invent a player', () => {
  const [group] = groupRankings([
    { name: 'Jared Goff', team: 'DET', opponent: 'GB', position: 'QB', adjusted: 293.3, primary: 'passYds' },
  ], { position: 'QB', query: 'zzz' })
  assert.equal(group.inFile, 1)
  assert.equal(group.rows.length, 0)
})

test('the basis names the stored stat', () => {
  assert.match(basisSentence('passYds'), /adjusted projected passing yards this week/)
  assert.match(basisSentence('rushYds'), /adjusted projected rushing yards this week/)
  assert.match(basisSentence('recYds'), /adjusted projected receiving yards this week/)
  assert.doesNotMatch(basisSentence('passYds'), /fantasy/i)
})

test('a missing week file stays empty', () => {
  const board = rankingsFromFile({ matched: false, week: 14, data: null })
  assert.equal(board.status, 'missing')
  assert.deepEqual(board.groups, [])
})

test('the week file is ranked by its own adjusted values', () => {
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const players = week13.players.filter(player => player.position === position)
    const { rows, missing } = rankGroup(players)
    const finite = players.filter(player => Number.isFinite(player.adjusted))
    assert.equal(rows.length, finite.length)
    assert.equal(missing.length, players.length - finite.length)
    assert.equal(rows[0].adjusted, Math.max(...finite.map(player => player.adjusted)))
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].adjusted >= rows[i].adjusted)
    assert.equal(rows[0].adjusted, players.find(player => player.name === rows[0].name).adjusted)
  }
})
