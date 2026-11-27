import test from 'node:test'
import assert from 'node:assert/strict'
import { betSignalScore } from '../src/props/signals.js'

const game = recTD => ({ targets: 5, recYds: 20, rushTD: 0, recTD, carries: 0, passAtt: 0 })

test('TD signal is a season weighted rate, and the 3-vs-3 split stays a trend check', () => {
  const quiet = { position: 'WR', logs: Array.from({ length: 8 }, () => game(0)) }
  const oldScore = { position: 'WR', logs: [game(1), ...Array.from({ length: 7 }, () => game(0))] }
  const recent = { position: 'WR', logs: [...Array.from({ length: 7 }, () => game(0)), game(1)] }
  assert.equal(betSignalScore(quiet), 0)
  const early = betSignalScore(oldScore)
  const late = betSignalScore(recent)
  assert.ok(early > 0 && early < 0.1)
  assert.ok(late > 0.2 && late < 0.5)
  assert.ok(late > early)
})
