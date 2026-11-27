import { useEffect, useMemo, useState } from 'react'
import { mergeOdds } from '../matchupValue.js'
import { fileForWeek } from '../data/weekFiles.js'
import { projectTeam } from './model.js'
import { getRosters } from './data.js'
import { boardFor } from './gameBoard.js'
import { boardGame, normName } from './parlayBoard.js'
import { buildGameScript, scriptSummary, selectionFromChoices } from './gameScript.js'
import { scatterAbbrev } from './scatterCheck.js'
import {
  americanBounds,
  applyGameScript,
  buildCustomParlays,
  filterPools,
  formatChance,
  formatSignedChance,
  outcomeCandidates,
  propCandidates,
  seasonTdShare,
  touchdownCandidate,
  touchdownPrices,
  validateCustomParlay,
} from './customParlay.js'
import './customParlay.css'

const EMPTY_TYPES = { outcome: true, td: true, prop: true }
const SNAPSHOT_NOTE = 'Unstarted games only. Prices are a static snapshot, not live odds. A getoddy moneyline is kept when one was already saved. Otherwise the price is the ESPN scoreboard odds snapshot.'

function valueDetail(leg) {
  if (leg.type === 'outcome') return `Kelly ${formatSignedChance(leg.kelly)} · edge ${formatSignedChance(leg.edge)}`
  if (leg.priced) return `Edge vs price ${formatSignedChance(leg.edge)}`
  return 'No snapshot price'
}

function LegRow({ leg, showValue }) {
  const pct = Math.max(0, Math.min(100, Math.round((leg.confidence || 0) * 100)))
  return <li className="custom-parlay-leg">
    {leg.logo ? <img className="custom-parlay-logo" src={leg.logo} alt="" /> : <span className="custom-parlay-logo custom-parlay-logo-fallback" aria-hidden="true">{leg.team || '•'}</span>}
    <div className="custom-parlay-copy">
      <span className="custom-parlay-kicker">{leg.subtitle}</span>
      <strong>{leg.title}{leg.arrow ? <i className={leg.arrow === 'down' ? 'custom-parlay-down' : 'custom-parlay-up'} aria-label={leg.arrow === 'down' ? 'Script moves this down' : 'Script moves this up'}>{leg.arrow === 'down' ? ' ↓' : '↑'}</i> : null}</strong>
      {leg.detail ? <span className="custom-parlay-detail">{leg.detail}</span> : null}
      {leg.scriptNote ? <span className="custom-parlay-detail">{leg.scriptNote}</span> : null}
    </div>
    <div className="custom-parlay-confidence" role="img" aria-label={`${formatChance(leg.confidence)} confidence for ${leg.title}`}>
      <strong>{formatChance(leg.confidence)}</strong>
      <span className="custom-parlay-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <small>{showValue ? valueDetail(leg) : 'Confidence'}</small>
    </div>
  </li>
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
  const pools = useMemo(() => {
    const prop = propCandidates(odds.parlays, slate)
    const prices = touchdownPrices(odds.touchdowns)
    const td = []
    const activeRoster = loadedRoster
    if (activeRoster) {
      for (const game of slate) {
        for (const [side, opponent] of [[game.away, game.home], [game.home, game.away]]) {
          for (const player of projectTeam(data, side, opponent, activeRoster, halfLife, null)) {
            if (player.unavailable) continue
            const share = seasonTdShare(player.logs, halfLife)
            if (share.rate == null || share.n < 3 || share.rate <= 0) continue
            td.push(touchdownCandidate({
              game,
              player,
              share,
              team: side,
              price: prices.get(normName(player.name)) ?? null,
            }))
          }
        }
      }
    }
    return { td, prop }
  }, [slate, odds, loadedRoster, data, halfLife])
  const selection = useMemo(() => selectionFromChoices(outcome, flow, {
    awayId: away?.id, homeId: home?.id,
  }), [outcome, flow, away?.id, home?.id])
  const script = useMemo(() => {
    if (!scriptMatchup) return { active: false, props: [], summary: '' }
    const lines = boardGame(fileForWeek('parlays', data?.week), scriptMatchup.away.abbr, scriptMatchup.home.abbr)?.legs || []
    const players = loadedRoster ? boardFor(data, scriptMatchup, loadedRoster, halfLife, window).players : []
    return buildGameScript({ matchup: scriptMatchup, players, selection, halfLife, lines })
  }, [data, scriptMatchup, loadedRoster, halfLife, window, selection])
  const readyPools = useMemo(() => {
    const picked = team === 'all' ? null : team
    const filtered = filterPools({
      outcome: outcomeCandidates(slate, odds.merged, picked),
      td: pools.td,
      prop: pools.prop,
    }, picked)
    return script.active ? applyGameScript(filtered, { props: script.props, selection, matchup: scriptMatchup }) : filtered
  }, [team, pools.td, pools.prop, slate, odds.merged, script, selection, scriptMatchup])
  const built = useMemo(() => (
    validation.ok && oddsCheck.ok
      ? buildCustomParlays(readyPools, validation.input, { mode: valueMode ? 'value' : 'confidence', oddsRange: oddsCheck.range })
      : null
  ), [validation, oddsCheck, readyPools, valueMode])
  const parlays = built?.parlays || []
  const index = parlays.length ? Math.min(option, parlays.length - 1) : 0
  const parlay = parlays[index] || null
  const message = !oddsCheck.ok ? oddsCheck.message : !validation.ok ? validation.message : built?.reason
  const groups = []
  if (parlay) {
    for (const leg of parlay.legs) {
      let group = groups.find(item => item.id === leg.gameId)
      if (!group) {
        group = { id: leg.gameId, label: leg.gameLabel, legs: [] }
        groups.push(group)
      }
      group.legs.push(leg)
    }
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
  function chooseScriptGame(event) {
    setScriptGameId(event.target.value)
    setOutcome('')
    setFlow('')
    setOption(0)
  }

  return <section className="custom-parlay" id="parlay-generator" aria-label="Bet generator" data-custom-parlay>
    <div className="custom-parlay-title"><h3>Bet generator</h3><span>Week {data?.week} · {summary}</span></div>
    <p className="custom-parlay-help">Pick a team, or all of them, then how that game goes. Legs, games, and the checked types fill one parlay across this week’s unstarted games. Leave legs per game blank for no per-game limit. Leave the odds blank to skip a price filter. A scripted prop shows an up or down arrow.</p>
    <p className="custom-parlay-note">{SNAPSHOT_NOTE}</p>
    <form className="custom-parlay-form" onSubmit={event => event.preventDefault()}>
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
    </form>
    <p className="custom-parlay-mode">{!scriptMatchup && team === 'all'
      ? 'No game is being scripted. The parlay uses the model as it stands.'
      : valueMode
        ? 'Value ranks outcomes by Kelly and ranks a prop or touchdown by its hit chance minus the implied probability when a snapshot price exists.'
        : 'Confidence ranks the moneyline or spread model probability, the season-weighted touchdown rate, and each prop’s hit chance.'}</p>
    {validation.note ? <p className="custom-parlay-note">{validation.note}</p> : null}
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
          {valueMode ? <small>Value {formatSignedChance(parlay.value)}</small> : null}
        </div>
      </header>
      {groups.map(group => <div key={group.id} className="custom-parlay-game">
        <h5>{group.label}</h5>
        <ol>{group.legs.map(leg => <LegRow key={leg.id} leg={leg} showValue={valueMode} />)}</ol>
      </div>)}
      {unpricedFill ? <p className="custom-parlay-note">Props and touchdowns in this mix have no snapshot price, so they break ties by hit chance. Outcomes are weighted by Kelly.</p> : null}
      <div className="custom-parlay-actions">
        <button type="button" onClick={() => setOption(current => (Math.min(current, parlays.length - 1) + 1) % parlays.length)} disabled={parlays.length < 2}>
          {parlays.length < 2 ? 'Only mix that fits' : 'Next best'}
        </button>
      </div>
      <small className="custom-parlay-disclaimer">Estimates only. Same-game legs are not independent, so the combined figure is not a true parlay probability. Confirm status, lines, and odds with your sportsbook.</small>
    </article> : null}
  </section>
}
