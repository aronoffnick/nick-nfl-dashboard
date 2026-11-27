import { useMemo, useState } from 'react'
import { fileForWeek } from '../data/weekFiles.js'
import { boardGame } from './parlayBoard.js'
import { boardFor } from './gameBoard.js'
import { valid } from './model.js'
import { buildGameScript, emptyScript, scriptActive, toggleScript } from './gameScript.js'
import './gameScript.css'

const TEAM_ACTIONS = [
  ['win', 'Wins'],
  ['big', 'Wins big'],
  ['close', 'Close game'],
  ['early', 'Early lead'],
  ['rush', 'Rushing success'],
  ['pass', 'Passing success'],
]

function formatStat(value, key) {
  if (!valid(value)) return '—'
  return Number(value).toFixed(String(key).includes('TD') ? 2 : 1)
}

function pressed(selection, action, teamId) {
  if (action === 'win') return selection.win === teamId && selection.margin == null
  if (action === 'big') return selection.win === teamId && selection.margin === 'big'
  if (action === 'close') return selection.win === teamId && selection.margin === 'close'
  return selection[action] === teamId
}

function fitDots(label) {
  const count = label === 'Strong' ? 3 : label === 'Moderate' ? 2 : 1
  return count
}

function Logo({ team }) {
  if (team?.logo) return <img src={team.logo} alt="" />
  return <span className="script-logo-fallback" aria-hidden="true">{team?.abbr || '?'}</span>
}

function ScriptChip({ pressed: on, onClick, children }) {
  return <button type="button" className={on ? 'script-chip on' : 'script-chip'} aria-pressed={on} onClick={onClick}>{children}</button>
}

function TeamCard({ team, selection, onToggle }) {
  return <article className="script-team">
    <header>
      <Logo team={team} />
      <div><strong>{team.abbr}</strong><span>{team.name}</span></div>
    </header>
    <div className="script-chips">
      {TEAM_ACTIONS.map(([action, label]) => (
        <ScriptChip key={action} pressed={pressed(selection, action, team.id)} onClick={() => onToggle(action, team.id)}>{label}</ScriptChip>
      ))}
    </div>
  </article>
}

function PropRow({ prop }) {
  const dots = fitDots(prop.fitLabel)
  const line = prop.line == null ? 'No line' : `${prop.lineSource === 'snapshot' ? 'Line' : 'Model line'} ${formatStat(prop.line, prop.key)}`
  return <article className="script-prop" aria-label={`${prop.name} ${prop.direction} ${prop.statLabel}, script ${formatStat(prop.scenario, prop.key)} ${prop.arrow} from ${formatStat(prop.baseline, prop.key)}`}>
    <div className="script-prop-id">
      <Logo team={prop.team} />
      <div>
        <strong>{prop.name}</strong>
        <span>{prop.team.abbr} · {prop.role}</span>
      </div>
    </div>
    <div className="script-prop-play">
      <b className={prop.direction === 'under' ? 'script-under' : 'script-over'}>{prop.direction}</b>
      <span>{prop.statLabel}</span>
      <span>{line}</span>
    </div>
    <div className="script-prop-nums">
      <strong>
        <span>{formatStat(prop.scenario, prop.key)}</span>
        <i className={prop.arrow === 'down' ? 'script-down' : 'script-up'} aria-hidden="true">{prop.arrow === 'down' ? '↓' : '↑'}</i>
      </strong>
      <span>from {formatStat(prop.baseline, prop.key)}</span>
    </div>
    <div className={`script-fit script-fit-${prop.fitLabel.toLowerCase()}`}>
      <span className="script-dots" aria-hidden="true">{[0, 1, 2].map(index => <i key={index} className={index < dots ? 'on' : ''} />)}</span>
      {prop.fitLabel} fit
    </div>
    <p>{prop.why}</p>
  </article>
}

function LegRow({ leg }) {
  if (leg.kind === 'team') {
    return <li>
      <Logo team={leg.team} />
      <div>
        <strong>{leg.team.abbr} to win</strong>
        <em>{leg.why}</em>
      </div>
    </li>
  }
  const shown = leg.line == null ? leg.direction : `${leg.direction} ${formatStat(leg.line, leg.key)}`
  return <li>
    <Logo team={leg.team} />
    <div>
      <strong>{leg.name} {shown} {leg.statLabel}</strong>
      <em>{leg.why}</em>
    </div>
  </li>
}

function ParlayCard({ parlay }) {
  const average = Math.round(parlay.legs.reduce((sum, leg) => sum + leg.fit, 0) / parlay.legs.length)
  return <article className="script-card">
    <header><h4>{parlay.title}</h4><span>{average} fit</span></header>
    <ol>{parlay.legs.map(leg => <LegRow key={leg.id} leg={leg} />)}</ol>
  </article>
}

export default function GameScript({ data, matchup, roster, halfLife, window, embedded = false }) {
  const [selection, setSelection] = useState(emptyScript)
  const players = useMemo(() => {
    if (!roster) return []
    return boardFor(data, matchup, roster, halfLife, window).players
  }, [data, matchup, roster, halfLife, window])
  const lines = useMemo(() => {
    const file = fileForWeek('parlays', data?.week)
    return boardGame(file, matchup.away.abbr, matchup.home.abbr)?.legs || []
  }, [data?.week, matchup.away.abbr, matchup.home.abbr])
  const result = useMemo(() => buildGameScript({
    matchup, players, selection, halfLife, lines,
  }), [matchup, players, selection, halfLife, lines])
  const favoriteReady = Boolean(matchup.winner && matchup.margin >= 0.5)
  function onToggle(action, teamId) {
    setSelection(current => toggleScript(current, action, teamId))
  }
  function useFavorite() {
    if (!favoriteReady) return
    const margin = matchup.margin >= 7 ? 'big' : matchup.margin <= 3 ? 'close' : null
    setSelection({ ...emptyScript(), win: matchup.winner.id, margin })
  }
  return <section className={embedded ? 'script-panel script-panel-embedded' : 'script-panel'} aria-label="Game script">
    <div className="prop-section-title">
      <h3>Game script</h3>
      <span>{result.active ? result.summary : 'Pick the game you expect'}</span>
    </div>
    <p className="script-note">{result.note} The numbers start from the season projection (recent games count more, then the defense factor) and move only for the script you select.</p>
    <div className="script-teams">
      {[matchup.away, matchup.home].map(team => (
        <TeamCard key={team.id} team={team} selection={selection} onToggle={onToggle} />
      ))}
    </div>
    <div className="script-environment">
      <span>Scoring</span>
      <ScriptChip pressed={selection.scoring === 'shootout'} onClick={() => onToggle('shootout')}>Shootout</ScriptChip>
      <ScriptChip pressed={selection.scoring === 'low'} onClick={() => onToggle('low')}>Low-scoring</ScriptChip>
      <button type="button" className="script-text" onClick={useFavorite} disabled={!favoriteReady}>Start from the model favorite</button>
      <button type="button" className="script-text" onClick={() => setSelection(emptyScript())} disabled={!scriptActive(selection)}>Clear</button>
    </div>
    {result.active ? <>
      <div className="prop-section-title"><h3>Props that fit</h3><span>Ranked by how hard the script moves them</span></div>
      {result.props.length ? <div className="script-props">{result.props.map(prop => <PropRow key={prop.id} prop={prop} />)}</div> : <p className="script-empty">This script does not move any projected prop enough to rank.</p>}
      <div className="prop-section-title"><h3>Correlated parlays</h3><span>Top legs, none repeated</span></div>
      {result.parlays.length ? <div className="script-parlays">{result.parlays.map(parlay => <ParlayCard key={parlay.id} parlay={parlay} />)}</div> : <p className="script-empty">Not enough separate legs for a parlay.</p>}
    </> : <p className="script-empty">Choose a script. A win, a halftime lead, a rushing or passing day, and the scoring environment can be combined.</p>}
    <details className="prop-method">
      <summary>How the script adjustment works</summary>
      <p>Each prop starts at the same projection as Player Projections: a recency-weighted season rate, times the opponent's position factor. Pass attempts use that pass-yards factor. Rush attempts use the rush-yards factor. The script then multiplies the projection. A lead raises the lead back's rush attempts and yards and lowers his quarterback's pass attempts. The trailing side goes the other way: more pass attempts, yards, and catches, fewer rush attempts. Rushing success raises the back's yards and touchdowns and the opponent's pass volume. Passing success raises the quarterback's yards and touchdowns and the top receiver and tight end. A shootout raises both quarterbacks and both WR1s. A low score does the reverse. The lead back, quarterback, WR1, and tight end get the full move. A backup gets a fraction of it, from his share of that stat. If several pieces point the same way, the biggest one counts in full and the rest count at about half, and the total move stays inside 32%. The arrow is the script versus that baseline. Over or under follows the line when a saved line exists. Fit is higher when the move is larger, the role is clearer, and the player has more recorded games. This is a model scenario estimate, not a guarantee, and it is not a sportsbook price.</p>
    </details>
  </section>
}
