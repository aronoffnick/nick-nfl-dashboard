import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { chanceText, findTdGame, flavorLabel, priceText, sideCaption } from '../src/props/tdRiskBoard.js'

const board = JSON.parse(readFileSync(new URL('../src/data/td-riskscale-wk12.json', import.meta.url)))

test('week 12 touchdown file covers the three Thanksgiving games', () => {
  assert.equal(board.week, 12)
  assert.equal(board.games.length, 3)
  assert.deepEqual(board.games.map(game => game.key), ['CHI@DET', 'PHI@DAL', 'KC@BUF'])
  assert.equal(findTdGame(board, 'GB', 'LAR'), null)
  assert.equal(findTdGame(board, 'CHI', 'DET').priceSnapshot.asOf, 'Nov 26, 11:07 AM ET')
})

test('Chicago at Detroit uses the refreshed prices', () => {
  const lions = findTdGame(board, 'CHI', 'DET').sides[1]
  const gibbs = lions.rows[0].confident
  assert.equal(gibbs.player, 'Jahmyr Gibbs')
  assert.equal(gibbs.modelProb, 0.684)
  assert.equal(priceText(gibbs), '-263 Polymarket')
  assert.equal(flavorLabel(lions.rows[0].upside[1]), 'Safer 3+')
  assert.equal(lions.rows[0].upside[1].price, null)
  assert.match(sideCaption(findTdGame(board, 'CHI', 'DET').sides[0]), /28 offensive TDs/)
})

test('estimate flags and injury status stay on the pick', () => {
  const bills = findTdGame(board, 'KC', 'BUF').sides[1]
  const kincaid = bills.rows[1].relativelySafe
  assert.equal(kincaid.player, 'Dalton Kincaid')
  assert.equal(kincaid.estimate, true)
  assert.equal(kincaid.status, 'Questionable')
  assert.equal(chanceText(kincaid.modelProb), '19.3%')
  const chiefs = findTdGame(board, 'KC', 'BUF').sides[0]
  assert.deepEqual(chiefs.positionsSkipped, ['QB'])
  assert.equal(chiefs.rows.some(row => row.position === 'QB'), false)
  assert.equal(flavorLabel(chiefs.rows[0].upside[1]), 'Backup')
})

test('rows stay in the file order', () => {
  const eagles = findTdGame(board, 'PHI', 'DAL').sides[0].rows.map(row => row.position)
  assert.deepEqual(eagles, ['RB', 'WR', 'TE', 'QB'])
  const cowboys = findTdGame(board, 'PHI', 'DAL').sides[1].rows.map(row => row.position)
  assert.deepEqual(cowboys, ['WR', 'RB', 'QB', 'TE'])
})
