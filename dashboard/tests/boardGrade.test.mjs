import assert from 'node:assert/strict'
import test from 'node:test'
import { gradePick, preKickoffPick, usableSnapshot } from '../src/boardModel.js'
import { chooseGroup, coverProb } from '../src/teamParlayPick.js'

const team = (id, abbr) => ({ id, abbr, name: abbr, pass: 200, rush: 100, points: 20 })

test('a final is graded against the saved pre-kickoff winner', () => {
  const final = { away: { id: 'a', points: 17 }, home: { id: 'h', points: 24 } }
  assert.equal(gradePick({ winnerId: 'h', tie: false }, final), 'W')
  assert.equal(gradePick({ winnerId: 'a', tie: false }, final), 'L')
  assert.equal(gradePick({ winnerId: null, tie: true }, final), '–')
  assert.equal(usableSnapshot({ source: 'board', savedAt: '2026-11-27T20:00:00Z' }, { date: '2026-11-27T18:00:00Z' }), null)
})

test('the pre-kickoff pick ignores a game played after the kickoff', () => {
  const early = { id: '1', date: '2026-09-01T17:00:00Z', neutral: false, away: { ...team('a', 'AAA'), points: 10, pass: 100, rush: 80 }, home: { ...team('h', 'HHH'), points: 30, pass: 300, rush: 120 } }
  const late = { id: '2', date: '2026-11-20T17:00:00Z', neutral: false, away: { ...team('a', 'AAA'), points: 40, pass: 400, rush: 150 }, home: { ...team('h', 'HHH'), points: 3, pass: 50, rush: 40 } }
  const data = { week: 12, teams: { a: team('a', 'AAA'), h: team('h', 'HHH') }, games: [early, late] }
  const before = preKickoffPick(data, { id: 'm', date: '2026-11-01T17:00:00Z', away: 'a', home: 'h', neutral: false })
  const after = preKickoffPick(data, { id: 'm2', date: '2026-11-27T17:00:00Z', away: 'a', home: 'h', neutral: false })
  assert.notEqual(before.winnerId, after.winnerId)
})

test('a home dog covers more often when the model is a pickem', () => {
  assert.ok(coverProb(0, 3.5) > 0.5)
  assert.ok(coverProb(0, -3.5) < 0.5)
})

test('a parlay outside the odds range is dropped', () => {
  const pool = [
    { decimal: 1.5, prob: 0.7 },
    { decimal: 1.8, prob: 0.6 },
    { decimal: 3, prob: 0.4 },
  ]
  const inside = chooseGroup(pool, 2, 100, 250)
  assert.equal(inside.legs.length, 2)
  assert.equal(chooseGroup(pool, 2, 800, 900), null)
})
