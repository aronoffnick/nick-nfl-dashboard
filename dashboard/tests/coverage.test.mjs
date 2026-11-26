import assert from 'node:assert/strict'
import test from 'node:test'
import coverage from '../src/data/coverage-wk12.json' with { type: 'json' }

test('Packers coverage mix recovered from the Week 12 projections matches the chart', () => {
  const mix = coverage.games['GB-LAR'].offenses.LAR.mix
  const pct = key => Math.round(mix[key] * 100)
  assert.deepEqual(coverage.coverages.map(row => pct(row.key)), [5, 10, 1, 22, 25, 27, 10])
  const stafford = coverage.games['GB-LAR'].offenses.LAR.players.find(player => player.name === 'Matthew Stafford')
  assert.equal(stafford.proj, 15.01)
  assert.equal(stafford.pos, 'QB')
  const skill = coverage.games['GB-LAR'].offenses.LAR.players.filter(player => player.pos !== 'QB').reduce((sum, player) => sum + player.proj, 0)
  assert.ok(Math.abs(skill - 80.1) < 0.15)
})
