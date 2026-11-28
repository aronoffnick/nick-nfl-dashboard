import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HIGH_CONFIDENCE_MIN,
  MISMATCH_BIG_EDGE,
  MISMATCH_MIN_EDGE,
  MISMATCH_MIN_RATIO,
  buildTdScorers,
  classifyMismatch,
  collectTdPrices,
  filterTdAxis,
  preferBook,
} from '../src/props/tdScorers.js'

const book = { matched: false, rbByName: new Map(), wrByName: new Map() }

function player(id, name, position, rushTD, recTD, targets, carries) {
  return { id, name, position, rushTD, recTD, targets, carries, passYds: 0, passTD: 0, passAtt: 0, rushYds: 0, rec: 0, recYds: 0 }
}

function game(id, date, away, home) {
  return { id, date, away, home }
}

function side(id, abbr, name, players) {
  return { id, abbr, name, logo: null, playerBox: { players, available: ['passing', 'rushing', 'receiving'] } }
}

test('mismatch needs both the edge and the ratio, and a likely scorer is the top tier', () => {
  assert.equal(MISMATCH_MIN_EDGE, 0.05)
  assert.equal(MISMATCH_MIN_RATIO, 1.25)
  assert.equal(MISMATCH_BIG_EDGE, 0.1)
  assert.equal(HIGH_CONFIDENCE_MIN, 0.4)
  const tight = classifyMismatch(0.55, -110, -110)
  assert.equal(tight, null)
  const big = classifyMismatch(0.3, 400)
  assert.equal(big.big, true)
  assert.equal(big.likely, false)
  const both = classifyMismatch(0.7, 150)
  assert.equal(both.likely, true)
  assert.ok(both.edge >= MISMATCH_MIN_EDGE)
  assert.ok(both.ratio >= MISMATCH_MIN_RATIO)
  assert.equal(classifyMismatch(0.25, 350), null)
})

test('DraftKings beats FanDuel, and FanDuel beats any other book', () => {
  assert.equal(preferBook([{ price: 300, book: 'Polymarket' }, { price: 280, book: 'FanDuel' }, { price: 250, book: 'DraftKings' }]).book, 'DraftKings')
  assert.equal(preferBook([{ price: 300, book: 'Polymarket' }, { price: 280, book: 'FanDuel' }]).book, 'FanDuel')
  const prices = collectTdPrices({
    games: [{ sides: [{ rows: [{ confident: { player: 'Star Tight', prop: 'Anytime TD', price: 450, book: 'FanDuel' }, relativelySafe: null, upside: [] }] }] }],
  }, {
    games: { g: { legs: [{ kind: 'td', player: 'Star Tight', price: -140, book: 'DraftKings' }] } },
  })
  assert.equal(prices.get('star tight').book, 'DraftKings')
  assert.equal(prices.get('star tight').price, -140)
})

test('confidence and value axes pick different touchdown scorers', () => {
  const opp = (id, te) => side('opp', 'OPP', 'Opponents', [
    player(`${id}-te`, 'Some Tight', 'TE', 0, te, 6, 0),
    player(`${id}-rb`, 'Some Back', 'RB', 1, 0, 2, 14),
  ])
  const offenseLog = (id, starTd, backupTd) => side('off', 'OFF', 'Offense', [
    player('star', 'Star Tight', 'TE', 0, starTd, 8, 0),
    player('backup', 'Backup Tight', 'TE', 0, backupTd, 3, 0),
    player('rb1', 'Lead Back', 'RB', 1, 0, 1, 18),
    player('rb2', 'Second Back', 'RB', 0, 0, 1, 4),
  ])
  const games = [1, 2, 3, 4].flatMap(n => ([
    game(`d${n}`, `2026-09-0${n}T17:00:00Z`, side('def', 'DEF', 'Defense', []), opp(`d${n}`, 1)),
    game(`o${n}`, `2026-09-1${n}T17:00:00Z`, offenseLog(`o${n}`, n === 4 ? 0 : 1, n === 4 ? 1 : 0), side('other', 'OTH', 'Other', [])),
  ]))
  const data = { games }
  const matchup = {
    id: 'live',
    date: '2026-11-30T18:00:00Z',
    started: false,
    final: null,
    away: { id: 'off', abbr: 'OFF', name: 'Offense', logo: null },
    home: { id: 'def', abbr: 'DEF', name: 'Defense', logo: null },
  }
  const prices = new Map([
    ['star tight', { price: 180, book: 'DraftKings' }],
    ['backup tight', { price: 450, book: 'FanDuel' }],
  ])
  const legs = buildTdScorers({ data, matchups: [matchup], halfLife: 3, book, prices })
  const star = legs.find(leg => leg.playerName === 'Star Tight')
  const backup = legs.find(leg => leg.playerName === 'Backup Tight')
  assert.ok(star, 'lead tight end is a candidate')
  assert.ok(backup, 'backup tight end is a candidate')
  assert.ok(star.confidence > backup.confidence)
  assert.ok(star.confidence >= HIGH_CONFIDENCE_MIN)
  assert.equal(star.axis === 'confidence' || star.axis === 'both', true)
  assert.equal(backup.axis === 'value' || backup.axis === 'both', true)
  assert.equal(backup.book, 'FanDuel')
  const confidence = filterTdAxis(legs, 'confidence').map(leg => leg.playerName)
  const value = filterTdAxis(legs, 'value').map(leg => leg.playerName)
  assert.ok(confidence.includes('Star Tight'))
  assert.equal(confidence.includes('Backup Tight'), false)
  assert.ok(value.includes('Backup Tight'))
  assert.equal(filterTdAxis(legs, 'mix').length >= 2, true)
})
