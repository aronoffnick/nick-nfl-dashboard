import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGameScript, emptyScript, scriptFit, toggleScript } from '../src/props/gameScript.js'

const away = { id: 'gb', abbr: 'GB', name: 'Green Bay Packers', logo: 'gb.png' }
const home = { id: 'lar', abbr: 'LAR', name: 'Los Angeles Rams', logo: 'lar.png' }
const matchup = { away, home, margin: 6.5, winner: home }

function makePlayer({ id, name, position, team, stats, defenseFactor = 1, adjusted = true, sample = 8, unavailable = false, carries, passAtt }) {
  const built = {}
  for (const [key, projection] of Object.entries(stats)) {
    built[key] = {
      projection,
      baseline: projection,
      sample,
      defense: { factor: defenseFactor, adjusted, sample: 6 },
    }
  }
  const row = {
    passAtt: passAtt ?? (position === 'QB' ? 32 : 0),
    carries: carries ?? (position === 'RB' || position === 'FB' ? 18 : 0),
    passYds: stats.passYds || 0,
    passTD: stats.passTD || 0,
    rushYds: stats.rushYds || 0,
    rushTD: stats.rushTD || 0,
    rec: stats.rec || 0,
    recYds: stats.recYds || 0,
    recTD: stats.recTD || 0,
  }
  return {
    id, name, position, team, unavailable,
    stats: built,
    logs: Array.from({ length: sample }, () => ({ ...row })),
  }
}

function roster() {
  return [
    makePlayer({ id: 'qb-a', name: 'Jordan Love', position: 'QB', team: away, stats: { passYds: 240, passTD: 1.6 } }),
    makePlayer({ id: 'rb-a', name: 'Josh Jacobs', position: 'RB', team: away, stats: { rushYds: 80, rushTD: 0.5, rec: 3, recYds: 20 } }),
    makePlayer({ id: 'rb-a2', name: 'Emanuel Wilson', position: 'RB', team: away, stats: { rushYds: 40, rushTD: 0.2 } }),
    makePlayer({ id: 'wr-a', name: 'Romeo Doubs', position: 'WR', team: away, stats: { rec: 5, recYds: 70, recTD: 0.4 } }),
    makePlayer({ id: 'wr-a2', name: 'Christian Watson', position: 'WR', team: away, stats: { rec: 3, recYds: 35, recTD: 0.2 } }),
    makePlayer({ id: 'te-a', name: 'Tucker Kraft', position: 'TE', team: away, stats: { rec: 4, recYds: 40, recTD: 0.3 } }),
    makePlayer({ id: 'qb-b', name: 'Matthew Stafford', position: 'QB', team: home, stats: { passYds: 250, passTD: 1.8 } }),
    makePlayer({ id: 'rb-b', name: 'Kyren Williams', position: 'RB', team: home, stats: { rushYds: 75, rushTD: 0.45, rec: 3, recYds: 22 } }),
    makePlayer({ id: 'wr-b', name: 'Puka Nacua', position: 'WR', team: home, stats: { rec: 6, recYds: 80, recTD: 0.45 } }),
    makePlayer({ id: 'te-b', name: 'Tyler Higbee', position: 'TE', team: home, stats: { rec: 4, recYds: 42, recTD: 0.25 } }),
  ]
}

function find(result, name, key) {
  const prop = result.props.find(item => item.name === name && item.key === key)
  assert.ok(prop, `missing ${name} ${key}`)
  return prop
}

function run(selection, extra = {}) {
  return buildGameScript({ matchup, players: roster(), selection, halfLife: 3, ...extra })
}

test('an empty script ranks nothing', () => {
  const result = run(emptyScript())
  assert.equal(result.active, false)
  assert.equal(result.props.length, 0)
  assert.equal(result.parlays.length, 0)
  assert.match(result.note, /not a guarantee/i)
})

test('a win lifts the RB1 and the trailing pass game, and cuts the leader pass volume', () => {
  const result = run({ ...emptyScript(), win: 'gb' })
  const jacobs = find(result, 'Josh Jacobs', 'rushYds')
  const love = find(result, 'Jordan Love', 'passYds')
  const stafford = find(result, 'Matthew Stafford', 'passYds')
  const puka = find(result, 'Puka Nacua', 'recYds')
  const kyren = find(result, 'Kyren Williams', 'rushYds')
  assert.equal(jacobs.role, 'RB1')
  assert.ok(Math.abs(jacobs.pct - 0.10) < 1e-9)
  assert.equal(jacobs.arrow, 'up')
  assert.equal(jacobs.direction, 'over')
  assert.ok(jacobs.scenario > jacobs.baseline)
  assert.ok(Math.abs(love.pct - -0.08) < 1e-9)
  assert.equal(love.arrow, 'down')
  assert.equal(love.direction, 'under')
  assert.ok(Math.abs(find(result, 'Jordan Love', 'passAtt').pct - -0.10) < 1e-9)
  assert.ok(Math.abs(find(result, 'Josh Jacobs', 'carries').pct - 0.12) < 1e-9)
  assert.ok(Math.abs(stafford.pct - 0.12) < 1e-9)
  assert.equal(stafford.direction, 'over')
  assert.ok(Math.abs(puka.pct - 0.12) < 1e-9)
  assert.ok(Math.abs(kyren.pct - -0.12) < 1e-9)
  assert.equal(kyren.arrow, 'down')
  assert.match(jacobs.why, /RB1/)
  assert.match(jacobs.why, /Wins/)
})

test('wins big moves the back more than a close win', () => {
  const big = find(run({ ...emptyScript(), win: 'gb', margin: 'big' }), 'Josh Jacobs', 'rushYds')
  const close = find(run({ ...emptyScript(), win: 'gb', margin: 'close' }), 'Josh Jacobs', 'rushYds')
  const plain = find(run({ ...emptyScript(), win: 'gb' }), 'Josh Jacobs', 'rushYds')
  assert.ok(Math.abs(big.pct - 0.155) < 1e-9)
  assert.ok(Math.abs(close.pct - 0.05) < 1e-9)
  assert.ok(big.pct > plain.pct)
  assert.ok(plain.pct > close.pct)
})

test('an early lead points the same way as a win, and stacking it with a win does not double the move', () => {
  const early = find(run({ ...emptyScript(), early: 'gb' }), 'Josh Jacobs', 'rushYds')
  const both = find(run({ ...emptyScript(), win: 'gb', early: 'gb' }), 'Josh Jacobs', 'rushYds')
  assert.ok(Math.abs(early.pct - 0.09) < 1e-9)
  assert.equal(early.arrow, 'up')
  assert.ok(Math.abs(both.pct - 0.125) < 1e-9)
  assert.ok(both.pct < 0.10 + 0.09)
})

test('rushing success lifts RB yards and scores and the opponent pass volume', () => {
  const result = run({ ...emptyScript(), rush: 'gb' })
  const yards = find(result, 'Josh Jacobs', 'rushYds')
  const score = find(result, 'Josh Jacobs', 'rushTD')
  const stafford = find(result, 'Matthew Stafford', 'passYds')
  assert.ok(Math.abs(yards.pct - 0.16) < 1e-9)
  assert.ok(Math.abs(score.pct - 0.18) < 1e-9)
  assert.ok(score.scenario > score.baseline)
  assert.ok(Math.abs(stafford.pct - 0.10) < 1e-9)
  assert.equal(stafford.arrow, 'up')
  assert.match(stafford.why, /Opponent rushing success/)
})

test('passing success lifts the quarterback and the WR1 more than the WR2', () => {
  const result = run({ ...emptyScript(), pass: 'gb' })
  const love = find(result, 'Jordan Love', 'passYds')
  const td = find(result, 'Jordan Love', 'passTD')
  const wr1 = find(result, 'Romeo Doubs', 'recYds')
  const wr2 = find(result, 'Christian Watson', 'recYds')
  const te = find(result, 'Tucker Kraft', 'recYds')
  assert.ok(Math.abs(love.pct - 0.14) < 1e-9)
  assert.ok(Math.abs(td.pct - 0.16) < 1e-9)
  assert.equal(wr1.role, 'WR1')
  assert.ok(Math.abs(wr1.pct - 0.14) < 1e-9)
  assert.ok(Math.abs(wr2.pct - 0.07) < 1e-9)
  assert.ok(wr1.pct > wr2.pct)
  assert.ok(Math.abs(te.pct - 0.11) < 1e-9)
  assert.equal(te.role, 'TE')
})

test('a shootout lifts both quarterbacks and a low-scoring script puts them under', () => {
  const shootout = run({ ...emptyScript(), scoring: 'shootout' })
  const low = run({ ...emptyScript(), scoring: 'low' })
  for (const name of ['Jordan Love', 'Matthew Stafford']) {
    const over = find(shootout, name, 'passYds')
    const under = find(low, name, 'passYds')
    assert.ok(Math.abs(over.pct - 0.12) < 1e-9)
    assert.equal(over.direction, 'over')
    assert.ok(Math.abs(under.pct - -0.11) < 1e-9)
    assert.equal(under.direction, 'under')
    assert.equal(under.arrow, 'down')
  }
  assert.ok(find(shootout, 'Romeo Doubs', 'recYds').pct > 0)
  assert.ok(find(shootout, 'Puka Nacua', 'recYds').pct > 0)
})

test('stacking a win with rushing success keeps the larger move and caps a pile of pass bumps', () => {
  const stacked = find(run({ ...emptyScript(), win: 'gb', rush: 'gb' }), 'Josh Jacobs', 'rushYds')
  assert.ok(Math.abs(stacked.pct - 0.205) < 1e-6)
  assert.match(stacked.why, /Stacked with/)
  const piled = run({
    ...emptyScript(),
    win: 'lar',
    margin: 'big',
    pass: 'gb',
    rush: 'lar',
    scoring: 'shootout',
  })
  const love = find(piled, 'Jordan Love', 'passYds')
  assert.ok(Math.abs(love.pct - 0.32) < 1e-9)
})

test('a committee back moves less than the RB1, and a small share drops off', () => {
  const result = run({ ...emptyScript(), win: 'gb' })
  const lead = find(result, 'Josh Jacobs', 'rushYds')
  const next = find(result, 'Emanuel Wilson', 'rushYds')
  assert.ok(next.pct < lead.pct)
  assert.equal(next.role, 'RB2')
  const deep = makePlayer({ id: 'rb-deep', name: 'Deep Back', position: 'RB', team: away, stats: { rushYds: 20, rushTD: 0.1 } })
  const hidden = buildGameScript({
    matchup,
    players: [...roster().filter(player => player.id !== 'rb-a2'), deep],
    selection: { ...emptyScript(), win: 'gb' },
    halfLife: 3,
  })
  assert.equal(hidden.props.some(prop => prop.name === 'Deep Back'), false)
})

test('rush attempts use the rushing defense factor already on the yardage projection', () => {
  const back = makePlayer({
    id: 'rb-a', name: 'Josh Jacobs', position: 'RB', team: away,
    stats: { rushYds: 80, rushTD: 0.5 }, defenseFactor: 1.2, carries: 20,
  })
  const result = buildGameScript({
    matchup, players: [back], selection: { ...emptyScript(), win: 'gb' }, halfLife: 3,
  })
  const carries = find(result, 'Josh Jacobs', 'carries')
  assert.equal(carries.baseline, 24)
  assert.equal(carries.scenario, 27)
  assert.equal(carries.arrow, 'up')
})

test('the side follows the line when one exists, and the arrow still follows the script', () => {
  const lines = [
    { kind: 'prop', player: 'Josh Jacobs', market: 'Rush yds', line: 90.5, priced: true },
    { kind: 'prop', player: 'Matthew Stafford', market: 'Pass yds', line: 249.5, priced: false },
  ]
  const result = run({ ...emptyScript(), win: 'gb' }, { lines })
  const jacobs = find(result, 'Josh Jacobs', 'rushYds')
  const stafford = find(result, 'Matthew Stafford', 'passYds')
  assert.equal(jacobs.direction, 'under')
  assert.equal(jacobs.arrow, 'up')
  assert.equal(jacobs.line, 90.5)
  assert.equal(jacobs.lineSource, 'snapshot')
  assert.equal(stafford.direction, 'over')
  assert.equal(stafford.lineSource, 'model')
})

test('unavailable players are left out', () => {
  const players = roster().map(player => player.id === 'rb-a' ? { ...player, unavailable: true } : player)
  const result = buildGameScript({ matchup, players, selection: { ...emptyScript(), win: 'gb' }, halfLife: 3 })
  assert.equal(result.props.some(prop => prop.name === 'Josh Jacobs'), false)
  assert.equal(find(result, 'Emanuel Wilson', 'rushYds').role, 'RB1')
})

test('suggested parlays use distinct legs and pair the moneyline with the RB1', () => {
  const result = run({ ...emptyScript(), win: 'gb', early: 'gb' })
  assert.ok(result.parlays.length >= 2 && result.parlays.length <= 3)
  const ids = result.parlays.flatMap(parlay => parlay.legs.map(leg => leg.id))
  assert.equal(new Set(ids).size, ids.length)
  const win = result.parlays[0]
  assert.match(win.title, /win script/)
  assert.equal(win.legs[0].kind, 'team')
  assert.equal(win.legs[0].team.abbr, 'GB')
  assert.equal(win.legs[1].name, 'Josh Jacobs')
  assert.equal(win.legs[1].key, 'rushYds')
  assert.equal(win.legs[1].direction, 'over')
  assert.match(win.legs[1].why, /Josh Jacobs/)
  for (const parlay of result.parlays) {
    const players = parlay.legs.map(leg => leg.playerId).filter(Boolean)
    assert.equal(new Set(players).size, players.length)
  }
})

test('a passing script builds a quarterback and WR1 stack', () => {
  const result = run({ ...emptyScript(), pass: 'gb' })
  const stack = result.parlays.find(parlay => /pass stack/.test(parlay.title))
  assert.ok(stack)
  assert.equal(stack.legs[0].name, 'Jordan Love')
  assert.equal(stack.legs[0].key, 'passYds')
  assert.equal(stack.legs[1].name, 'Romeo Doubs')
  assert.equal(stack.legs[1].key, 'recYds')
  assert.ok(result.parlays.some(parlay => /receivers/.test(parlay.title)))
  assert.equal(result.parlays.some(parlay => /Next best/.test(parlay.title)), false)
  const ids = result.parlays.flatMap(parlay => parlay.legs.map(leg => leg.id))
  assert.equal(new Set(ids).size, ids.length)
})

test('fit is higher for a clearer, larger move', () => {
  const strong = scriptFit({ pct: 0.16, roleWeight: 1, sample: 8, defenseAdjusted: true })
  const light = scriptFit({ pct: 0.04, roleWeight: 0.4, sample: 3, defenseAdjusted: false })
  assert.ok(strong >= 70)
  assert.ok(light < 45)
  assert.ok(strong > light)
})

test('toggles replace the other winner and swap the scoring environment', () => {
  let selection = toggleScript(emptyScript(), 'big', 'gb')
  assert.equal(selection.win, 'gb')
  assert.equal(selection.margin, 'big')
  selection = toggleScript(selection, 'close', 'lar')
  assert.equal(selection.win, 'lar')
  assert.equal(selection.margin, 'close')
  selection = toggleScript(selection, 'shootout')
  selection = toggleScript(selection, 'low')
  assert.equal(selection.scoring, 'low')
  selection = toggleScript(selection, 'early', 'gb')
  selection = toggleScript(selection, 'early', 'gb')
  assert.equal(selection.early, null)
})
