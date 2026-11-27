import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = name => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url)))

test('stocks keep a four-game floor and football-term tooltips', () => {
  const data = read('stocks-wk13.json')
  assert.ok(data.players.length > 0)
  assert.ok(data.players.every(player => player.games >= 4))
  assert.ok(data.players.some(player => player.position === 'QB' && player.qbCorrelation == null))
  for (const pos of ['QB', 'RB', 'WR', 'TE']) assert.ok(data.positions.includes(pos))
  assert.match(data.tooltips.sharpe, /week-to-week swing/)
  assert.match(data.tooltips.upsideCapture, /good script/)
  assert.match(data.tooltips.beta, /points his team scores/)
})

test('momentum multiples stay inside the caps and the holdout is flagged', () => {
  const data = read('momentum-wk13.json')
  for (const player of data.players) {
    assert.ok(player.momentumMultiple >= 0.95 && player.momentumMultiple <= 1.05)
    assert.ok(player.defenseMultiple >= 0.95 && player.defenseMultiple <= 1.05)
    assert.ok(player.netMultiple >= 0.92 && player.netMultiple <= 1.08)
  }
  for (const row of Object.values(data.backtest)) assert.equal(row.helps, false)
})
