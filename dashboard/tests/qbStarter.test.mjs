import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { applyTeamStarter } from '../src/props/qbStarter.js'

const spec = JSON.parse(fs.readFileSync(new URL('../src/data/qb-starters.json', import.meta.url))).weeks['12'].PIT

test('week 12 Pittsburgh starts Rudolph and the note is the one on the card', () => {
  assert.equal(spec.qb, 'Mason Rudolph')
  assert.equal(spec.out, 'Aaron Rodgers')
  assert.equal(spec.note, 'QB override: Rudolph starting (Rodgers out)')
  assert.ok(spec.passYds > 173.5)
  assert.ok(spec.efficiency < 1)
  assert.equal(spec.sample2026Attempts, 4)
})

test('the team score uses a lower Pittsburgh total and leaves Denver alone', () => {
  const pit = { abbr: 'PIT', pf: 20, recent: { passO: 200, rushO: 100, passD: 180, rushD: 90 } }
  const adjusted = applyTeamStarter(pit, 12)
  assert.ok(adjusted.pf < pit.pf)
  assert.ok(adjusted.recent.passO < pit.recent.passO)
  assert.equal(adjusted.qbOverride.qb, 'Mason Rudolph')
  assert.equal(applyTeamStarter({ abbr: 'DEN', pf: 21, recent: { passO: 10, rushO: 10 } }, 12).pf, 21)
})
