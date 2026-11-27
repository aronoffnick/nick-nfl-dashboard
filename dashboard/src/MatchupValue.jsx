import { gradeValuePick } from './matchupValue.js'

const DOTS = [1, 2, 3]

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
function points(edge) {
  if (!Number.isFinite(edge)) return '—'
  const text = (edge * 100).toFixed(1)
  return `${edge >= 0 ? '+' : ''}${text} pts`
}
function sideText(row) {
  if (!row) return 'no saved price'
  return `${row.abbr} edge ${points(row.edge)} vs the no-vig line, Kelly ${percent(row.kelly)}`
}

export function ValueBadge({ value, game }) {
  if (!value || value.noLine) return <span className="value-empty">no line</span>
  if (!value.show) return <span className="value-empty" aria-label="No meaningful value">–</span>
  const grade = gradeValuePick(value, game)
  const tone = grade === 'win' ? 'is-win' : grade === 'loss' ? 'is-loss' : ''
  const marketLabel = value.market === 'ATS' ? 'Against the spread' : 'Moneyline'
  return <span className={`value-badge ${tone}`} aria-label={`${marketLabel} value on ${value.abbr}, strength ${value.dots} of 3`}>
    <span className="value-tag">{value.market}</span>
    <span className="value-team">{value.abbr}</span>
    <span className="value-dots" aria-hidden="true">{DOTS.map(dot => <i key={dot} className={dot <= value.dots ? 'on' : ''} />)}</span>
  </span>
}

export function ValueHelp({ meta, matchups, byId }) {
  const priced = Boolean(meta?.matched && meta?.asOf)
  return <details className="value-help">
    <summary>How value is calculated</summary>
    <div>
      <p>Each matchup is scored twice, once on the moneyline and once against the spread. The card keeps only the side with the better risk-adjusted score. It does not average them.</p>
      <p>The win chance is the dashboard’s existing curve on the projected margin: one divided by one plus e to the minus margin over 7. A seven-point favorite is about 73%. A margin under 0.05 is 50/50. The spread chance is that same curve on the projected home margin plus the home number.</p>
      <p>The American price becomes an implied probability. The juice comes off by dividing each side by the sum of both sides, so the fair chances add to 100%. The edge is the model chance minus that no-vig chance. The risk-adjusted score is the Kelly fraction at the price on the snapshot: model chance times the decimal odds, minus one, divided by the decimal odds minus one. That is the fraction of a bankroll the edge is worth after the payout and the juice. An edge smaller than the juice scores at or below zero and is not shown.</p>
      <p>Dots use that Kelly fraction. Nothing under 3%. One dot from 3% up to 10%. Two dots from 10% up to 20%. Three dots at 20% or more. The tag is ML or ATS, whichever fraction is higher, next to the team it favors.</p>
      <p>{priced ? `The moneyline and the spread come from the saved ${meta.source || 'ESPN scoreboard odds'} snapshot for week ${meta.week}${meta.book ? ` (${meta.book})` : ''}, as of ${meta.asOf}.` : 'No odds snapshot is saved for this week.'} A game that snapshot does not include can still use a structured moneyline already saved on that week’s parlay file. The written-out spread sentence in that file is not read. These are not live lines. A game with neither price says “no line.” A dash means a line is saved and the better score is under 3%.</p>
      <p>After a game is final, the model-pick bar is green when that team won and red when it lost. A tie or a toss-up stays unshaded. Best value is graded on the one line it showed, straight up for a moneyline and against the number for a spread. Explore stays the accent button either way.</p>
      <p className="muted">Entertainment, not betting advice.</p>
      {priced && <ul>{(matchups || []).map(game => {
        const value = byId?.[game.id]
        const shown = !value || value.noLine ? 'no line' : value.show ? `Showing ${value.market} ${value.abbr}.` : 'Neither clears 3%, so the cell is a dash.'
        const stamp = value?.asOf ? ` ${value.source || 'Snapshot'} ${value.asOf}${value.book ? `, ${value.book}` : ''}.` : ''
        return <li key={game.id}>{game.away.abbr} at {game.home.abbr}: ML {sideText(value?.ml)}. ATS {sideText(value?.ats)}. {shown}{stamp}</li>
      })}</ul>}
    </div>
  </details>
}
