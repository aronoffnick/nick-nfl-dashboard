import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLYER_MIN_HIT_RATE,
  FLYER_RATE_EMPTY,
  FLYER_SIMILARITY_EMPTY,
  MIN_SIMILARITY,
  flyerRemovalCounts,
  flyersEmptyNote,
  hitRateMeetsFlyerFloor,
  qualifyClosest,
  selectFlyerRows,
  similarityMeetsFloor,
} from '../src/props/flyersView.js'

const theme = (id, position, candidates = [{id: 'p'}]) => ({
  tier: 'Breakout',
  position,
  offense: {id},
  defense: {id: `d-${id}`},
  spec: {key: 'recYds', title: 'Receiving yards'},
  candidates,
})
const row = (id, rate, similarity, candidates) => ({
  theme: theme(id, 'WR', candidates),
  view: {rate, hits: 2, n: 6, closest: similarity == null ? null : {name: 'Player', similarity}},
})

test('Flyers display keeps a 30% hit rate and hides anything under it', () => {
  assert.equal(FLYER_MIN_HIT_RATE, 0.3)
  assert.equal(hitRateMeetsFlyerFloor(0.3), true)
  assert.equal(hitRateMeetsFlyerFloor(0.299), false)
  assert.equal(hitRateMeetsFlyerFloor(null), false)
  const rows = [row('low', 0.29, 0.9), row('edge', 0.3, 0.8), row('high', 0.62, 0.7)]
  const snapshot = JSON.parse(JSON.stringify(rows))
  const selected = selectFlyerRows(rows)
  assert.deepEqual(selected.shown.map(item => item.theme.offense.id), ['edge', 'high'])
  assert.deepEqual(rows, snapshot)
  assert.equal(flyerRemovalCounts(rows).removedForHitRate, 1)
  assert.equal(flyerRemovalCounts(rows).shown, 2)
})

test('a closest role match under 51% is dropped and an exact 51% match stays', () => {
  assert.equal(MIN_SIMILARITY, 0.51)
  assert.equal(similarityMeetsFloor(0.51), true)
  assert.equal(similarityMeetsFloor(0.509), false)
  const keeper = {name: 'Keeper', similarity: 0.51}
  const weak = {name: 'Weak', similarity: 0.5}
  assert.equal(qualifyClosest(keeper), keeper)
  assert.equal(qualifyClosest(weak), null)
  assert.equal(qualifyClosest(null), null)
  const rows = [row('weak', 0.44, 0.5), row('exact', 0.44, 0.51), row('open', 0.4, null, [])]
  const selected = selectFlyerRows(rows)
  assert.deepEqual(selected.shown.map(item => item.theme.offense.id), ['exact', 'open'])
  const counts = flyerRemovalCounts(rows)
  assert.equal(counts.removedForSimilarity, 1)
  assert.equal(counts.removedForHitRate, 0)
  assert.equal(counts.removed, 1)
})

test('an empty Flyers board says when the matchup has no 30% theme', () => {
  const rows = [row('low', 0.22, 0.9), row('lower', 0.1, 0.2)]
  const {shown, scoped} = selectFlyerRows(rows)
  assert.equal(shown.length, 0)
  assert.equal(flyersEmptyNote({shown, matchupRows: rows, scoped, teamFilter: 'all', positionFilter: 'all'}), FLYER_RATE_EMPTY)
  assert.equal(FLYER_RATE_EMPTY, 'No themes at 30%+ for this matchup')
})

test('30% themes with no 51% match use the similarity note instead of the hit-rate note', () => {
  const rows = [row('weak', 0.48, 0.4), row('also', 0.33, 0.2)]
  const {shown, scoped} = selectFlyerRows(rows)
  assert.equal(flyersEmptyNote({shown, matchupRows: rows, scoped, teamFilter: 'all', positionFilter: 'all'}), FLYER_SIMILARITY_EMPTY)
  assert.equal(FLYER_SIMILARITY_EMPTY, 'No close role match (51%+)')
})

test('team and position filters still empty on their own when a 30% theme exists', () => {
  const rows = [row('A', 0.55, 0.8), row('B', 0.2, 0.9)]
  const selected = selectFlyerRows(rows, {teamFilter: 'B', positionFilter: 'all'})
  assert.equal(selected.shown.length, 0)
  assert.equal(flyersEmptyNote({
    shown: selected.shown,
    matchupRows: rows,
    scoped: selected.scoped,
    teamFilter: 'B',
    positionFilter: 'all',
  }), 'No themes match these filters.')
  const byPosition = selectFlyerRows(rows, {teamFilter: 'all', positionFilter: 'RB'})
  assert.equal(byPosition.shown.length, 0)
  assert.equal(flyersEmptyNote({
    shown: byPosition.shown,
    matchupRows: rows,
    scoped: byPosition.scoped,
    teamFilter: 'all',
    positionFilter: 'RB',
  }), 'No themes match these filters.')
})
