import assert from 'node:assert/strict'
import test from 'node:test'
import { applyScatter } from '../src/props/pipelineProjection.js'

test('a week file replaces the browser projection and a missing file leaves it', () => {
  const players = [{
    name: 'Jonah Coleman', position: 'RB',
    stats: { rushYds: { projection: 10 }, rec: { projection: 1 }, recYds: { projection: 4 }, totalTD: { projection: 0.2 } },
  }]
  assert.equal(applyScatter(players, [{ n: 'Jonah Coleman', p: 'RB', s: { rushYds: [40, 55.5, 1.1], td: [0.4, 0.8, 1] } }]), 1)
  assert.equal(players[0].stats.rushYds.projection, 55.5)
  assert.equal(players[0].stats.rushYds.pipeline, true)
  assert.equal(players[0].stats.totalTD.projection, 0.8)
  assert.equal(applyScatter(players, []), 0)
})
