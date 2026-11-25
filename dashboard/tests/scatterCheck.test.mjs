import test from 'node:test'
import assert from 'node:assert/strict'
import {decideScatterLine, raisedBreakoutLine, roundPropLine, scatterGameKey, scatterProjection} from '../src/props/scatterCheck.js'

const games = {
  'GB-LAR': {players:[{n:'Kyren Williams', s:{recYds:[26.7, 40, 1], rushYds:[61.6, 66.4, 1.01], td:[0.7, 0.86, 1.28]}}]},
  'WAS-NYG': {players:[{n:'Austin Ekeler', s:{rec:[3.2, 0.4, 1]}}]},
}

test('game key maps WSH to WAS and LA to LAR, matching ScatterTab', () => {
  assert.equal(scatterGameKey('WSH', 'LA'), 'WAS-LAR')
  assert.equal(scatterGameKey('GB', 'LAR'), 'GB-LAR')
})

test('Kyren receiving yards bumps from the Safe 15 line to the live projection 19 when scatter is 40', () => {
  const projection = scatterProjection(games, {awayAbbr:'GB', homeAbbr:'LAR', playerName:'Kyren Williams', statKey:'recYds'})
  assert.equal(projection, 40)
  const decision = decideScatterLine({line:15, statKey:'recYds', projection, liveProjection:19})
  assert.equal(decision.action, 'bump')
  assert.equal(decision.line, 19)
  assert.equal(decision.mark, 'Raised to live projection: 15+ -> 19+')
  assert.equal(decision.flag, null)
})

test('a pass never lowers the Safe line, and a live projection above scatter stays with a flag', () => {
  const kept = decideScatterLine({line:15, statKey:'recYds', projection:40, liveProjection:12.2})
  assert.equal(kept.action, 'keep')
  assert.equal(kept.line, 15)
  const flagged = decideScatterLine({line:15, statKey:'recYds', projection:40, liveProjection:45.2})
  assert.equal(flagged.line, 45)
  assert.equal(flagged.flag, 'live proj above scatter')
  assert.equal(roundPropLine(40.3), 40.5)
})

test('Kyren breakout receiving yards rises from 25 to the scatter projection 40', () => {
  const raised = raisedBreakoutLine(25, 40)
  assert.equal(raised.line, 40)
  assert.equal(raised.note, 'Line raised to scatter proj')
  assert.equal(raisedBreakoutLine(25, 20).line, 25)
  assert.equal(raisedBreakoutLine(25, null).note, 'No scatter data')
})

test('Corum 1+ rush+rec TDs is kept and skipped even when scatter is under 1', () => {
  const decision = decideScatterLine({line:1, statKey:'totalTD', projection:0.45, liveProjection:0.8})
  assert.equal(decision.action, 'skip')
  assert.equal(decision.kind, 'skipped')
  assert.equal(decision.line, 1)
  assert.equal(decision.mark, 'Scatter check skipped (TD leg)')
})

test('Stafford 2+ pass TDs is skipped instead of marked no scatter data', () => {
  assert.equal(scatterProjection(games, {awayAbbr:'GB', homeAbbr:'LAR', playerName:'Matthew Stafford', statKey:'passTD'}), null)
  const decision = decideScatterLine({line:2, statKey:'passTD', projection:null, liveProjection:2.5})
  assert.equal(decision.action, 'skip')
  assert.equal(decision.line, 2)
  assert.equal(decision.mark, 'Scatter check skipped (TD leg)')
  assert.equal(decideScatterLine({line:1, statKey:'rushTD', projection:2}).action, 'skip')
})

test('a line above the scatter projection drops to the whole number at or below it', () => {
  const decision = decideScatterLine({line:20, statKey:'rushYds', projection:12.8})
  assert.deepEqual({action:decision.action, line:decision.line, mark:decision.mark}, {
    action:'lower', line:12, mark:'Lowered by scatter check: 20+ -> 12+',
  })
})

test('yards below 5 and receptions below 1 are removed instead of lowered', () => {
  assert.equal(decideScatterLine({line:15, statKey:'rushYds', projection:4.9}).action, 'remove')
  assert.equal(decideScatterLine({line:4, statKey:'rec', projection:0.4}).action, 'remove')
  assert.equal(decideScatterLine({line:4, statKey:'rec', projection:1.2}).line, 1)
})

test('unmapped stats and missing players stay unmarked as no scatter data', () => {
  assert.equal(scatterProjection(games, {awayAbbr:'WSH', homeAbbr:'NYG', playerName:'Nobody', statKey:'rec'}), null)
  assert.equal(decideScatterLine({line:15, statKey:'recYds', projection:null}).mark, 'No scatter data')
})
