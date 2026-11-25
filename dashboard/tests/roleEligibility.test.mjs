import assert from 'node:assert/strict'
import test from 'node:test'
import rbRows from '../src/props/rb-starters-week12.json' with { type: 'json' }
import wrRows from '../src/props/wr-starters-week12.json' with { type: 'json' }
import { findRb, findWr, injuryInfo, roleDecision, rushWeight, tdWeight } from '../src/props/roleEligibility.js'

const gb = name => ({ name, position: 'RB', team: { name: 'Green Bay Packers' } })

test('Kaleb Johnson is out of RB receiving themes', () => {
  const decision = roleDecision(gb('Kaleb Johnson'), { statKey: 'recYds' })
  assert.equal(decision.eligible, false)
  assert.match(decision.reason, /25%/)
  assert.equal(roleDecision(gb('Kaleb Johnson'), { statKey: 'rec' }).eligible, false)
  assert.equal(roleDecision(gb('Kaleb Johnson')).eligible, true)
})

test('MarShawn Lloyd is the eligible GB receiving back', () => {
  assert.equal(roleDecision(gb('MarShawn Lloyd'), { statKey: 'recYds' }).eligible, true)
  assert.equal(roleDecision(gb('Kaleb Johnson'), { statKey: 'recYds' }).eligible, false)
  assert.equal(findRb('MarShawn Lloyd').targetShare, 0.37)
})

test('Josh Jacobs stays in and is flagged Questionable (Finger)', () => {
  const decision = roleDecision(gb('Josh Jacobs'), { statKey: 'rushYds' })
  assert.equal(decision.eligible, true)
  assert.equal(decision.flag, 'Questionable (Finger)')
  assert.equal(roleDecision(gb('Josh Jacobs'), { statKey: 'recYds' }).eligible, false)
})

test('Out and depth backs are excluded; Doubtful counts as out', () => {
  assert.equal(injuryInfo('Doubtful (Knee)').state, 'out')
  const out = rbRows.find(row => /^Out\b/i.test(row.injury || ''))
  const depth = rbRows.find(row => /depth|minimal/i.test(row.primary || ''))
  assert.equal(roleDecision({ name: out.name, position: 'RB' }).eligible, false)
  assert.equal(roleDecision({ name: depth.name, position: 'RB' }).eligible, false)
  assert.match(roleDecision({ name: depth.name, position: 'RB' }).reason, /minimal/i)
})

test('rush and touchdown weights follow the documented clamps', () => {
  const jacobs = findRb('Josh Jacobs')
  const kyren = findRb('Kyren Williams')
  assert.equal(rushWeight(jacobs), 0.74)
  assert.equal(rushWeight(findRb('MarShawn Lloyd')), 0.4)
  assert.ok(tdWeight(kyren) > tdWeight(jacobs))
  assert.equal(Number(tdWeight(kyren).toFixed(4)), 1.5625)
})

test('a WR must be WR1, WR2, or WR3 on his current team', () => {
  assert.equal(findWr('Christian Watson', 'Green Bay Packers').rank, 'WR2')
  assert.equal(roleDecision({ name: 'Matthew Golden', position: 'WR', team: { name: 'Green Bay Packers' } }).eligible, true)
  const missing = roleDecision({ name: 'Puka Nacua', position: 'WR', team: { name: 'Los Angeles Rams' } })
  assert.equal(missing.eligible, false)
  assert.equal(missing.note, 'No role')
  assert.equal(roleDecision({ name: 'Christian Watson', position: 'WR', team: { name: 'Los Angeles Rams' } }).eligible, false)
})

test('suffixes do not block a sheet match, and quarterbacks are unchanged', () => {
  const suffixed = wrRows.find(row => /\b(jr|sr|ii|iii|iv)\b/i.test(row.name))
  const stripped = suffixed.name.replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, '')
  assert.equal(roleDecision({ name: stripped, position: 'WR', team: { name: suffixed.team } }).eligible, true)
  assert.equal(roleDecision({ name: 'Jordan Love', position: 'QB', team: { name: 'Green Bay Packers' } }).eligible, true)
})
