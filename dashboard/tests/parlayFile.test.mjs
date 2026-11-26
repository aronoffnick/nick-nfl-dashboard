import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cardsFromParlayFile, pct1 } from '../src/props/parlayFile.js'

const board = JSON.parse(readFileSync(new URL('../src/data/parlays-wk12.json', import.meta.url)))

test('week 12 parlay file has the three Thanksgiving games', () => {
  assert.equal(board.week, 12)
  assert.deepEqual(Object.keys(board.games), ['CHI-DET', 'PHI-DAL', 'KC-BUF'])
})

test('Chicago at Detroit keeps the approved legs and uses the refreshed prices', () => {
  const cards = cardsFromParlayFile(board.games['CHI-DET'])
  assert.deepEqual(cards.map(card => card.title), ['Overall favorite', 'CHI correlated', 'DET correlated', 'Game-script mix'])
  const favorite = cards[0]
  assert.deepEqual(favorite.legs.map(leg => leg.label), [
    'Sam LaPorta under 4.5 receptions',
    'Amon-Ra St. Brown under 7.5 receptions',
    'Jahmyr Gibbs anytime TD',
  ])
  assert.equal(pct1(favorite.joint), '38.7%')
  assert.equal(favorite.payout, '+322')
  assert.equal(favorite.legs[2].quote, '-263 Polymarket (after fees)')
  assert.match(favorite.notes[0], /Team-win variant:.*35\.4%.*\+393/)
  assert.match(cards[2].legs[0].quote, /\+104 Novig/)
  assert.equal(cards[2].legs[0].lean, 'under')
  assert.equal(cards[3].legs[1].label, "D'Andre Swift over 2.5 receptions")
  assert.match(board.games['CHI-DET'].gaps[0], /market favors CHI/)
})

test('Philadelphia and Kansas City read the same four categories', () => {
  const phi = cardsFromParlayFile(board.games['PHI-DAL'])
  assert.equal(phi[0].legs[0].label, 'DeVonta Smith over 64.5 Rec yds')
  assert.equal(phi[1].title, 'PHI correlated')
  assert.match(phi[1].why, /No eligible QB/)
  assert.equal(phi[3].legs[0].label, 'Javonte Williams over 76.5 Rush yds')
  assert.match(phi[3].notes.find(note => note.startsWith('Alt:')), /Saquon Barkley/)
  const kc = cardsFromParlayFile(board.games['KC-BUF'])
  assert.equal(kc[0].legs[0].label, 'Patrick Mahomes over 224.5 Pass yds')
  assert.equal(kc[2].title, 'BUF correlated')
  assert.equal(kc[3].legs[1].label, 'Rashee Rice over 4.5 receptions')
  assert.equal(kc[3].legs[0].lean, 'under')
  assert.match(kc[0].notes[0], /Josh Allen under 1\.5 Pass TDs/)
})
