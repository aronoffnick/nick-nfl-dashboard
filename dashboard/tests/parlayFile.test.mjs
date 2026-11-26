import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { boardGame, fileCards, tableConflict } from '../src/props/parlayBoard.js'

const board = JSON.parse(readFileSync(new URL('../src/data/parlays-wk12.json', import.meta.url)))
const file = { matched: true, data: board }
const games = [['CHI', 'DET'], ['PHI', 'DAL'], ['KC', 'BUF']]

test('week 12 file is v2 with the three Thanksgiving games', () => {
  assert.equal(board.week, 12)
  assert.equal(board.version, 2)
  assert.deepEqual(Object.keys(board.games), ['CHI-DET', 'PHI-DAL', 'KC-BUF'])
  assert.equal(boardGame({ matched: true, data: { ...board, version: 1 } }, 'CHI', 'DET'), null)
})

for (const [away, home] of games) test(`${away}-${home} Safe-overlap cards follow the model-line rules`, () => {
  const game = boardGame(file, away, home)
  const cards = fileCards(game)
  assert.deepEqual(cards.map(card => card.legs.length), [3, 3, 2, 2, 4])
  const direction = new Map()
  for (const card of cards) {
    assert.equal(new Set(card.legs.map(leg => leg.player)).size, card.legs.length, 'one leg per player')
    for (const leg of card.legs) {
      assert.equal(leg.kind, 'prop', 'no TD scorers or moneylines in the cards')
      assert.ok(['Over', 'Under'].includes(leg.side))
      assert.ok(leg.priced ? /\S/.test(leg.book) && leg.asof : leg.price == null, 'priced legs carry book + as-of, unpriced legs carry no price')
      const prior = direction.get(leg.player)
      assert.ok(!prior || prior === leg.side, `${leg.player} on both sides`)
      direction.set(leg.player, leg.side)
    }
  }
  // no player on both sides anywhere in the leg pool
  const sides = new Map()
  for (const leg of game.legs.filter(leg => leg.kind !== 'ml')) {
    const d = leg.side === 'Under' ? 'under' : 'over'
    assert.ok(!sides.has(leg.player) || sides.get(leg.player) === d, `${leg.player} on both sides in the pool`)
    sides.set(leg.player, d)
  }
})

test('Bears-Lions drops the LaPorta and St. Brown unders that clash with the table overs', () => {
  const game = boardGame(file, 'CHI', 'DET')
  const labels = game.legs.map(leg => leg.label)
  assert.ok(!labels.includes('Sam LaPorta under 4.5 receptions'))
  assert.ok(!labels.includes('Amon-Ra St. Brown under 7.5 receptions'))
  assert.ok(game.dropped.some(item => item.label === 'Sam LaPorta under 4.5 receptions' && /50\.5\+ receiving yards/.test(item.reason)))
  assert.equal(tableConflict({ side: 'Under', player: 'Sam LaPorta' }, new Set(['sam laporta'])), true)
  assert.equal(tableConflict({ side: 'Over', player: 'Sam LaPorta' }, new Set(['sam laporta'])), false)
})
