import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { accuracyLines } from '../src/data/accuracyLines.js'

function read(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url)))
}

function pricesOf(game) {
  const picks = []
  for (const side of game.sides || []) {
    for (const row of side.rows || []) {
      for (const pick of [row.confident, row.relativelySafe, ...(row.upside || [])]) {
        if (pick) picks.push(pick)
      }
    }
  }
  return picks
}

test('week 12 and week 13 boards cover every scatter game', () => {
  for (const week of [12, 13]) {
    const scatter = read(`../src/data/scatter-wk${week}.json`)
    const touchdowns = read(`../src/data/td-riskscale-wk${week}.json`)
    const parlays = read(`../src/data/parlays-wk${week}.json`)
    const keys = Object.keys(scatter.games)
    assert.ok(keys.length >= (week === 12 ? 16 : 14))
    const tdKeys = new Set(touchdowns.games.map(game => game.key.replace('@', '-')))
    for (const key of keys) {
      assert.ok(tdKeys.has(key), `touchdowns missing ${key}`)
      assert.ok(parlays.games[key]?.legs?.length, `parlays missing ${key}`)
      assert.ok(scatter.games[key].players.length > 0, `scatter empty ${key}`)
    }
  }
})

test('pipeline games leave prices blank and the saved Thanksgiving prices stay', () => {
  const week12 = read('../src/data/td-riskscale-wk12.json')
  const lions = week12.games.find(game => game.key === 'CHI@DET').sides[1].rows[0].confident
  assert.equal(lions.player, 'Jahmyr Gibbs')
  assert.equal(lions.price, '-263')
  const packers = week12.games.find(game => game.key === 'GB@LAR')
  assert.ok(pricesOf(packers).every(pick => pick.price == null))
  const week13 = read('../src/data/td-riskscale-wk13.json')
  for (const game of week13.games) assert.ok(pricesOf(game).every(pick => pick.price == null))
  const parlays = read('../src/data/parlays-wk13.json')
  for (const game of Object.values(parlays.games)) {
    assert.ok(game.legs.every(leg => leg.price == null && leg.priced === false))
  }
})

test('calibration summary is present and scales stay within 10 percent', () => {
  const report = read('../src/data/calibration-wk12.json')
  const lines = accuracyLines(report)
  assert.ok(lines.some(line => /Week 12/.test(line)))
  assert.ok(lines.some(line => /Anytime/.test(line)))
  assert.equal(accuracyLines({ lines: ['  ', 3, 'ok'] }).join(), 'ok')
  assert.deepEqual(accuracyLines(null), [])
  for (const stats of Object.values(report.adjustments.projection)) {
    for (const value of Object.values(stats)) assert.ok(value >= 0.9 && value <= 1.1)
  }
  for (const value of Object.values(report.adjustments.tdLambda)) assert.ok(value >= 0.9 && value <= 1.1)
  assert.ok(report.adjustments.coverageDamp >= 0.5 && report.adjustments.coverageDamp <= 1)
})
