import test from 'node:test'
import assert from 'node:assert/strict'
import { bookFrom } from '../src/props/roleEligibility.js'
import { FAVORITE_NOTE, FAVORITE_RULE, favoriteForTeam, skillYards } from '../src/props/favoritePosition.js'

const team = { id: '1', abbr: 'HM', name: 'Home Club' }
const book = bookFrom(
  [
    { name: 'Lead Back', primary: 'Early-down lead', injury: 'Questionable (Ankle)', glRole: 'primary', secondary: ['pass-catching'] },
    { name: 'Depth Back', primary: 'Depth / minimal', injury: '', glRole: 'none', secondary: [] },
    { name: 'Tied Alpha', primary: 'Early-down lead', injury: '', glRole: 'none', secondary: [] },
    { name: 'Tied Beta', primary: 'Change-of-pace', injury: '', glRole: 'none', secondary: [] },
  ],
  [
    { name: 'Lead Back', targetShare: 0.22, recentCarryShare: 0.61, inside5Share: 0.4 },
    { name: 'Depth Back', targetShare: 0.05, recentCarryShare: 0.08, inside5Share: null },
    { name: 'Tied Alpha', targetShare: 0.1, recentCarryShare: 0.2, inside5Share: null },
    { name: 'Tied Beta', targetShare: 0.3, recentCarryShare: 0.55, inside5Share: null },
  ],
  [
    { name: 'Star Wide', team: 'Home Club', rank: 'WR1' },
    { name: 'Fourth Wide', team: 'Home Club', rank: 'WR4' },
    { name: 'Slot Wide', team: 'Home Club', rank: 'WR2' },
    { name: 'Third Wide', team: 'Home Club', rank: 'WR3' },
    { name: 'Extra Wide', team: 'Home Club', rank: 'WR1' },
  ],
  { matched: true, week: 13 },
)

function player(id, name, position, { rush = null, rec = null, rushFactor = 1, recFactor = 1, unavailable = false } = {}) {
  const stat = (projection, factor) => ({ projection, defense: { factor } })
  return {
    id, name, position, unavailable, logs: [],
    stats: { rushYds: stat(rush, rushFactor), recYds: stat(rec, recFactor), passYds: stat(400, 1) },
  }
}

test('the note and rule name the yard-share comparison and the exclusions', () => {
  assert.match(FAVORITE_NOTE, /RB, WR, or TE/)
  assert.match(FAVORITE_NOTE, /projected rush plus receiving yards/)
  assert.match(FAVORITE_NOTE, /top three/)
  assert.match(FAVORITE_NOTE, /role gate/)
  assert.match(FAVORITE_RULE, /three recorded appearances/)
  assert.match(FAVORITE_RULE, /Receiver rush yards are included/)
  assert.match(FAVORITE_RULE, /carry share/)
  assert.match(FAVORITE_RULE, /not a probability/)
})

test('skill yards add the two projections and skip a missing side', () => {
  assert.equal(skillYards(player('a', 'A', 'RB', { rush: 40.5, rec: 12 })), 52.5)
  assert.equal(skillYards(player('b', 'B', 'WR', { rush: null, rec: 18.5 })), 18.5)
  assert.equal(skillYards(player('c', 'C', 'TE', { rush: null, rec: null })), null)
})

test('favorite position is the skill group with the most projected yards', () => {
  const result = favoriteForTeam(team, [
    player('qb', 'Passer', 'QB', { rush: 80, rec: 0 }),
    player('rb', 'Lead Back', 'RB', { rush: 40, rec: 15 }),
    player('wr', 'Star Wide', 'WR', { rec: 70 }),
    player('wr2', 'Slot Wide', 'WR', { rec: 20 }),
    player('te', 'Tight', 'TE', { rec: 30 }),
  ], book)
  assert.equal(result.position, 'WR')
  assert.equal(result.yards, 90)
  assert.equal(result.share, 90 / (55 + 90 + 30))
  assert.deepEqual(result.players.map(player => [player.rank, player.name, player.yards]), [
    [1, 'Star Wide', 70],
    [2, 'Slot Wide', 20],
  ])
  assert.equal(result.available, 2)
})

test('quarterback passing yards cannot win the group, and a fullback counts as RB', () => {
  const result = favoriteForTeam(team, [
    player('qb', 'Passer', 'QB', { rush: 90 }),
    player('fb', 'Full House', 'FB', { rush: 22, rec: 8 }),
    player('te', 'Tight', 'TE', { rec: 20 }),
  ], book)
  assert.equal(result.position, 'RB')
  assert.equal(result.players[0].name, 'Full House')
  assert.equal(result.players[0].rosterPosition, 'FB')
  assert.equal(result.players[0].yards, 30)
})

test('unavailable players and role-gated players are left out of the share and the list', () => {
  const result = favoriteForTeam(team, [
    player('out', 'Lead Back', 'RB', { rush: 100, unavailable: true }),
    player('depth', 'Depth Back', 'RB', { rush: 80 }),
    player('wr4', 'Fourth Wide', 'WR', { rec: 90 }),
    player('te', 'Tight', 'TE', { rec: 25 }),
    player('wr', 'Star Wide', 'WR', { rec: 10 }),
  ], book)
  assert.equal(result.position, 'TE')
  assert.equal(result.yards, 25)
  assert.equal(result.excluded.unavailable, 1)
  assert.equal(result.excluded.role, 2)
  assert.deepEqual(result.players.map(player => player.name), ['Tight'])
  assert.equal(result.groups.find(group => group.position === 'WR').yards, 10)
  assert.equal(result.groups.find(group => group.position === 'RB').yards, 0)
})

test('a questionable back stays listed and keeps the role-sheet flag', () => {
  const result = favoriteForTeam(team, [
    player('rb', 'Lead Back', 'RB', { rush: 48, rec: 6 }),
  ], book)
  assert.equal(result.position, 'RB')
  assert.equal(result.players[0].flag, 'Questionable (Ankle)')
  assert.equal(result.available, 1)
})

test('fewer than three players are returned without inventing names', () => {
  const result = favoriteForTeam(team, [
    player('te', 'Only Tight', 'TE', { rec: 40 }),
    player('te2', 'Zero Tight', 'TE', { rec: 0 }),
    player('wr', 'Star Wide', 'WR', { rec: null }),
  ], book)
  assert.equal(result.position, 'TE')
  assert.equal(result.available, 1)
  assert.equal(result.players.length, 1)
  assert.equal(result.players[0].name, 'Only Tight')
  assert.equal(result.excluded.noYards, 2)
})

test('at most three players are shown, ordered by yards', () => {
  const result = favoriteForTeam(team, [
    player('a', 'Star Wide', 'WR', { rec: 10 }),
    player('b', 'Slot Wide', 'WR', { rec: 40 }),
    player('c', 'Third Wide', 'WR', { rec: 25 }),
    player('d', 'Extra Wide', 'WR', { rec: 70 }),
  ], book)
  assert.deepEqual(result.players.map(player => player.name), ['Extra Wide', 'Slot Wide', 'Third Wide'])
  assert.equal(result.available, 4)
  assert.equal(result.players[0].positionShare, 70 / (10 + 40 + 25 + 70))
})

test('equal player yards break the tie with carry share, then target share, then name', () => {
  const result = favoriteForTeam(team, [
    player('a', 'Tied Alpha', 'RB', { rush: 20 }),
    player('b', 'Tied Beta', 'RB', { rush: 20 }),
  ], book)
  assert.deepEqual(result.players.map(player => player.name), ['Tied Beta', 'Tied Alpha'])
})

test('equal group yards break the tie with the opponent adjustment', () => {
  const softerRush = favoriteForTeam(team, [
    player('rb', 'Lead Back', 'RB', { rush: 30, rushFactor: 1.2 }),
    player('wr', 'Star Wide', 'WR', { rec: 30, recFactor: 0.9 }),
  ], book)
  const softerPass = favoriteForTeam(team, [
    player('rb', 'Lead Back', 'RB', { rush: 30, rushFactor: 0.9 }),
    player('wr', 'Star Wide', 'WR', { rec: 30, recFactor: 1.2 }),
  ], book)
  assert.equal(softerRush.position, 'RB')
  assert.equal(softerPass.position, 'WR')
})

test('a remaining group tie prefers RB, then WR, then TE', () => {
  const result = favoriteForTeam(team, [
    player('rb', 'Lead Back', 'RB', { rush: 20, rushFactor: 1 }),
    player('wr', 'Star Wide', 'WR', { rec: 20, recFactor: 1 }),
    player('te', 'Tight', 'TE', { rec: 20, recFactor: 1 }),
  ], book)
  assert.equal(result.position, 'RB')
})

test('a team with no usable skill yards does not get a fabricated position', () => {
  const result = favoriteForTeam(team, [
    player('qb', 'Passer', 'QB', { rush: 40 }),
    player('wr', 'Fourth Wide', 'WR', { rec: 50 }),
  ], book)
  assert.equal(result.position, null)
  assert.equal(result.players.length, 0)
  assert.match(result.reason, /No eligible skill player/)
})

test('a missing role sheet does not invent exclusions', () => {
  const unmatched = { matched: false, week: 99, rbByName: new Map(), wrByName: new Map() }
  const result = favoriteForTeam(team, [player('w4', 'Fourth Wide', 'WR', { rec: 33 })], unmatched)
  assert.equal(result.position, 'WR')
  assert.equal(result.players[0].name, 'Fourth Wide')
})

test('duplicate roster rows are counted once', () => {
  const result = favoriteForTeam(team, [
    player('1', 'Star Wide', 'WR', { rec: 40 }),
    player('1', 'Star Wide', 'WR', { rec: 40 }),
    player('2', 'Slot Wide', 'WR', { rec: 10 }),
  ], book)
  assert.equal(result.yards, 50)
  assert.equal(result.available, 2)
})
