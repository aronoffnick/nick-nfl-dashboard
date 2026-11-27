import assert from 'node:assert/strict'
import test from 'node:test'
import { formatMatchupHash, parseMatchupHash } from '../src/props/matchupTabs.js'

test('the dialog opens on Bets, and Stats opens on Scatter Plot', () => {
  assert.deepEqual(parseMatchupHash(''), { tab: 'bets', view: 'generator' })
  assert.deepEqual(parseMatchupHash('#stats'), { tab: 'stats', view: 'scatter' })
})

test('old tab names land on the Stats sub tabs', () => {
  assert.deepEqual(parseMatchupHash('#scatter'), { tab: 'stats', view: 'scatter' })
  assert.deepEqual(parseMatchupHash('#history'), { tab: 'stats', view: 'history' })
  assert.deepEqual(parseMatchupHash('#recent-opponents'), { tab: 'stats', view: 'history' })
  assert.deepEqual(parseMatchupHash('#stocks'), { tab: 'stats', view: 'stocks' })
  assert.deepEqual(parseMatchupHash('#stat-metrics'), { tab: 'stats', view: 'stocks' })
  assert.equal(formatMatchupHash('stats', 'history'), '#stats/history')
})

test('bet views stay under Bets', () => {
  assert.deepEqual(parseMatchupHash('#bets/flyers'), { tab: 'bets', view: 'flyers' })
  assert.deepEqual(parseMatchupHash('#touchdowns'), { tab: 'bets', view: 'touchdowns' })
  assert.deepEqual(parseMatchupHash('#breakout'), { tab: 'bets', view: 'generator' })
  assert.deepEqual(parseMatchupHash('#bets/breakout'), { tab: 'bets', view: 'generator' })
})
