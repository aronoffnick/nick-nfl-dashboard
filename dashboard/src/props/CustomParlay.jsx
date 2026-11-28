import { useEffect, useMemo, useState } from 'react'
import { mergeOdds } from '../matchupValue.js'
import { fileForWeek, roleBookForWeek } from '../data/weekFiles.js'
import { getRosters } from './data.js'
import { boardFor } from './gameBoard.js'
import { boardGame } from './parlayBoard.js'
import { buildGameScript, scriptSummary, selectionFromChoices } from './gameScript.js'
import { scatterAbbrev } from './scatterCheck.js'
import {
  americanBounds,
  applyGameScript,
  buildCustomParlays,
  filterPools,
  formatChance,
  formatSignedChance,
  oddsDirection,
  outcomeCandidates,
  propCandidates,
  runningAmerican,
  slateMismatchSummary,
  validateCustomParlay,
} from './customParlay.js'
import { bookShort, buildTdScorers, classifyMismatch, collectTdPrices, filterTdAxis } from './tdScorers.js'
import './customParlay.css'

const EMPTY_TYPES = { outcome: true, td: true, prop: true }
const SNAPSHOT_NOTE = 'Unstarted games only. Prices are a static snapshot, not live odds. A getoddy moneyline is kept when one was already saved. Otherwise the price is the ESPN scoreboard odds snapshot.'

function formatBook(price) {
  const n = Number(price)
  if (!Number.isFinite(n) || n === 0) return '—'
  return n > 0 ? `+${n}` : String(n)
}

function valueDetail(leg) {
  const bookName = leg.book ? ` ${bookShort(leg.book)}` : ''
  const target = leg.targetOdds == null || leg.targetFallback
    ? ''
    : ` · Target ${formatBook(leg.targetOdds)}${leg.targetMet ? ' ✓' : ''}`
  if (!leg.hasLine) return `No line${target} · Fair ${formatBook(leg.fairLine)}`
  const tag = leg.valueTag === 'undervalued' ? 'Undervalued ↑' : leg.valueTag === 'overvalued' ? 'Overvalued ↓' : 'Fair'
  return `Book ${formatBook(leg.bookLine)}${bookName}${target} · Fair ${formatBook(leg.fairLine)} · ${tag}`
}

function mismatchCopy(leg) {
  if (!leg.mismatch || !leg.hasLine) return ''
  const fair = formatBook(leg.fairLine)
  const book = `${bookShort(leg.book)} ${formatBook(leg.bookLine)}`
  return `Model fair ${fair} vs ${book} — you're paid extra`
}

function LegBadges({ leg }) {
  const badges = []
  if (leg.type === 'td' && (leg.axis === 'confidence' || leg.axis === 'both')) badges.push(['confidence', 'High confidence'])
  if (leg.type === 'td' && (leg.axis === 'value' || leg.axis === 'both')) badges.push(['value', 'High value'])
  if (leg.mismatch) {
    const points = `${leg.mismatch.edge >= 0 ? '+' : ''}${(leg.mismatch.edge * 100).toFixed(1)}%`
    if (leg.type === 'td' && leg.mismatch.likely) badges.push(['both', `MISMATCH + HIGH CONFIDENCE ${points}`])
    else if (leg.mismatch.big) badges.push(['big', `BIG MISMATCH ${points}`])
    else badges.push(['mismatch', `MISMATCH ${points}`])
  }
  if (!badges.length) return null
  const note = mismatchCopy(leg)
  return <span className="custom-parlay-badges">
    {badges.map(([kind, label]) => <b key={kind} className={`custom-parlay-badge custom-parlay-badge-${kind}`} title={note || label}>{label}</b>)}
    {note ? <span className="custom-parlay-detail">{note}</span> : null}
  </span>
}

function LegRow({ leg }) {
  const pct = Math.max(0, Math.min(100, Math.round((leg.confidence || 0) * 100)))
  return <li className="custom-parlay-leg">
    {leg.logo ? <img className="custom-parlay-logo" src={leg.logo} alt="" /> : <span className="custom-parlay-logo custom-parlay-logo-fallback" aria-hidden="true">{leg.team || '•'}</span>}
    <div className="custom-parlay-copy">
      <span className="custom-parlay-kicker">{leg.subtitle}</span>
      <strong>{leg.title}{leg.arrow ? <i className={leg.arrow === 'down' ? 'custom-parlay-down' : 'custom-parlay-up'} aria-label={leg.arrow === 'down' ? 'Script moves this down' : 'Script moves this up'}>{leg.arrow === 'down' ? ' ↓' : '↑'}</i> : null}</strong>
      <LegBadges leg={leg} />
      {leg.detail ? <span className="custom-parlay-detail">{leg.detail}</span> : null}
      {leg.scriptNote ? <span className="custom-parlay-detail">{leg.scriptNote}</span> : null}
      {leg.targetFallback ? <span className="custom-parlay-detail">No leg near {formatBook(leg.targetOdds)}; used best available</span> : null}
    </div>
    <div className="custom-parlay-confidence" role="img" aria-label={`${formatChance(leg.confidence)} confidence for ${leg.title}`}>
      <strong>{formatChance(leg.confidence)}</strong>
      <span className="custom-parlay-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <small className={leg.valueTag === 'undervalued' ? 'custom-parlay-up' : leg.valueTag === 'overvalued' ? 'custom-parlay-down' : ''}>{valueDetail(leg)}</small>
    </div>
  </li>
}

function wholeSlots(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return 0
  const number = Number(text)
  return number >= 1 && number <= 12 ? number : 0
}

function Ticker({ legs, active }) {
  const book = runningAmerican(legs, 'price')
  const fair = runningAmerican(legs, 'fairLine')
  const earlier = legs.slice(0, -1)
  const bookArrow = earlier.length ? oddsDirection(runningAmerican(earlier, 'price')?.number, book?.number) : null
  const fairArrow = earlier.length ? oddsDirection(runningAmerican(earlier, 'fairLine')?.number, fair?.number) : null
  const latest = legs.at(-1)
  const arrow = direction => direction === 'up' ? ' ↑' : direction === 'down' ? ' ↓' : ''
  return <div className="custom-parlay-ticker" aria-live="polite">
    <div>
      <small>Book odds {active ? '· building' : ''}</small>
      <strong className={bookArrow === 'down' ? 'custom-parlay-down' : bookArrow === 'up' ? 'custom-parlay-up' : ''}>{book?.text || '—'}{arrow(bookArrow)}</strong>
    </div>
    <div>
      <small>Model fair</small>
      <strong className={fairArrow === 'down' ? 'custom-parlay-down' : fairArrow === 'up' ? 'custom-parlay-up' : ''}>{fair?.text || '—'}{arrow(fairArrow)}</strong>
    </div>
    {latest?.type === 'td' ? <div>
      <small>This TD</small>
      <strong>{latest.hasLine ? formatBook(latest.bookLine) : 'No line'} · fair {formatBook(latest.fairLine)}</strong>
    </div> : null}
  </div>
}

function unstarted(game) {
  return game && !game.started && !game.final && game.away?.abbr && game.home?.abbr
}

export default function CustomParlay({ data, matchups, roster, halfLife, window = null }) {
  const slate = useMemo(() => (matchups || []).filter(unstarted), [matchups])
  const [legs, setLegs] = useState('4')
  const [games, setGames] = useState('2')
  const [legsPerGame, setLegsPerGame] = useState('')
  const [types, setTypes] = useState(EMPTY_TYPES)
  const [team, setTeam] = useState('all')
  const [scriptGameId, setScriptGameId] = useState('')
  const [outcome, setOutcome] = useState('')
  const [flow, setFlow] = useState('')
  const [minOdds, setMinOdds] = useState('')
  const [maxOdds, setMaxOdds] = useState('')
  const [valueMode, setValueMode] = useState(false)
  const [tdMode, setTdMode] = useState('mix')
  const [mismatchesOnly, setMismatchesOnly] = useState(false)
  const [targets, setTargets] = useState([])
  const [instant, setInstant] = useState(false)
  const [shown, setShown] = useState(1)
  const [option, setOption] = useState(0)
  const [loadedRoster, setLoadedRoster] = useState(roster || null)
  const reset = setter => event => { setter(event.target.value); setOption(0) }
  const toggleType = key => event => { setTypes(current => ({ ...current, [key]: event.target.checked })); setOption(0) }

  useEffect(() => {
    if (roster) {
      setLoadedRoster(roster)
      return
    }
    if (!data?.teams) return
    let cancel = false
    getRosters(data, () => {}).then(result => { if (!cancel) setLoadedRoster(result.roster) }).catch(() => {})
    return () => { cancel = true }
  }, [data, roster])

  const teams = useMemo(() => {
    const map = new Map()
    for (const game of slate) {
      for (const side of [game.away, game.home]) {
        const key = scatterAbbrev(side.abbr)
        if (!map.has(key)) map.set(key, side)
      }
    }
    return [...map.values()].sort((a, b) => String(a.name || a.abbr).localeCompare(String(b.name || b.abbr)))
  }, [slate])
  const scriptMatchup = useMemo(() => {
    if (team !== 'all') return slate.find(game => scatterAbbrev(game.away.abbr) === scatterAbbrev(team) || scatterAbbrev(game.home.abbr) === scatterAbbrev(team)) || null
    return slate.find(game => game.id === scriptGameId) || null
  }, [slate, team, scriptGameId])
  const away = scriptMatchup?.away
  const home = scriptMatchup?.home

  const validation = useMemo(() => validateCustomParlay({ legs, games, legsPerGame, types }), [legs, games, legsPerGame, types])
  const oddsCheck = useMemo(() => americanBounds(minOdds, maxOdds), [minOdds, maxOdds])
  const odds = useMemo(() => {
    const week = data?.week
    const teamOdds = fileForWeek('teamOdds', week)
    const parlays = fileForWeek('parlays', week)
    return {
      merged: mergeOdds(teamOdds.matched ? teamOdds.data : null, parlays.matched ? parlays.data : null),
      parlays: parlays.matched ? parlays.data : null,
      touchdowns: fileForWeek('tdRisk', week).data,
    }
  }, [data?.week])
  const prices = useMemo(() => collectTdPrices(odds.touchdowns, odds.parlays), [odds])
  const roleBook = useMemo(() => roleBookForWeek(data?.week), [data?.week])
  const pools = useMemo(() => {
    const prop = propCandidates(odds.parlays, slate)
    const td = buildTdScorers({ data, matchups: slate, halfLife, book: roleBook, prices })
    return { td, prop }
  }, [slate, odds, data, halfLife, roleBook, prices])
  const selection = useMemo(() => selectionFromChoices(outcome, flow, {
    awayId: away?.id, homeId: home?.id,
  }), [outcome, flow, away?.id, home?.id])
  const script = useMemo(() => {
    if (!scriptMatchup) return { active: false, props: [], summary: '' }
    const lines = boardGame(fileForWeek('parlays', data?.week), scriptMatchup.away.abbr, scriptMatchup.home.abbr)?.legs || []
    const players = loadedRoster ? boardFor(data, scriptMatchup, loadedRoster, halfLife, window).players : []
    return buildGameScript({ matchup: scriptMatchup, players, selection, halfLife, lines })
  }, [data, scriptMatchup, loadedRoster, halfLife, window, selection])
  const slotCount = wholeSlots(legs)
  const targetSlots = useMemo(() => {
    const hints = []
    const values = []
    for (let i = 0; i < slotCount; i++) {
      const parsed = americanBounds(targets[i] || '', '')
      const text = String(targets[i] || '').trim()
      if (text && !parsed.ok) hints.push(i)
      values.push(text && parsed.ok ? parsed.range.min : null)
    }
    return { hints, values }
  }, [targets, slotCount])
  const readyPools = useMemo(() => {
    const picked = team === 'all' ? null : team
    let td = filterTdAxis(pools.td, tdMode)
    if (mismatchesOnly) td = td.filter(leg => classifyMismatch(leg.confidence, leg.price, leg.oppositePrice))
    const filtered = filterPools({
      outcome: outcomeCandidates(slate, odds.merged, picked),
      td,
      prop: pools.prop,
    }, picked)
    return script.active ? applyGameScript(filtered, { props: script.props, selection, matchup: scriptMatchup }) : filtered
  }, [team, pools.td, pools.prop, slate, odds.merged, script, selection, scriptMatchup, tdMode, mismatchesOnly])
  const slateSummary = useMemo(() => {
    const picked = team === 'all' ? null : team
    return slateMismatchSummary(filterPools({
      outcome: outcomeCandidates(slate, odds.merged, picked),
      td: pools.td,
      prop: pools.prop,
    }, picked))
  }, [team, pools.td, pools.prop, slate, odds.merged])
  const built = useMemo(() => (
    validation.ok && oddsCheck.ok
      ? buildCustomParlays(readyPools, validation.input, {
        mode: valueMode ? 'value' : 'confidence',
        oddsRange: oddsCheck.range,
        targets: targetSlots.values,
        prioritizeMismatch: valueMode || tdMode === 'value' || tdMode === 'mix',
      })
      : null
  ), [validation, oddsCheck, readyPools, valueMode, targetSlots.values, tdMode])
  const parlays = built?.parlays || []
  const index = parlays.length ? Math.min(option, parlays.length - 1) : 0
  const parlay = parlays[index] || null
  const reduceMotion = useMemo(() => Boolean(globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches), [])
  const showAll = instant || reduceMotion
  const parlayKey = parlay?.id || ''
  const [trackedKey, setTrackedKey] = useState('')
  if (parlayKey !== trackedKey) {
    setTrackedKey(parlayKey)
    setShown(showAll ? (parlay?.legs.length || 0) : Math.min(1, parlay?.legs.length || 0))
  }
  useEffect(() => {
    if (!parlay || showAll) return undefined
    const timer = setInterval(() => {
      setShown(current => {
        if (current >= parlay.legs.length) {
          clearInterval(timer)
          return current
        }
        return current + 1
      })
    }, 320)
    return () => clearInterval(timer)
  }, [parlay, showAll])
  const emptySlate = slate.length === 0
  const message = emptySlate
    ? 'Every game this week has already kicked off. The generator only uses games that have not started, so there is no parlay to build.'
    : !oddsCheck.ok ? oddsCheck.message : !validation.ok ? validation.message : built?.reason
  const skippedNote = parlay && built?.note ? built.note : ''
  const visibleLegs = parlay ? parlay.legs.slice(0, showAll ? parlay.legs.length : shown) : []
  const building = Boolean(parlay && visibleLegs.length < parlay.legs.length)
  const groups = []
  for (const leg of visibleLegs) {
    let group = groups.find(item => item.id === leg.gameId)
    if (!group) {
      group = { id: leg.gameId, label: leg.gameLabel, legs: [] }
      groups.push(group)
    }
    group.legs.push(leg)
  }
  const perGameSet = validation.ok && validation.input.legsPerGame != null
  const unpricedFill = valueMode && parlay?.legs.some(leg => leg.type !== 'outcome' && !leg.priced)
  const summary = script.active ? scriptSummary(selection, scriptMatchup) : 'One parlay from this week’s unstarted games'

  function chooseTeam(event) {
    setTeam(event.target.value)
    setOutcome('')
    setFlow('')
    setScriptGameId('')
    setOption(0)
  }
  function generate(event) {
    event.preventDefault()
    setOption(0)
    document.getElementById('parlay-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  function chooseScriptGame(event) {
    setScriptGameId(event.target.value)
    setOutcome('')
    setFlow('')
    setOption(0)
  }

  return <section className="custom-parlay" id="parlay-generator" aria-label="Bet generator" data-custom-parlay>
    <div className="custom-parlay-title"><h3>Bet generator</h3><span>Week {data?.week} · {summary}</span></div>
    <p className="custom-parlay-mismatches">{slateSummary.count} mismatches found this slate</p>
    {slateSummary.count === 0 ? <p className="custom-parlay-note">{slateSummary.near.length
      ? `No mismatch at +5 pts and 1.25×. Closest: ${slateSummary.near.map(leg => `${leg.playerName || leg.title} +${(leg.edge * 100).toFixed(1)} pts`).join(', ')}.`
      : 'No mismatch at +5 pts and 1.25× on this slate.'}</p> : null}
    <p className="custom-parlay-help">Pick a team, or all of them, then how that game goes. Legs, games, and the checked types fill one parlay across this week’s unstarted games. Touchdown scorers are built for every unstarted game. Leave legs per game blank for no per-game limit. Leave the odds blank to skip a price filter. A blank target odds box leaves that leg on the normal ranking.</p>
    <p className="custom-parlay-note">{SNAPSHOT_NOTE}</p>
    <form className="custom-parlay-form" onSubmit={generate}>
      <label>Team
        <select value={team} aria-label="Team" onChange={chooseTeam}>
          <option value="all">All teams</option>
          {teams.map(side => <option key={side.abbr} value={side.abbr}>{side.name || side.abbr}</option>)}
        </select>
      </label>
      {team === 'all' ? <label className="custom-parlay-span">Script this game
        <select value={scriptGameId} aria-label="Script this game" onChange={chooseScriptGame}>
          <option value="">Skip</option>
          {slate.map(game => <option key={game.id} value={game.id}>{game.away.abbr} at {game.home.abbr}</option>)}
        </select>
      </label> : <p className="custom-parlay-note custom-parlay-span">{scriptMatchup ? `Scripting ${scriptMatchup.away.abbr} at ${scriptMatchup.home.abbr}.` : 'That team has no unstarted game to script.'}</p>}
      <fieldset className="custom-parlay-flow">
        <legend>How will the game go?</legend>
        <label>Predicted outcome
          <select value={scriptMatchup ? outcome : ''} aria-label="Predicted outcome" disabled={!scriptMatchup} onChange={reset(setOutcome)}>
            <option value="">No outcome lean</option>
            {away ? <option value="win:away">{away.name || away.abbr} wins</option> : null}
            {home ? <option value="win:home">{home.name || home.abbr} wins</option> : null}
            {away ? <option value="big:away">{away.name || away.abbr} wins big or covers</option> : null}
            {home ? <option value="big:home">{home.name || home.abbr} wins big or covers</option> : null}
            {away ? <option value="close:away">{away.name || away.abbr} wins a close game</option> : null}
            {home ? <option value="close:home">{home.name || home.abbr} wins a close game</option> : null}
          </select>
        </label>
        <label>Game flow
          <select value={scriptMatchup ? flow : ''} aria-label="Game flow" disabled={!scriptMatchup} onChange={reset(setFlow)}>
            <option value="">No extra flow</option>
            {away ? <option value="early:away">{away.name || away.abbr} early lead</option> : null}
            {home ? <option value="early:home">{home.name || home.abbr} early lead</option> : null}
            <option value="shootout">Shootout</option>
            <option value="low">Defensive low-scoring</option>
            {away ? <option value="rush:away">{away.name || away.abbr} runs well</option> : null}
            {home ? <option value="rush:home">{home.name || home.abbr} runs well</option> : null}
            {away ? <option value="pass:away">{away.name || away.abbr} passes well</option> : null}
            {home ? <option value="pass:home">{home.name || home.abbr} passes well</option> : null}
          </select>
        </label>
      </fieldset>
      <label>Number of legs
        <input value={legs} onChange={reset(setLegs)} inputMode="numeric" aria-label="Number of legs" />
      </label>
      <label>Number of games
        <input value={games} onChange={reset(setGames)} inputMode="numeric" aria-label="Number of games" />
      </label>
      <label>Legs per game
        <input value={legsPerGame} onChange={reset(setLegsPerGame)} inputMode="numeric" placeholder="Optional" aria-label="Legs per game, optional" />
      </label>
      <label>Min American
        <input value={minOdds} onChange={reset(setMinOdds)} inputMode="text" placeholder="Optional, +200" aria-label="Minimum American odds" />
      </label>
      <label>Max American
        <input value={maxOdds} onChange={reset(setMaxOdds)} inputMode="text" placeholder="Optional, +600" aria-label="Maximum American odds" />
      </label>
      <fieldset className="custom-parlay-targets">
        <legend>Target odds <button type="button" onClick={() => { setTargets([]); setOption(0) }}>Clear</button></legend>
        {slotCount ? Array.from({ length: slotCount }, (_, index) => <label key={index}>Leg {index + 1}
          <input
            value={targets[index] || ''}
            onChange={event => {
              const next = targets.slice()
              next[index] = event.target.value
              setTargets(next)
              setOption(0)
            }}
            inputMode="text"
            placeholder="Optional"
            aria-label={`Leg ${index + 1} target odds`}
            aria-invalid={targetSlots.hints.includes(index) || undefined}
          />
          {targetSlots.hints.includes(index) ? <span className="custom-parlay-hint">Use −100 or lower, or +100 or higher.</span> : null}
        </label>) : <p className="custom-parlay-note">Enter a leg count to set target odds.</p>}
      </fieldset>
      <label>TD scorers
        <select value={tdMode} aria-label="Touchdown scorer mode" onChange={event => { setTdMode(event.target.value); setOption(0) }}>
          <option value="mix">Mix</option>
          <option value="confidence">Confidence</option>
          <option value="value">Value</option>
        </select>
      </label>
      <fieldset className="custom-parlay-include">
        <legend>Include</legend>
        <label><input type="checkbox" checked={types.outcome} onChange={toggleType('outcome')} />Game outcomes (ML or spread)</label>
        <label><input type="checkbox" checked={types.td} onChange={toggleType('td')} />Touchdown scorers</label>
        <label><input type="checkbox" checked={types.prop} onChange={toggleType('prop')} />Props</label>
      </fieldset>
      <label className="custom-parlay-value">
        <input type="checkbox" checked={valueMode} onChange={event => { setValueMode(event.target.checked); setOption(0) }} />
        Optimize for value
      </label>
      <label className="custom-parlay-value">
        <input type="checkbox" checked={mismatchesOnly} onChange={event => { setMismatchesOnly(event.target.checked); setOption(0) }} />
        Mismatches only
      </label>
      <label className="custom-parlay-value">
        <input type="checkbox" checked={instant} onChange={event => setInstant(event.target.checked)} />
        Show legs instantly
      </label>
      <div className="custom-parlay-generate">
        <button type="submit">Generate</button>
        <span>The result below updates as you change the controls. Generate jumps to it.</span>
      </div>
    </form>
    <p className="custom-parlay-mode">{!scriptMatchup && team === 'all'
      ? 'No game is being scripted. The parlay uses the model as it stands.'
      : valueMode
        ? 'Value ranks by expected profit per dollar: model probability times the decimal price, minus 1. A book −500 the model makes −220 is overvalued. A +150 the model makes +110 is undervalued. Mismatch touchdowns rank first. A touchdown with no line can still fill a leg.'
        : 'Confidence ranks the moneyline or spread model probability, the touchdown model, and each prop’s hit chance. Mix and Value still put mismatch touchdowns first.'}</p>
    <div id="parlay-result">
    {validation.note ? <p className="custom-parlay-note">{validation.note}</p> : null}
    {skippedNote ? <p className="custom-parlay-note">{skippedNote}</p> : null}
    {message ? <p className="custom-parlay-error" role="alert">{message}</p> : null}
    {parlay ? <article className="custom-parlay-card" aria-live="polite">
      <header>
        <div>
          <small>{index === 0 ? 'BEST MIX' : `NEXT BEST · ${index + 1} OF ${parlays.length}`}</small>
          <h4>{parlay.legs.length} legs across {parlay.games} {parlay.games === 1 ? 'game' : 'games'}{perGameSet ? ` · ${validation.input.legsPerGame} each` : ''}</h4>
        </div>
        <div className="custom-parlay-score">
          <strong>{formatChance(parlay.combined)}</strong>
          <small>Combined estimate</small>
          {parlay.priceText ? <small>Snapshot {parlay.priceText}</small> : null}
          {valueMode ? <small>EV {formatSignedChance(parlay.value)} per $1</small> : null}
        </div>
      </header>
      <Ticker legs={visibleLegs} active={building} />
      {groups.map(group => <div key={group.id} className="custom-parlay-game">
        <h5>{group.label}</h5>
        <ol>{group.legs.map(leg => <LegRow key={leg.id} leg={leg} />)}</ol>
      </div>)}
      {unpricedFill ? <p className="custom-parlay-note">A leg with no saved price is marked no line. Checked touchdown scorers are still included while Optimize for value is on.</p> : null}
      <div className="custom-parlay-actions">
        {building ? <button type="button" onClick={() => setShown(parlay.legs.length)}>Skip</button> : null}
        <button type="button" onClick={() => setOption(current => (Math.min(current, parlays.length - 1) + 1) % parlays.length)} disabled={parlays.length < 2}>
          {parlays.length < 2 ? 'Only mix that fits' : 'Next best'}
        </button>
      </div>
      <small className="custom-parlay-disclaimer">Estimates only. Same-game legs are not independent, so the combined figure is not a true parlay probability. Confirm status, lines, and odds with your sportsbook.</small>
    </article> : null}
    </div>
  </section>
}
