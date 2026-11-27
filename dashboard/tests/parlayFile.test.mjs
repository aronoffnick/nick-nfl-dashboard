import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { boardGame, fileCards, filePropCandidates, legHit, propKey, tableConflict, uniqueProps } from '../src/props/parlayBoard.js'

const board = JSON.parse(readFileSync(new URL('../src/data/parlays-wk12.json', import.meta.url)))
const file = { matched: true, data: board }
const games = [['CHI', 'DET'], ['PHI', 'DAL'], ['KC', 'BUF'], ['DEN', 'PIT']]

test('week 12 file is v2 and keeps the three Thanksgiving games', () => {
  assert.equal(board.week, 12)
  assert.equal(board.version, 2)
  for (const key of ['CHI-DET', 'PHI-DAL', 'KC-BUF', 'DEN-PIT']) assert.ok(board.games[key], key)
  assert.equal(board.games['DEN-PIT'].snapshot.props_asof, 'Nov 27, 9:17 AM ET')
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

test('candidate props are one row per player, stat, and line, ranked by hit chance', () => {
  for (const [away, home] of games) {
    const game = boardGame(file, away, home)
    const props = (game.legs || []).filter(leg => leg.kind === 'prop')
    const candidates = filePropCandidates(game)
    assert.equal(candidates.length, props.length, `${away}-${home} keeps every prop`)
    assert.equal(new Set(candidates.map(propKey)).size, candidates.length)
    for (let i = 1; i < candidates.length; i++) {
      assert.ok(legHit(candidates[i - 1]) >= legHit(candidates[i]), `${away}-${home} sorted by hit chance`)
    }
    const cardIds = new Set(fileCards(game).flatMap(card => card.legs.map(leg => leg.id)))
    assert.ok(candidates.length > cardIds.size, `${away}-${home} list is wider than the repeated parlay cards`)
    for (const id of cardIds) assert.ok(candidates.some(leg => leg.id === id))
    assert.ok(candidates.every(leg => leg.kind === 'prop'))
  }
})

test('the same player, stat, and line keeps the higher hit chance', () => {
  const legs = [
    { id: 'low', kind: 'prop', player: "D'Andre Swift", market: 'Rush yds', side: 'Over', line: 60.5, p: 0.41 },
    { id: 'high', kind: 'prop', player: 'Dandre Swift', market: 'Rush yds', side: 'Under', line: 60.5, p: 0.72 },
    { id: 'other', kind: 'prop', player: 'Dandre Swift', market: 'Receptions', side: 'Over', line: 3.5, p: 0.55 },
    { id: 'td', kind: 'td', player: 'Dandre Swift', market: 'TD', side: 'Yes', line: 0.5, p: 0.9 },
    { id: 'ml', kind: 'ml', player: 'Lions moneyline', market: 'ML', line: null, p: 0.8 },
  ]
  assert.deepEqual(filePropCandidates({ legs }).map(leg => leg.id), ['high', 'other'])
  const live = uniqueProps([
    { id: 'weak', player: { name: 'Amon-Ra St. Brown' }, theme: { spec: { key: 'recYds', title: 'Receiving yards' } }, line: 70, concentration: 40 },
    { id: 'strong', player: { name: 'Jahmyr Gibbs' }, theme: { spec: { key: 'rushYds', title: 'Rushing yards' } }, line: 80, concentration: 81 },
  ])
  assert.deepEqual(live.map(leg => leg.id), ['strong', 'weak'])
  assert.equal(legHit(live[0]), 0.81)
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
