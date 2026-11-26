import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { slotNote } from '../src/props/tdRiskBoard.js'
import { applyCoverage, coverageMultiplier, lambdaFromAnytime, lambdaFromTail, probAtLeast } from '../src/props/tdCoverage.js'

const root = new URL('../', import.meta.url)
const tdCoverage = JSON.parse(readFileSync(new URL('../src/data/td-coverage-wk12.json', import.meta.url)))
const coverage = readFileSync(new URL('../src/data/coverage-wk12.json', import.meta.url))

test('multiplier damps, clamps, shrinks receiving backs, and halves a clipped mix', () => {
  const base = { idxMan: 1.2, idxZone: 0.8, manDef: 0.5, zoneDef: 0.5, manLg: 0.3, zoneLg: 0.7, position: 'WR' }
  const raw = (0.5 * 1.2 + 0.5 * 0.8) / (0.3 * 1.2 + 0.7 * 0.8)
  const wr = coverageMultiplier(base)
  assert.ok(Math.abs(wr.mRaw - raw) < 1e-12)
  assert.ok(Math.abs(wr.mAdj - Math.min(1.1, Math.max(0.9, 1 + 0.5 * (raw - 1)))) < 1e-12)
  const rb = coverageMultiplier({ ...base, position: 'RB', recTd: 1, rushTd: 9 })
  const share = (1 + 0.5) / (1 + 9 + 2.5)
  assert.ok(Math.abs(rb.share - share) < 1e-12)
  assert.ok(Math.abs(rb.m - (1 + share * (raw - 1))) < 1e-12)
  const huge = coverageMultiplier({ ...base, idxMan: 5, idxZone: 0.2, manDef: 0.9, zoneDef: 0.1, manLg: 0.1, zoneLg: 0.9 })
  assert.equal(huge.mAdj, 1.1)
  const tiny = coverageMultiplier({ ...base, idxMan: 0.1, idxZone: 2, manDef: 0.9, zoneDef: 0.1, manLg: 0.1, zoneLg: 0.9 })
  assert.equal(tiny.mAdj, 0.9)
  const clipped = coverageMultiplier({ ...base, clipped: true })
  const damped = 1 + 0.5 * (raw - 1)
  assert.ok(Math.abs(clipped.mAdj - (1 + 0.5 * (damped - 1))) < 1e-12)
  assert.equal(coverageMultiplier({ ...base, hasSample: false }).mAdj, 1)
  assert.equal(coverageMultiplier({ ...base, hasMix: false }).reason, 'no coverage mix')
  assert.equal(coverageMultiplier({ ...base, position: 'QB' }).mAdj, 1)
})

test('Poisson anytime and tails round-trip', () => {
  for (const prob of [0.1, 0.42, 0.68]) {
    const lambda = lambdaFromAnytime(prob)
    assert.ok(Math.abs(probAtLeast(lambda, 1) - prob) < 1e-9)
  }
  for (const lambda of [0.2, 0.8, 1.4]) {
    for (const count of [2, 3]) {
      const prob = probAtLeast(lambda, count)
      assert.ok(Math.abs(lambdaFromTail(prob, count) - lambda) < 1e-4)
    }
  }
})

test('re-ranking flips the top two, drops a low 2+ look, and keeps the price on the player', () => {
  const row = {
    position: 'WR',
    tdsAllowed: 8,
    confident: { player: 'Alpha', team: 'PHI', position: 'WR', role: 'WR1', prop: 'Anytime TD', modelProb: 0.5, price: '+150', book: 'BookA', estimate: false, status: null, reason: 'Alpha base.' },
    relativelySafe: { player: 'Beta', team: 'PHI', position: 'WR', role: 'WR2', prop: 'Anytime TD', modelProb: 0.45, price: '+200', book: 'BookB', estimate: false, status: null, reason: 'Beta base.' },
    upside: [
      { player: 'Gamma', position: 'WR', prop: 'Anytime TD', modelProb: 0.12, price: '+400', book: 'BookC', flavor: 'backup_1td', reason: 'Gamma base.' },
      { player: 'Gamma', position: 'WR', prop: '2+ TDs', modelProb: 0.04, price: '+800', book: 'BookC', flavor: 'safer_2plus', reason: 'Gamma two.' },
    ],
    notes: ['No second qualifying WR reaches 15%.'],
  }
  const td = { players: {
    'alpha|WR': { idxMan: 0.4, idxZone: 1.4, recTd2025: 0, rushTd2025: 0 },
    'beta|WR': { idxMan: 1.8, idxZone: 0.6, recTd2025: 0, rushTd2025: 0 },
    'gamma|WR': { idxMan: 1, idxZone: 1, recTd2025: 0, rushTd2025: 0 },
  } }
  const board = { key: 'PHI@DAL', sides: [{ offense: 'PHI', defense: 'DAL', rows: [row] }] }
  const mix = { games: {
    'PHI-DAL': { offenses: { PHI: { mix: { COVER_0: 0.8, COVER_1: 0, '2_MAN': 0, COVER_2: 0.2 }, mixNote: 'solved' } } },
    'GB-LAR': { offenses: { GB: { mix: { COVER_0: 0.2, COVER_1: 0, '2_MAN': 0, COVER_2: 0.8 }, mixNote: 'solved' } } },
  } }
  const rules = { relativelySafeMinProb: 0.15, upside2plusMinProb: 0.03, upside3plusMinProb: 0.05, maxBackups: 2, questionableRankFactor: 0.85 }
  const next = applyCoverage(board, mix, td, rules).sides[0].rows[0]
  assert.equal(next.confident.player, 'Beta')
  assert.equal(next.confident.price, '+200')
  assert.equal(next.confident.book, 'BookB')
  assert.equal(next.relativelySafe.player, 'Alpha')
  assert.equal(next.relativelySafe.price, '+150')
  assert.ok(next.upside.some(pick => pick.player === 'Gamma' && pick.prop === 'Anytime TD'))
  assert.ok(next.upside.every(pick => pick.prop !== '2+ TDs'))
  assert.match(next.confident.reason, /Coverage: DAL plays man/)
  const questionable = applyCoverage({ ...board, sides: [{ ...board.sides[0], rows: [{ ...row, relativelySafe: { ...row.relativelySafe, modelProb: 0.46, status: 'Questionable' }, confident: { ...row.confident, modelProb: 0.4 } }] }] }, mix, { players: { 'alpha|WR': td.players['gamma|WR'], 'beta|WR': td.players['gamma|WR'] } }, rules)
  assert.equal(questionable.sides[0].rows[0].confident.player, 'Alpha')
  assert.equal(slotNote(), '')
})

test('a missing coverage file leaves the board untouched', () => {
  const game = { key: 'CHI@DET', sides: [{ rows: [{ confident: { player: 'A', modelProb: 0.5 } }] }] }
  assert.equal(applyCoverage(game, null, tdCoverage), game)
  assert.equal(applyCoverage(game, { games: {} }, null), game)
})

test('coverage files match the published sources', () => {
  const expected = execFileSync('git', ['show', '30919d7:dashboard/src/data/coverage-wk12.json'])
  assert.equal(coverage.equals(expected), true)
  assert.ok(tdCoverage.league.WR.man > 0 && tdCoverage.league.WR.zone > 0)
  assert.ok(tdCoverage.league.TE.man > 0 && tdCoverage.league.RB.zone > 0)
  const [key, player] = Object.entries(tdCoverage.players)[0]
  assert.match(key, /\|(WR|TE|RB)$/)
  assert.ok(player.idxMan > 0 && player.idxZone > 0)
  assert.ok(tdCoverage.players['ceedee lamb|WR'])
})
