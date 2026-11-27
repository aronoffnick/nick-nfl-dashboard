import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  KELLY_DOTS, americanImplied, compareValue, gradeDisplayedPick, gradeValuePick,
  mergeOdds, scoreGame, scoreMatchups, strengthDots,
} from '../src/matchupValue.js'

const team = (id, abbr) => ({ id, abbr, name: abbr })

function game(overrides = {}) {
  const away = team('a', 'AAA')
  const home = team('h', 'HHH')
  return {
    id: 'g',
    away, home,
    awayPoints: 20,
    homePoints: 23,
    margin: 3,
    winner: home,
    ...overrides,
  }
}

const coinFlip = {
  moneyline: { AAA: { price: -110, book: 'DraftKings' }, HHH: { price: -110, book: 'DraftKings' } },
  spread: {
    homeLine: -3, awayLine: 3,
    AAA: { line: 3, price: -110, book: 'DraftKings' },
    HHH: { line: -3, price: -110, book: 'DraftKings' },
  },
  source: 'ESPN scoreboard odds',
  book: 'DraftKings',
  asOf: 'Nov 27, 2:23 PM ET',
}

test('strength dots follow the Kelly bands', () => {
  assert.deepEqual(KELLY_DOTS.map(band => band.min), [0.2, 0.1, 0.03])
  assert.equal(strengthDots(0.0299), 0)
  assert.equal(strengthDots(0.03), 1)
  assert.equal(strengthDots(0.0999), 1)
  assert.equal(strengthDots(0.1), 2)
  assert.equal(strengthDots(0.1999), 2)
  assert.equal(strengthDots(0.2), 3)
  assert.equal(strengthDots(Number.NaN), 0)
})

test('a price inside the juice is not shown', () => {
  const scored = scoreGame(game({ margin: 0.5, homePoints: 20.5, awayPoints: 20 }), {
    ...coinFlip,
    spread: {
      homeLine: -0.5, awayLine: 0.5,
      AAA: { line: 0.5, price: -110 },
      HHH: { line: -0.5, price: -110 },
    },
  })
  assert.equal(scored.noLine, false)
  assert.equal(scored.show, false)
  assert.equal(scored.market, null)
  assert.ok(scored.ml)
  assert.ok(scored.ats)
  assert.ok(scored.rankScore < 0.02)
})

test('the card keeps the market with the higher Kelly fraction', () => {
  const scored = scoreGame(game({ margin: 7, awayPoints: 17, homePoints: 24, winner: team('h', 'HHH') }), {
    ...coinFlip,
    spread: {
      homeLine: 3, awayLine: -3,
      AAA: { line: -3, price: -110 },
      HHH: { line: 3, price: -110 },
    },
  })
  assert.equal(scored.show, true)
  assert.equal(scored.market, 'ATS')
  assert.equal(scored.abbr, 'HHH')
  assert.ok(scored.ats.kelly > scored.ml.kelly)
  assert.ok(scored.dots >= 1)
  assert.equal(scored.rankScore, scored.ats.kelly)
})

test('a one-sided price is not invented, and a game with no prices is no line', () => {
  const oneSided = scoreGame(game(), { moneyline: { AAA: { price: 150 } }, spread: null })
  assert.equal(oneSided.noLine, true)
  assert.equal(oneSided.ml, null)
  const blank = scoreGame(game(), null)
  assert.equal(blank.noLine, true)
  assert.equal(blank.rankScore, null)
})

test('no-vig fair prices on a pickem sum to one', () => {
  const away = americanImplied(-110)
  const home = americanImplied(-110)
  assert.ok(Math.abs(away / (away + home) - 0.5) < 1e-12)
})

test('missing lines sort last in either direction', () => {
  const high = { rankScore: 0.09 }
  const low = { rankScore: -0.01 }
  const none = { rankScore: null }
  assert.ok(compareValue(high, low, false) < 0)
  assert.ok(compareValue(low, high, true) < 0)
  assert.ok(compareValue(high, none, false) < 0)
  assert.ok(compareValue(none, high, true) > 0)
})

test('the displayed pick is graded straight up, and best value follows its own line', () => {
  const final = { away: { id: 'a', points: 27 }, home: { id: 'h', points: 20 } }
  const won = game({ final, winner: team('a', 'AAA'), margin: 4, awayPoints: 24, homePoints: 20 })
  const lost = game({ final, winner: team('h', 'HHH'), margin: 4 })
  assert.equal(gradeDisplayedPick(won), 'win')
  assert.equal(gradeDisplayedPick(lost), 'loss')
  assert.equal(gradeDisplayedPick(game({ final, margin: 0, winner: team('h', 'HHH') })), 'push')
  assert.equal(gradeDisplayedPick(game()), null)

  const ml = { show: true, market: 'ML', side: 'away', teamId: 'a', spread: null }
  assert.equal(gradeValuePick(ml, { final }), 'win')
  const ats = { show: true, market: 'ATS', side: 'home', teamId: 'h', spread: { homeLine: 7.5, awayLine: -7.5 } }
  assert.equal(gradeValuePick(ats, { final }), 'win')
  const push = { show: true, market: 'ATS', side: 'away', teamId: 'a', spread: { homeLine: 7, awayLine: -7 } }
  assert.equal(gradeValuePick(push, { final }), 'push')
  assert.equal(gradeValuePick({ show: false, market: null }, { final }), null)
})

test('a missing ESPN game can use a saved parlay moneyline, and a written spread is ignored', () => {
  const teamOdds = {
    week: 12, source: 'ESPN scoreboard odds', asOf: 'Nov 27, 2:23 PM ET', book: 'DraftKings',
    games: { 'DEN-PIT': { ...coinFlip, away: 'DEN', home: 'PIT', moneyline: { DEN: { price: -200, book: 'DraftKings' }, PIT: { price: 170, book: 'DraftKings' } } } },
  }
  const parlays = {
    week: 12,
    games: {
      'DEN-PIT': { market: { moneyline: { DEN: { price: 100, book: 'Other' }, PIT: { price: -120, book: 'Other' } }, spread: 'Broncos -5 -109' }, snapshot: { game_asof: 'Nov 27, 9:12 AM ET' } },
      'CHI-DET': { market: { moneyline: { CHI: { price: -104, book: 'Novig' }, DET: { price: 102, book: 'FanDuel' } }, spread: 'Bears -1 -102 at BetMGM' }, snapshot: { game_asof: 'Nov 26, 11:17 AM ET' } },
      'GB-LAR': { market: null, snapshot: {} },
    },
  }
  const merged = mergeOdds(teamOdds, parlays)
  assert.equal(merged.games['DEN-PIT'].moneyline.DEN.price, -200)
  assert.equal(merged.games['CHI-DET'].spread, null)
  assert.equal(merged.games['CHI-DET'].asOf, 'Nov 26, 11:17 AM ET')
  assert.equal(merged.games['GB-LAR'], undefined)
  const scored = scoreGame(game({ away: team('c', 'CHI'), home: team('d', 'DET'), winner: team('d', 'DET') }), merged.games['CHI-DET'])
  assert.equal(scored.ats, null)
  assert.ok(scored.ml)
  assert.equal(scored.noLine, false)
})

test('every saved week 13 price can be scored without inventing a side', () => {
  const odds = JSON.parse(readFileSync(new URL('../src/data/team-odds-wk13.json', import.meta.url)))
  assert.equal(odds.source, 'ESPN scoreboard odds')
  assert.equal(odds.asOf, 'Nov 27, 2:23 PM ET')
  const matchups = Object.entries(odds.games).map(([key, row], index) => {
    const [away, home] = key.split('-')
    return game({
      id: key,
      away: team(`a${index}`, away),
      home: team(`h${index}`, home),
      winner: team(`h${index}`, home),
    })
  })
  const scored = scoreMatchups(matchups, odds)
  assert.equal(scored.meta.asOf, 'Nov 27, 2:23 PM ET')
  assert.equal(scored.meta.book, 'DraftKings')
  for (const matchup of matchups) {
    const value = scored.byId[matchup.id]
    assert.equal(value.noLine, false, matchup.id)
    assert.ok(value.ml?.price, matchup.id)
    assert.ok(value.ats?.price, matchup.id)
    assert.ok(value.ml.abbr === matchup.away.abbr || value.ml.abbr === matchup.home.abbr)
  }
})
