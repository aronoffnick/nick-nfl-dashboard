// Display rules for the Flyers board. buildFlyerThemes stays unfiltered so Parlays and
// other callers still see every Safe and Breakout theme.

export const MIN_SIMILARITY = 0.51
export const FLYER_MIN_HIT_RATE = 0.3
export const FLYER_RATE_EMPTY = 'No themes at 30%+ for this matchup'
export const FLYER_SIMILARITY_EMPTY = 'No close role match (51%+)'

export function similarityMeetsFloor(similarity) {
  return typeof similarity === 'number' && Number.isFinite(similarity) && similarity >= MIN_SIMILARITY
}

export function hitRateMeetsFlyerFloor(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= FLYER_MIN_HIT_RATE
}

// closestPlayer returns this. A match under the floor is removed rather than shown.
export function qualifyClosest(player) {
  if (!player || !similarityMeetsFloor(player.similarity)) return null
  return player
}

function passesTeam(row, teamFilter) {
  return teamFilter === 'all' || row.theme.offense.id === teamFilter
}

function passesPosition(row, positionFilter) {
  return positionFilter === 'all' || row.theme.position === positionFilter
}

// Themes with candidates but no 51% match are dropped. A theme with nobody to match
// still shows the existing "no current player" note when its hit rate qualifies.
function passesSimilarity(row) {
  if (!row.theme.candidates?.length) return true
  return similarityMeetsFloor(row.view?.closest?.similarity)
}

export function flyerRowVisible(row) {
  return hitRateMeetsFlyerFloor(row.view?.rate) && passesSimilarity(row)
}

export function selectFlyerRows(rows, {teamFilter = 'all', positionFilter = 'all'} = {}) {
  const scoped = rows.filter(row => passesTeam(row, teamFilter) && passesPosition(row, positionFilter))
  return {shown: scoped.filter(flyerRowVisible), scoped}
}

export function flyersEmptyNote({shown, matchupRows, scoped, teamFilter = 'all', positionFilter = 'all'}) {
  if (shown.length) return null
  if (!matchupRows.some(row => hitRateMeetsFlyerFloor(row.view?.rate))) return FLYER_RATE_EMPTY
  const filtersOn = teamFilter !== 'all' || positionFilter !== 'all'
  const scopedAtRate = scoped.filter(row => hitRateMeetsFlyerFloor(row.view?.rate))
  if (filtersOn && !scopedAtRate.length) return 'No themes match these filters.'
  if (scopedAtRate.length) return FLYER_SIMILARITY_EMPTY
  return 'No themes match these filters.'
}

export function flyerRemovalCounts(rows) {
  let removedForHitRate = 0
  let removedForSimilarity = 0
  let shown = 0
  for (const row of rows) {
    if (!hitRateMeetsFlyerFloor(row.view?.rate)) removedForHitRate += 1
    else if (!passesSimilarity(row)) removedForSimilarity += 1
    else shown += 1
  }
  return {before: rows.length, shown, removedForHitRate, removedForSimilarity, removed: rows.length - shown}
}
