import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { boardGame } from '../src/props/parlayBoard.js'
import { americanToDecimal, decimalToAmerican, generateBets, generatorPool } from '../src/props/betGenerator.js'

const board = JSON.parse(readFileSync(new URL('../src/data/parlays-wk12.json', import.meta.url)))
const game = boardGame({ matched: true, data: board }, 'CHI', 'DET')

test('odds helpers round-trip', () => {
  assert.equal(decimalToAmerican(americanToDecimal(-137)), '-137')
  assert.equal(decimalToAmerican(americanToDecimal(250)), '+250')
})

test('pool leaves out TD scorers unless asked and never uses unpriced legs', () => {
  const off = generatorPool(game, { teams: ['CHI', 'DET'] })
  assert.ok(off.legs.every(leg => leg.kind !== 'td' && leg.priced && leg.price != null))
  assert.ok(off.excluded.td > 0 && off.excluded.unpriced > 0)
  const on = generatorPool(game, { teams: ['CHI', 'DET'], includeTD: true })
  assert.ok(on.legs.some(leg => leg.kind === 'td'))
})

test('2 legs, Lions: top pick is ranked by model hit chance, one leg per player, one moneyline', () => {
  const { results } = generateBets(game, { legs: 2, teams: ['DET'] })
  assert.ok(results.length > 0)
  for (const r of results) {
    assert.equal(r.legs.length, 2)
    assert.ok(r.legs.every(leg => leg.team === 'DET'))
    assert.equal(new Set(r.legs.map(leg => leg.player)).size, 2)
    assert.ok(r.legs.filter(leg => leg.kind === 'ml').length <= 1)
  }
  for (let i = 1; i < results.length; i++) assert.ok(results[i - 1].hit >= results[i].hit)
})

test('odds range filters the combined price; position filter drops moneylines', () => {
  const { results } = generateBets(game, { legs: 3, teams: ['CHI', 'DET'], minOdds: '+400', maxOdds: '+800' })
  for (const r of results) assert.ok(r.decimal >= americanToDecimal(400) - 1e-9 && r.decimal <= americanToDecimal(800) + 1e-9)
  const wr = generateBets(game, { legs: 2, teams: ['CHI', 'DET'], position: 'WR' })
  assert.ok(wr.results.every(r => r.legs.every(leg => leg.pos === 'WR')))
  assert.equal(generateBets(game, { legs: 2, minOdds: 'abc' }).error !== null, true)
})
