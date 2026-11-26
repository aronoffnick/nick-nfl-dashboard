export function pct1(value) {
  return value == null || Number.isNaN(Number(value)) ? '—' : `${(Math.round(Number(value) * 1000) / 10).toFixed(1)}%`
}

function centerText(value) {
  const rounded = Math.round(Number(value) * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function leanOf(leg) {
  if (leg?.center == null || leg?.line == null) return null
  const side = String(leg.side || '').toLowerCase()
  if (side === 'over' && Number(leg.center) < Number(leg.line)) return 'under'
  if (side === 'under' && Number(leg.center) > Number(leg.line)) return 'over'
  return null
}

function teamOf(abbr, teams) {
  return teams?.[abbr] || { abbr, name: abbr, logo: null }
}

export function fileLegView(leg, teams = {}) {
  const moneyline = leg.market === 'ML' || leg.pos === 'TEAM'
  const team = teamOf(leg.team, teams)
  const model = leg.center == null ? '' : `${centerText(leg.center)} ${leg.center_kind || ''}`.trim()
  return {
    id: leg.label || `${leg.player}:${leg.market}:${leg.line}`,
    label: leg.label || leg.player,
    name: moneyline ? team.name : leg.player,
    kind: moneyline ? 'team' : 'player',
    team,
    market: leg.market === 'TD' ? 'anytime TD' : leg.market,
    side: String(leg.side || '').toLowerCase(),
    line: leg.line,
    quote: leg.price_str || [leg.price, leg.book].filter(Boolean).join(' '),
    model,
    lean: leanOf(leg),
    hit: leg.p,
    marketHit: leg.market_p == null && leg.p_market == null ? null : pct1(leg.market_p ?? leg.p_market),
    season: leg.season || '',
    why: leg.coverage && leg.coverage !== 'n/a' ? leg.coverage : '',
    flags: leg.flags || '',
  }
}

function variantNote(title, variant) {
  if (!variant?.legs?.length) return ''
  const names = variant.legs.map(leg => leg.label).join(' + ')
  const market = variant.combined_at_market_win == null ? '' : ` At the market win chance, ${pct1(variant.combined_at_market_win)}.`
  return `${title}: ${names} = ${pct1(variant.combined)}, ${variant.payout}.${market}`
}

function altNote(alt) {
  if (!alt?.legs?.length) return ''
  return `Alt: ${alt.legs.map(leg => leg.label).join(' + ')} = ${pct1(alt.combined)}, ${alt.payout}.`
}

function signed(value) {
  const rounded = Math.round(Number(value) * 100) / 100
  if (!Number.isFinite(rounded)) return ''
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`
}

function scriptNote(parlay) {
  const script = parlay?.script
  if (!script) return ''
  const [rush, rushN] = script.leg1_vs_own_margin || []
  const [catchR, catchN] = script.leg2_vs_own_margin || []
  const parts = []
  if (rush != null) parts.push(`${script.favored} rush tracks its own margin ${signed(rush)} over ${rushN} games`)
  if (catchR != null) parts.push(`${script.trailing} receptions track its own margin ${signed(catchR)} over ${catchN} games`)
  return parts.length ? `Script: ${parts.join('; ')}.` : ''
}

function cardFrom(title, parlay, teams) {
  if (!parlay?.legs?.length) return { title, legs: [], why: 'This category is not in the week file.', joint: null }
  const notes = [
    variantNote('Team-win variant', parlay.team_win_variant),
    variantNote('Shorter variant', parlay.two_leg_variant),
    scriptNote(parlay),
    ...(parlay.alternatives || []).map(altNote),
  ].filter(Boolean)
  return {
    title,
    fromFile: true,
    legs: parlay.legs.map(leg => fileLegView(leg, teams)),
    joint: parlay.combined,
    independent: parlay.independent,
    payout: parlay.payout,
    why: parlay.rule || '',
    notes,
  }
}

export function cardsFromParlayFile(game, teams = {}) {
  const away = game?.away
  const home = game?.home
  const parlays = game?.parlays || {}
  return [
    cardFrom('Overall favorite', parlays.favorite, teams),
    cardFrom(`${away} correlated`, parlays[`team_${away}`], teams),
    cardFrom(`${home} correlated`, parlays[`team_${home}`], teams),
    cardFrom('Game-script mix', parlays.mix, teams),
  ]
}

export function parlayIntro(file, game) {
  const disclaimer = file?.disclaimer || 'Model estimates from a static snapshot. Entertainment, not advice.'
  const props = game?.snapshot?.props_asof
  const line = game?.snapshot?.game_asof
  const when = [props && `props ${props}`, line && `game line ${line}`].filter(Boolean).join('; ')
  return `${disclaimer}${when ? ` Snapshot: ${when}.` : ''}`
}
