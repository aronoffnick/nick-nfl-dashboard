import assert from 'node:assert/strict'
import test from 'node:test'
import {
  americanBounds,
  applyGameScript,
  buildCustomParlays,
  combinedAmerican,
  fairAmerican,
  filterPools,
  legValue,
  oddsDirection,
  outcomeCandidates,
  priceMatchesTarget,
  propCandidates,
  priceInRange,
  runningAmerican,
  seasonTdShare,
  validateCustomParlay,
} from '../src/props/customParlay.js'
import { mismatchRank } from '../src/props/tdScorers.js'
import { selectionFromChoices, scriptSummary } from '../src/props/gameScript.js'

const types = (outcome, td, prop) => ({ outcome, td, prop })

function leg(partial) {
  return {
    type: 'prop',
    confidence: 0.5,
    valueScore: 0,
    priced: false,
    kickoff: '2026-11-30T18:00:00Z',
    gameLabel: partial.gameId,
    title: partial.id,
    playerId: partial.playerId === undefined ? partial.id : partial.playerId,
    ...partial,
  }
}

test('blank legs per game is not a constraint', () => {
  const result = validateCustomParlay({ legs: '4', games: '2', legsPerGame: '   ', types: types(true, true, true) })
  assert.equal(result.ok, true)
  assert.equal(result.input.legsPerGame, null)
  assert.equal(result.note, null)
})

test('legs per game must multiply back to the leg count', () => {
  const result = validateCustomParlay({ legs: '4', games: '2', legsPerGame: '3', types: types(true, false, false) })
  assert.equal(result.ok, false)
  assert.match(result.message, /2 games × 3 legs per game is 6 legs, not 4/)
})

test('fewer legs than games cannot cover every game', () => {
  const result = validateCustomParlay({ legs: '2', games: '3', legsPerGame: '', types: types(true, true, false) })
  assert.equal(result.ok, false)
  assert.match(result.message, /2 legs cannot cover 3 games/)
})

test('a parlay needs at least one selected type', () => {
  const result = validateCustomParlay({ legs: '3', games: '2', legsPerGame: '', types: types(false, false, false) })
  assert.equal(result.ok, false)
  assert.match(result.message, /at least one/)
})

test('outcome-only parlays cannot put two outcomes on one game', () => {
  const result = validateCustomParlay({ legs: '3', games: '2', legsPerGame: '', types: types(true, false, false) })
  assert.equal(result.ok, false)
  assert.match(result.message, /one outcome pick/)
})

test('too few legs for every type is allowed and explained', () => {
  const result = validateCustomParlay({ legs: '2', games: '1', legsPerGame: '', types: types(true, true, true) })
  assert.equal(result.ok, true)
  assert.match(result.note, /cannot include all 3 types/)
})

test('season touchdown weight favors a more recent score', () => {
  const recent = seasonTdShare([{ rushTD: 0, recTD: 0 }, { rushTD: 0, recTD: 0 }, { rushTD: 0, recTD: 0 }, { rushTD: 1, recTD: 0 }], 1)
  const older = seasonTdShare([{ rushTD: 1, recTD: 0 }, { rushTD: 0, recTD: 0 }, { rushTD: 0, recTD: 0 }, { rushTD: 0, recTD: 0 }], 1)
  assert.ok(recent.rate > older.rate)
  assert.equal(recent.hits, 1)
  assert.equal(recent.n, 4)
})

test('props keep the higher hit chance and skip started games', () => {
  const file = {
    version: 2,
    games: {
      'BUF-KC': {
        legs: [
          { id: 'a:over', kind: 'prop', player: 'Player A', team: 'BUF', pos: 'WR', market: 'Receptions', side: 'Over', line: 4.5, p: 0.6, priced: false, card_label: 'Player A over' },
          { id: 'a:under', kind: 'prop', player: 'Player A', team: 'BUF', pos: 'WR', market: 'Receptions', side: 'Under', line: 4.5, p: 0.7, priced: true, price: 120, card_label: 'Player A under' },
          { id: 'b', kind: 'prop', player: 'Player B', team: 'KC', pos: 'WR', market: 'Receptions', side: 'Over', line: 5.5, p: 0.55, priced: false },
        ],
      },
    },
  }
  const matchups = [
    { id: 'g1', date: '2026-11-30T18:00:00Z', started: false, final: null, away: { abbr: 'BUF', name: 'Bills' }, home: { abbr: 'KC', name: 'Chiefs' } },
    { id: 'g2', date: '2026-11-27T01:00:00Z', started: true, final: null, away: { abbr: 'DAL' }, home: { abbr: 'PHI' } },
  ]
  const props = propCandidates(file, matchups)
  assert.deepEqual(props.map(item => item.id), ['prop:a:under', 'prop:b'])
  assert.ok(props[0].valueScore > 0.2)
  assert.equal(props[1].valueScore, 0)
})

test('a −500 price the model makes −220 is overvalued, and a +150 the model makes +110 is undervalued', () => {
  assert.equal(fairAmerican(0.6875), -220)
  assert.equal(fairAmerican(100 / 210), 110)
  const favorite = legValue(0.6875, -500)
  assert.equal(favorite.tag, 'overvalued')
  assert.equal(favorite.fair, -220)
  assert.equal(favorite.book, -500)
  assert.ok(favorite.ev < 0)
  const dog = legValue(100 / 210, 150)
  assert.equal(dog.tag, 'undervalued')
  assert.equal(dog.fair, 110)
  assert.equal(dog.book, 150)
  assert.ok(dog.ev > favorite.ev)
  assert.equal(legValue(0.6, null).tag, 'no-line')
  assert.equal(legValue(0.6, null).fair, -150)
})

test('confidence mode picks the higher hit chance and value mode ranks profit per dollar', () => {
  const pools = {
    prop: [
      leg({ id: 'a', gameId: 'A', confidence: 0.9, price: -500, priced: true }),
      leg({ id: 'b', gameId: 'B', confidence: 0.55, price: 200, priced: true }),
      leg({ id: 'c', gameId: 'C', confidence: 0.85, price: -150, priced: true }),
      leg({ id: 'blank', gameId: 'D', confidence: 0.99 }),
    ],
  }
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(false, false, true) }).input
  const byConfidence = buildCustomParlays(pools, input, { mode: 'confidence' }).parlays[0]
  const byValue = buildCustomParlays(pools, input, { mode: 'value' }).parlays[0]
  assert.deepEqual(byConfidence.legs.map(item => item.id).sort(), ['a', 'blank'])
  assert.deepEqual(byValue.legs.map(item => item.id).sort(), ['b', 'c'])
  assert.equal(byValue.legs.every(item => item.hasLine), true)
})

test('each checked type is included when the leg count allows', () => {
  const pools = {
    outcome: [leg({ id: 'o', type: 'outcome', gameId: 'A', playerId: null, confidence: 0.8 })],
    td: [leg({ id: 't', type: 'td', gameId: 'B', playerId: 'scorer', confidence: 0.4 })],
    prop: [
      leg({ id: 'p1', gameId: 'A', playerId: 'alpha', confidence: 0.95 }),
      leg({ id: 'p2', gameId: 'B', playerId: 'beta', confidence: 0.3 }),
    ],
  }
  const input = validateCustomParlay({ legs: '3', games: '2', legsPerGame: '', types: types(true, true, true) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.deepEqual(parlay.legs.map(item => item.type).sort(), ['outcome', 'prop', 'td'])
  assert.equal(parlay.games, 2)
})

test('the same player is not used twice', () => {
  const pools = {
    td: [leg({ id: 'td', type: 'td', gameId: 'A', playerId: 'sam', confidence: 0.5 })],
    prop: [
      leg({ id: 'same', gameId: 'A', playerId: 'sam', confidence: 0.9 }),
      leg({ id: 'other', gameId: 'B', playerId: 'other', confidence: 0.4 }),
    ],
  }
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(false, true, true) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.deepEqual(parlay.legs.map(item => item.id).sort(), ['other', 'td'])
})

test('a set legs-per-game count fills every game to that count', () => {
  const pools = {
    outcome: [
      leg({ id: 'oa', type: 'outcome', gameId: 'A', playerId: null, confidence: 0.7 }),
      leg({ id: 'ob', type: 'outcome', gameId: 'B', playerId: null, confidence: 0.66 }),
    ],
    td: [
      leg({ id: 'ta', type: 'td', gameId: 'A', playerId: 'a', confidence: 0.6 }),
      leg({ id: 'tb', type: 'td', gameId: 'B', playerId: 'b', confidence: 0.55 }),
    ],
    prop: [],
  }
  const input = validateCustomParlay({ legs: '4', games: '2', legsPerGame: '2', types: types(true, true, false) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.equal(parlay.legs.length, 4)
  for (const gameId of ['A', 'B']) assert.equal(parlay.legs.filter(item => item.gameId === gameId).length, 2)
})

test('without legs per game, legs can split unevenly and still use every game', () => {
  const pools = {
    prop: [
      leg({ id: 'a1', gameId: 'A', playerId: 'a1', confidence: 0.9 }),
      leg({ id: 'a2', gameId: 'A', playerId: 'a2', confidence: 0.8 }),
      leg({ id: 'a3', gameId: 'A', playerId: 'a3', confidence: 0.7 }),
      leg({ id: 'b1', gameId: 'B', playerId: 'b1', confidence: 0.2 }),
    ],
  }
  const input = validateCustomParlay({ legs: '3', games: '2', legsPerGame: '', types: types(false, false, true) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.deepEqual(parlay.legs.map(item => item.id).sort(), ['a1', 'a2', 'b1'])
  assert.equal(parlay.games, 2)
})

test('required types move onto an empty game instead of stacking', () => {
  const pools = {
    outcome: [
      leg({ id: 'oa', type: 'outcome', gameId: 'A', playerId: null, confidence: 0.8 }),
      leg({ id: 'ob', type: 'outcome', gameId: 'B', playerId: null, confidence: 0.55 }),
    ],
    td: [
      leg({ id: 'ta', type: 'td', gameId: 'A', playerId: 'a', confidence: 0.7 }),
      leg({ id: 'tb', type: 'td', gameId: 'B', playerId: 'b', confidence: 0.45 }),
    ],
  }
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(true, true, false) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.equal(new Set(parlay.legs.map(item => item.gameId)).size, 2)
  assert.deepEqual(parlay.legs.map(item => item.type).sort(), ['outcome', 'td'])
})

test('next best is a different mix', () => {
  const pools = {
    prop: [
      leg({ id: 'a', gameId: 'A', confidence: 0.9 }),
      leg({ id: 'b', gameId: 'B', confidence: 0.8 }),
      leg({ id: 'c', gameId: 'C', confidence: 0.7 }),
    ],
  }
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(false, false, true) }).input
  const { parlays } = buildCustomParlays(pools, input)
  assert.ok(parlays.length >= 2)
  assert.notEqual(parlays[0].id, parlays[1].id)
  assert.ok(parlays[0].combined >= parlays[1].combined)
})

test('one team keeps only that side, including an outcome the model does not prefer', () => {
  const pools = {
    outcome: [
      leg({ id: 'home', type: 'outcome', gameId: 'g', team: 'KC', playerId: null, confidence: 0.7 }),
      leg({ id: 'away', type: 'outcome', gameId: 'g2', team: 'BUF', playerId: null, confidence: 0.4 }),
    ],
    td: [leg({ id: 'td', type: 'td', gameId: 'g', team: 'KC', playerId: 'chief', confidence: 0.3 })],
    prop: [leg({ id: 'prop', gameId: 'g', team: 'BUF', playerId: 'bill', confidence: 0.8 })],
  }
  const filtered = filterPools(pools, 'KC')
  assert.deepEqual(filtered.outcome.map(item => item.id), ['home'])
  assert.deepEqual(filtered.td.map(item => item.id), ['td'])
  assert.equal(filtered.prop.length, 0)
})

test('predicted outcome and flow write one game script', () => {
  const selection = selectionFromChoices('big:home', 'rush:away', { awayId: 'a', homeId: 'h' })
  assert.equal(selection.win, 'h')
  assert.equal(selection.margin, 'big')
  assert.equal(selection.rush, 'a')
  assert.equal(scriptSummary(selection, {
    away: { id: 'a', abbr: 'BUF' },
    home: { id: 'h', abbr: 'KC' },
  }), 'KC wins big · BUF rushing success')
})

test('a script arrow outranks a slightly higher raw prop when the side agrees', () => {
  const pools = applyGameScript({
    prop: [
      leg({ id: 'plain', gameId: 'g', playerId: 'other', confidence: 0.62, market: 'Rush yds', side: 'Over' }),
      leg({ id: 'scripted', gameId: 'g', playerId: 'lead back', confidence: 0.55, market: 'Rush yds', side: 'Over' }),
    ],
  }, {
    matchup: { id: 'g', away: { id: 'a', abbr: 'BUF' }, home: { id: 'h', abbr: 'KC' } },
    selection: { win: 'h', margin: 'big' },
    props: [{ name: 'Lead Back', key: 'rushYds', pct: 0.16, direction: 'over', arrow: 'up', why: 'Lead raises the rush.' }],
  })
  const input = validateCustomParlay({ legs: '1', games: '1', legsPerGame: '', types: types(false, false, true) }).input
  const parlay = buildCustomParlays(pools, input).parlays[0]
  assert.equal(parlay.legs[0].id, 'scripted')
  assert.equal(parlay.legs[0].arrow, 'up')
})

test('the default home settings still build a parlay when touchdowns are not ready', () => {
  const input = validateCustomParlay({
    legs: '4', games: '2', legsPerGame: '',
    types: { outcome: true, td: true, prop: true },
  }).input
  const pools = {
    outcome: [
      leg({ id: 'o1', type: 'outcome', gameId: 'A', playerId: null, confidence: 0.62, price: -110, priced: true }),
      leg({ id: 'o2', type: 'outcome', gameId: 'B', playerId: null, confidence: 0.58, price: -120, priced: true }),
    ],
    td: [],
    prop: [
      leg({ id: 'p1', gameId: 'A', playerId: 'a', confidence: 0.7 }),
      leg({ id: 'p2', gameId: 'B', playerId: 'b', confidence: 0.66 }),
      leg({ id: 'p3', gameId: 'A', playerId: 'c', confidence: 0.6 }),
      leg({ id: 'p4', gameId: 'B', playerId: 'd', confidence: 0.55 }),
    ],
  }
  const result = buildCustomParlays(pools, input)
  assert.ok(result.parlays.length >= 1)
  assert.equal(result.parlays[0].legs.length, 4)
  assert.equal(result.parlays[0].games, 2)
  assert.ok(result.skipped.includes('td'))
  assert.match(result.note, /Uncheck Touchdown scorers/)
})

test('blank American odds are optional and a real range keeps the priced leg inside it', () => {
  assert.deepEqual(americanBounds('', ''), { ok: true, range: null })
  assert.equal(americanBounds('50', '').ok, false)
  const pools = {
    prop: [
      leg({ id: 'short', gameId: 'A', playerId: 'a', confidence: 0.9, price: -110, priced: true }),
      leg({ id: 'long', gameId: 'B', playerId: 'b', confidence: 0.4, price: 250, priced: true }),
      leg({ id: 'open', gameId: 'C', playerId: 'c', confidence: 0.95 }),
    ],
  }
  const input = validateCustomParlay({ legs: '1', games: '1', legsPerGame: '', types: types(false, false, true) }).input
  const open = buildCustomParlays(pools, input)
  assert.equal(open.parlays[0].id, 'open')
  assert.equal(combinedAmerican(open.parlays.find(item => item.id === 'long').legs).text, '+250')
  const ranged = buildCustomParlays(pools, input, { oddsRange: americanBounds('+400', '+200').range })
  assert.deepEqual(ranged.parlays.map(item => item.id), ['long'])
  assert.equal(ranged.parlays[0].priceText, '+250')
  assert.equal(priceInRange({ number: 250 }, { min: 400, max: 200 }), true)
})

test('outcome candidates use the model pick and skip games that already started', () => {
  const matchups = [
    {
      id: 'live',
      date: '2026-11-30T18:00:00Z',
      started: false,
      final: null,
      margin: 3,
      winner: { id: 'h' },
      awayPoints: 20,
      homePoints: 23,
      away: { id: 'a', abbr: 'BUF', name: 'Bills', logo: 'buf.png' },
      home: { id: 'h', abbr: 'KC', name: 'Chiefs', logo: 'kc.png' },
    },
    {
      id: 'done',
      date: '2026-11-27T01:00:00Z',
      started: true,
      final: null,
      margin: 7,
      winner: { id: 'h2' },
      awayPoints: 17,
      homePoints: 24,
      away: { id: 'a2', abbr: 'DAL', name: 'Cowboys' },
      home: { id: 'h2', abbr: 'PHI', name: 'Eagles' },
    },
  ]
  const odds = {
    games: {
      'BUF-KC': {
        moneyline: { BUF: { price: -160, book: 'DraftKings' }, KC: { price: 140, book: 'DraftKings' } },
        source: 'test',
      },
      'DAL-PHI': {
        moneyline: { DAL: { price: 200, book: 'DraftKings' }, PHI: { price: 130, book: 'DraftKings' } },
        source: 'test',
      },
    },
  }
  const outcomes = outcomeCandidates(matchups, odds)
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].gameId, 'live')
  assert.equal(outcomes[0].type, 'outcome')
  assert.ok(outcomes[0].confidence > 0.5)
  assert.ok(outcomes[0].valueScore > 0)
})

test('optimize for value still includes a touchdown leg that has no book line', () => {
  const pools = {
    outcome: [
      leg({ id: 'o1', type: 'outcome', gameId: 'A', playerId: null, confidence: 0.62, price: -110, priced: true }),
      leg({ id: 'o2', type: 'outcome', gameId: 'B', playerId: null, confidence: 0.58, price: -120, priced: true }),
    ],
    td: [
      leg({ id: 'td-a', type: 'td', gameId: 'A', playerId: 'scorer-a', confidence: 0.48 }),
      leg({ id: 'td-b', type: 'td', gameId: 'B', playerId: 'scorer-b', confidence: 0.41 }),
    ],
    prop: [
      leg({ id: 'p1', gameId: 'A', playerId: 'a', confidence: 0.7, price: 150, priced: true }),
      leg({ id: 'p2', gameId: 'B', playerId: 'b', confidence: 0.66, price: 180, priced: true }),
      leg({ id: 'p3', gameId: 'A', playerId: 'c', confidence: 0.6, price: -110, priced: true }),
      leg({ id: 'p4', gameId: 'B', playerId: 'd', confidence: 0.55, price: -130, priced: true }),
    ],
  }
  const input = validateCustomParlay({ legs: '4', games: '2', legsPerGame: '', types: types(true, true, true) }).input
  const parlay = buildCustomParlays(pools, input, { mode: 'value', prioritizeMismatch: true }).parlays[0]
  assert.equal(parlay.legs.some(item => item.type === 'td'), true)
})

test('a likely touchdown mismatch ranks ahead of a longer-shot mismatch', () => {
  const likely = leg({ id: 'likely', type: 'td', gameId: 'A', playerId: 'star', confidence: 0.52, price: 180, priced: true })
  const long = leg({ id: 'long', type: 'td', gameId: 'A', playerId: 'sleeper', confidence: 0.22, price: 500, priced: true })
  const prop = leg({ id: 'prop', type: 'prop', gameId: 'B', playerId: 'other', confidence: 0.45, price: -110, priced: true })
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(false, true, true) }).input
  const parlay = buildCustomParlays({ td: [likely, long], prop: [prop] }, input, { mode: 'value', prioritizeMismatch: true }).parlays[0]
  assert.equal(parlay.legs[0].id === 'likely' || parlay.legs.some(item => item.id === 'likely'), true)
  assert.ok(mismatchRank(parlay.legs.find(item => item.id === 'likely')) > mismatchRank(parlay.legs.find(item => item.id === 'long') || { mismatch: null }))
  assert.equal(parlay.legs.find(item => item.id === 'likely').mismatch.likely, true)
  assert.equal(parlay.legs.map(item => item.id).includes('long'), false)
})

test('a target odds slot keeps the closest priced leg and a miss falls back', () => {
  assert.equal(priceMatchesTarget(180, 200, 1), true)
  assert.equal(priceMatchesTarget(280, 200, 1), false)
  assert.equal(priceMatchesTarget(280, 200, 4), true)
  const pools = {
    prop: [
      leg({ id: 'short', gameId: 'A', playerId: 'a', confidence: 0.8, price: -110, priced: true }),
      leg({ id: 'near', gameId: 'B', playerId: 'b', confidence: 0.42, price: 180, priced: true }),
      leg({ id: 'far', gameId: 'B', playerId: 'c', confidence: 0.7, price: 400, priced: true }),
    ],
  }
  const input = validateCustomParlay({ legs: '2', games: '2', legsPerGame: '', types: types(false, false, true) }).input
  const matched = buildCustomParlays(pools, input, { targets: [200, null] }).parlays[0]
  assert.ok(matched.legs.some(item => item.id === 'near' && item.targetMet))
  assert.equal(matched.legs.some(item => item.id === 'far'), false)
  const missed = buildCustomParlays(pools, input, { targets: [5000, null] }).parlays[0]
  const fallback = missed.legs.find(item => item.targetFallback)
  assert.ok(fallback)
  assert.equal(fallback.targetOdds, 5000)
  const book = runningAmerican(matched.legs, 'price')
  const fair = runningAmerican(matched.legs, 'fairLine')
  assert.ok(book?.text)
  assert.ok(fair?.text)
  assert.equal(oddsDirection(150, 420), 'up')
  assert.equal(oddsDirection(420, 150), 'down')
})
