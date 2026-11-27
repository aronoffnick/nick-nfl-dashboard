import { useMemo, useState } from 'react'
import { mergeOdds } from '../matchupValue.js'
import { fileForWeek } from '../data/weekFiles.js'
import { projectTeam } from './model.js'
import { boardFor } from './gameBoard.js'
import { boardGame, normName } from './parlayBoard.js'
import { buildGameScript, scriptSummary, selectionFromChoices } from './gameScript.js'
import {
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
      <strong>{leg.title}{leg.arrow ? <i className={leg.arrow === 'down' ? 'custom-parlay-down' : 'custom-parlay-up'} aria-label={leg.arrow === 'down' ? 'Script moves this down' : 'Script moves this up'}>{leg.arrow === 'down' ? ' ↓' : ' ↑'}</i> : null}</strong>
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

export default function CustomParlay({ data, matchup, matchups, roster, halfLife, window }) {
  const slate = useMemo(() => (matchups?.length ? matchups : (matchup ? [matchup] : [])), [matchups, matchup])
  const [legs, setLegs] = useState('4')
  const [games, setGames] = useState('2')
  const [legsPerGame, setLegsPerGame] = useState('')
  const [types, setTypes] = useState(EMPTY_TYPES)
  const [team, setTeam] = useState('both')
  const [outcome, setOutcome] = useState('')
  const [flow, setFlow] = useState('')
  const [valueMode, setValueMode] = useState(false)
  const [option, setOption] = useState(0)
  const reset = setter => event => { setter(event.target.value); setOption(0) }
  const toggleType = key => event => { setTypes(current => ({ ...current, [key]: event.target.checked })); setOption(0) }

  const validation = useMemo(() => validateCustomParlay({ legs, games, legsPerGame, types }), [legs, games, legsPerGame, types])
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
    if (roster) {
      for (const game of slate) {
        if (game?.started || game?.final || !game?.away?.id || !game?.home?.id) continue
        for (const [team, opponent] of [[game.away, game.home], [game.home, game.away]]) {
          for (const player of projectTeam(data, team, opponent, roster, halfLife, null)) {
            if (player.unavailable) continue
            const share = seasonTdShare(player.logs, halfLife)
            if (share.rate == null || share.n < 3 || share.rate <= 0) continue
            td.push(touchdownCandidate({
              game,
              player,
              share,
              team,
              price: prices.get(normName(player.name)) ?? null,
            }))
          }
        }
      }
    }
    return { td, prop }
  }, [slate, odds, roster, data, halfLife])
  const selection = useMemo(() => selectionFromChoices(outcome, flow, {
    awayId: matchup?.away?.id, homeId: matchup?.home?.id,
  }), [outcome, flow, matchup?.away?.id, matchup?.home?.id])
  const script = useMemo(() => {
    const lines = boardGame(fileForWeek('parlays', data?.week), matchup?.away?.abbr, matchup?.home?.abbr)?.legs || []
    const players = roster && matchup ? boardFor(data, matchup, roster, halfLife, window).players : []
    return buildGameScript({ matchup, players, selection, halfLife, lines })
  }, [data, matchup, roster, halfLife, window, selection])
  const readyPools = useMemo(() => {
    const picked = team === 'both' ? null : team
    const filtered = filterPools({
      outcome: outcomeCandidates(slate, odds.merged, picked),
      td: pools.td,
      prop: pools.prop,
    }, picked)
    return script.active ? applyGameScript(filtered, { props: script.props, selection, matchup }) : filtered
  }, [team, pools.td, pools.prop, slate, odds.merged, script, selection, matchup])
  const built = useMemo(() => (
    validation.ok ? buildCustomParlays(readyPools, validation.input, { mode: valueMode ? 'value' : 'confidence' }) : null
  ), [validation, readyPools, valueMode])
  const parlays = built?.parlays || []
  const index = parlays.length ? Math.min(option, parlays.length - 1) : 0
  const parlay = parlays[index] || null
  const message = validation.ok ? built?.reason : validation.message
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

  const away = matchup?.away
  const home = matchup?.home
  return <section className="custom-parlay" id="parlay-generator" aria-label="Bet generator" data-custom-parlay>
    <div className="prop-section-title"><h3>Bet generator</h3><span>Week {data?.week} · {script.active ? scriptSummary(selection, matchup) : 'One parlay from these controls'}</span></div>
    <p className="custom-parlay-help">Team, predicted flow, leg types, and the leg counts feed one parlay. Leave legs per game blank to spread legs across the games with no per-game limit. A checked type is included at least once when the leg count allows. The flow uses the game-script adjustment, so a moved prop shows an up or down arrow.</p>
    <form className="custom-parlay-form" onSubmit={event => event.preventDefault()}>
      <label>Team
        <select value={team} aria-label="Team" onChange={reset(setTeam)}>
          <option value="both">Both teams</option>
          {away ? <option value={away.abbr}>{away.name}</option> : null}
          {home ? <option value={home.abbr}>{home.name}</option> : null}
        </select>
      </label>
      <fieldset className="custom-parlay-flow">
        <legend>How will the game go?</legend>
        <label>Predicted outcome
          <select value={outcome} aria-label="Predicted outcome" onChange={reset(setOutcome)}>
            <option value="">No outcome lean</option>
            {away ? <option value="win:away">{away.name} wins</option> : null}
            {home ? <option value="win:home">{home.name} wins</option> : null}
            {away ? <option value="big:away">{away.name} wins big or covers</option> : null}
            {home ? <option value="big:home">{home.name} wins big or covers</option> : null}
            {away ? <option value="close:away">{away.name} wins a close game</option> : null}
            {home ? <option value="close:home">{home.name} wins a close game</option> : null}
          </select>
        </label>
        <label>Game flow
          <select value={flow} aria-label="Game flow" onChange={reset(setFlow)}>
            <option value="">No extra flow</option>
            {away ? <option value="early:away">{away.name} early lead</option> : null}
            {home ? <option value="early:home">{home.name} early lead</option> : null}
            <option value="shootout">Shootout</option>
            <option value="low">Defensive low-scoring</option>
            {away ? <option value="rush:away">{away.name} runs well</option> : null}
            {home ? <option value="rush:home">{home.name} runs well</option> : null}
            {away ? <option value="pass:away">{away.name} passes well</option> : null}
            {home ? <option value="pass:home">{home.name} passes well</option> : null}
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
    <p className="custom-parlay-mode">{valueMode
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
