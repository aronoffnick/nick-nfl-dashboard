import test from 'node:test'
import assert from 'node:assert/strict'
import {decideScatterLine, scatterGameKey, scatterProjection} from '../src/props/scatterCheck.js'

const games = {
  'GB-LAR': {players:[{n:'Kyren Williams', s:{recYds:[26.7, 40, 1], rushYds:[61.6, 66.4, 1.01], td:[0.7, 0.86, 1.28]}}]},
  'WAS-NYG': {players:[{n:'Austin Ekeler', s:{rec:[3.2, 0.4, 1]}}]},
}

test('game key maps WSH to WAS and LA to LAR, matching ScatterTab', () => {
  assert.equal(scatterGameKey('WSH', 'LA'), 'WAS-LAR')
  assert.equal(scatterGameKey('GB', 'LAR'), 'GB-LAR')
})

test('Kyren receiving yards stays at the Safe line because scatter 40 is above 15', () => {
  const projection = scatterProjection(games, {awayAbbr:'GB', homeAbbr:'LAR', playerName:'Kyren Williams', statKey:'recYds'})
  assert.equal(projection, 40)
  const decision = decideScatterLine({line:15, statKey:'recYds', projection})
  assert.equal(decision.action, 'keep')
  assert.equal(decision.line, 15)
  assert.equal(decision.mark, 'Scatter check ✓ (proj 40)')
})

test('totalTD reads the scatter td projection', () => {
  assert.equal(scatterProjection(games, {awayAbbr:'GB', homeAbbr:'LAR', playerName:'Kyren Williams', statKey:'totalTD'}), 0.86)
  const decision = decideScatterLine({line:1, statKey:'totalTD', projection:0.86})
  assert.equal(decision.action, 'remove')
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
  assert.equal(scatterProjection(games, {awayAbbr:'GB', homeAbbr:'LAR', playerName:'Matthew Stafford', statKey:'passTD'}), null)
  assert.equal(decideScatterLine({line:2, statKey:'passTD', projection:null}).mark, 'No scatter data')
  assert.equal(scatterProjection(games, {awayAbbr:'WSH', homeAbbr:'NYG', playerName:'Nobody', statKey:'rec'}), null)
})
