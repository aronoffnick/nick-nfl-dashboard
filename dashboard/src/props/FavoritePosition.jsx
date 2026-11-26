import { useMemo } from 'react'
import { projectTeam } from './model.js'
import { roleBookForWeek } from '../data/weekFiles.js'
import { FAVORITE_NOTE, FAVORITE_RULE, favoriteForTeam } from './favoritePosition.js'

const yards = value => value.toFixed(1)
const percent = share => `${Math.round(share * 100)}%`
function yardTitle(player) {
  const parts = []
  if (player.rush != null) parts.push(`${yards(player.rush)} rush`)
  if (player.rec != null) parts.push(`${yards(player.rec)} receiving`)
  return parts.length ? `Projected ${parts.join(' + ')}` : 'Projected rush yards plus receiving yards'
}

function TeamRow({ row }) {
  const label = row.position ? `${row.team.abbr} favorite position ${row.position}` : `${row.team.abbr} favorite position unavailable`
  return <article className="favorite-row" aria-label={label}>
    <div className="favorite-team">
      {row.team.logo ? <img src={row.team.logo} alt="" width="22" height="22" /> : null}
      <b>{row.team.abbr}</b>
      {row.position ? <>
        <span className="favorite-pos">{row.position}</span>
        <span className="favorite-share">{percent(row.share)} of proj. yards</span>
      </> : <span className="favorite-share">No projection</span>}
    </div>
    {row.position ? <div className="favorite-players-wrap">
      <ol className="favorite-players">
        {row.players.map(player => <li key={player.id}>
          <span className="fp-rank">{player.rank}</span>
          <span className="fp-name">{player.name}{player.rosterPosition === 'FB' ? <em className="fp-fb">FB</em> : null}{player.flag ? <em className="favorite-flag">{player.flag}</em> : null}</span>
          <span className="fp-yds" title={yardTitle(player)}>{yards(player.yards)} yd</span>
        </li>)}
      </ol>
      {row.available < 3 ? <p className="favorite-short">{row.available === 1 ? '1 projected player' : `${row.available} projected players`} at {row.position}.</p> : null}
    </div> : <p className="favorite-short">{row.reason}</p>}
  </article>
}

export default function FavoritePosition({ data, matchup, roster, halfLife, lookback }) {
  const view = useMemo(() => {
    const sheet = roleBookForWeek(data.week)
    const rows = [[matchup.away, matchup.home], [matchup.home, matchup.away]].map(([team, opponent]) => {
      const players = projectTeam(data, team, opponent, roster, halfLife, lookback)
      return favoriteForTeam(team, players, sheet)
    })
    return { sheet, rows }
  }, [data, matchup, roster, halfLife, lookback])
  return <section className="favorite-position" aria-label="Favorite position">
    <div className="prop-section-title"><h3>Favorite position</h3><span>This matchup · both teams</span></div>
    <p className="favorite-note">{FAVORITE_NOTE}</p>
    {!view.sheet.matched && <p className="prop-warning">No WR/RB role sheet is loaded for Week {data.week}. Unavailable players are still excluded. The role gate is not removing anyone else.</p>}
    <div className="favorite-rows">
      {view.rows.map(row => <TeamRow key={row.team.id} row={row} />)}
    </div>
    <details className="favorite-method">
      <summary>How favorite position is chosen</summary>
      <p>{FAVORITE_RULE}</p>
      <p>{view.sheet.matched ? `Role sheet in use: Week ${view.sheet.week}.` : `Week ${data.week} has no WR/RB role sheet in the app, so wide receivers and running backs are not filtered by starter rank.`}</p>
    </details>
  </section>
}
