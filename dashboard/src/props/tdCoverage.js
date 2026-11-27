// Coverage adjustment for the Touchdowns board. The on-disk risk scale is unchanged.
// Missing coverage files, a missing mix, or no 2025 sample leave the probability alone.

const MAN_KEYS = ['COVER_0', 'COVER_1', '2_MAN']

export function normCoverageName(value) {
  return String(value || '').toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(part => part && !/^(jr|sr|ii|iii|iv|v)$/.test(part)).join(' ')
}

export function lambdaFromAnytime(prob) {
  const p = Number(prob)
  if (!Number.isFinite(p) || p <= 0) return 0
  if (p >= 1) return 50
  return -Math.log(1 - p)
}

export function probAtLeast(lambda, count) {
  const l = Number(lambda)
  if (!Number.isFinite(l) || l <= 0) return 0
  const e = Math.exp(-l)
  if (count <= 1) return 1 - e
  if (count === 2) return 1 - e * (1 + l)
  return 1 - e * (1 + l + (l * l) / 2)
}

export function lambdaFromTail(prob, count) {
  const target = Number(prob)
  if (!Number.isFinite(target) || target <= 0) return 0
  if (count <= 1) return lambdaFromAnytime(target)
  let lo = 0
  let hi = 40
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    if (probAtLeast(mid, count) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function coverageMultiplier({ idxMan, idxZone, manDef, zoneDef, manLg, zoneLg, position, recTd = 0, rushTd = 0, clipped = false, hasSample = true, hasMix = true, extraDamp = 1 }) {
  if (!hasMix) return { mRaw: 1, m: 1, mAdj: 1, share: null, reason: 'no coverage mix' }
  if (!hasSample || position === 'QB') return { mRaw: 1, m: 1, mAdj: 1, share: null, reason: 'no 2025 coverage sample' }
  const denom = manLg * idxMan + zoneLg * idxZone
  const mRaw = denom === 0 ? 1 : (manDef * idxMan + zoneDef * idxZone) / denom
  let m = mRaw
  let share = null
  if (position === 'RB') {
    share = (recTd + 0.5) / (recTd + rushTd + 2.5)
    m = 1 + share * (mRaw - 1)
  }
  const rawDamp = Number(extraDamp)
  const damp = Number.isFinite(rawDamp) ? Math.min(1, Math.max(0.5, rawDamp)) : 1
  let deviation = 0.5 * (m - 1) * damp
  if (clipped) deviation *= 0.5
  const mAdj = Math.min(1.1, Math.max(0.9, 1 + deviation))
  return { mRaw, m, mAdj, share, reason: null }
}

export function leagueManShare(coverage) {
  const shares = []
  for (const game of Object.values(coverage?.games || {})) {
    for (const offense of Object.values(game?.offenses || {})) {
      const man = manShare(offense?.mix)
      if (man != null) shares.push(man)
    }
  }
  if (!shares.length) return null
  return shares.reduce((sum, value) => sum + value, 0) / shares.length
}

function manShare(mix) {
  if (!mix) return null
  return MAN_KEYS.reduce((sum, key) => sum + (Number(mix[key]) || 0), 0)
}

function picksOf(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

function propCount(prop) {
  if (prop === '3+ TDs') return 3
  if (prop === '2+ TDs') return 2
  return 1
}

function playerSample(tdCoverage, pick) {
  if (!pick || pick.position === 'QB') return null
  const key = `${normCoverageName(pick.player)}|${pick.position}`
  return tdCoverage?.players?.[key] || null
}

function baseLambda(picks) {
  const anytime = picks.find(pick => pick.prop === 'Anytime TD' && pick.modelProb != null)
  if (anytime) return lambdaFromAnytime(anytime.modelProb)
  const two = picks.find(pick => pick.prop === '2+ TDs' && pick.modelProb != null)
  if (two) return lambdaFromTail(two.modelProb, 2)
  const three = picks.find(pick => pick.prop === '3+ TDs' && pick.modelProb != null)
  if (three) return lambdaFromTail(three.modelProb, 3)
  return null
}

function pct1(value) {
  return `${(Math.round(Number(value) * 1000) / 10).toFixed(1)}%`
}

export function coverageSentence({ defense, manDef, manLg, sample, base, adjusted, reason }) {
  if (reason === 'no coverage mix') return 'Coverage: no change (no coverage mix).'
  if (reason || !sample) return 'Coverage: no change (no 2025 coverage sample).'
  return `Coverage: ${defense} plays man ${pct1(manDef)} (NFL ${pct1(manLg)}); 2025 TD rate vs man ${sample.idxMan.toFixed(2)}× avg, vs zone ${sample.idxZone.toFixed(2)}× → ${pct1(base)} base → ${pct1(adjusted)}.`
}

function adjustPick(pick, lambda, factor, sentence) {
  const next = probAtLeast(lambda * factor.mAdj, propCount(pick.prop))
  const note = sentence({ base: pick.modelProb, adjusted: next })
  return { ...pick, modelProb: next, reason: [pick.reason, note].filter(Boolean).join(' ') }
}

export function adjustRow(row, context) {
  const rules = context.rules || {}
  const safeMin = rules.relativelySafeMinProb ?? 0.15
  const min2 = rules.upside2plusMinProb ?? 0.03
  const min3 = rules.upside3plusMinProb ?? 0.05
  const maxBackups = rules.maxBackups ?? 2
  const qFactor = rules.questionableRankFactor ?? 0.85
  const original = [...picksOf(row.confident), ...picksOf(row.relativelySafe), ...picksOf(row.upside)]
  const byPlayer = new Map()
  original.forEach((pick, index) => {
    const list = byPlayer.get(pick.player) || []
    list.push({ ...pick, _index: index })
    byPlayer.set(pick.player, list)
  })
  const anytime = []
  const multi = []
  for (const picks of byPlayer.values()) {
    const sample = playerSample(context.tdCoverage, picks[0])
    const factor = coverageMultiplier({
      idxMan: sample?.idxMan,
      idxZone: sample?.idxZone,
      manDef: context.manDef,
      zoneDef: context.zoneDef,
      manLg: context.manLg,
      zoneLg: context.zoneLg,
      position: picks[0].position,
      recTd: sample?.recTd2025 || 0,
      rushTd: sample?.rushTd2025 || 0,
      clipped: context.clipped,
      hasSample: Boolean(sample),
      hasMix: context.hasMix,
      extraDamp: context.extraDamp ?? 1,
    })
    const lambda = baseLambda(picks)
    const sentence = ({ base, adjusted }) => coverageSentence({
      defense: context.defense,
      manDef: context.manDef,
      manLg: context.manLg,
      sample: factor.reason ? null : sample,
      base,
      adjusted,
      reason: factor.reason,
    })
    for (const pick of picks) {
      const next = lambda == null ? { ...pick, reason: [pick.reason, sentence({ base: pick.modelProb, adjusted: pick.modelProb })].filter(Boolean).join(' ') } : adjustPick(pick, lambda, factor, sentence)
      if (next.prop === '2+ TDs' && next.modelProb < min2) continue
      if (next.prop === '3+ TDs' && next.modelProb < min3) continue
      if (next.prop === 'Anytime TD') anytime.push({ pick: next, factor })
      else multi.push(next)
    }
  }
  anytime.sort((a, b) => rankKey(b.pick, qFactor) - rankKey(a.pick, qFactor) || a.pick._index - b.pick._index)
  const confident = anytime[0]?.pick || null
  const second = anytime[1]?.pick
  const relativelySafe = second && second.modelProb >= safeMin ? second : null
  const backupStart = relativelySafe ? 2 : 1
  const backups = anytime.slice(backupStart, backupStart + maxBackups).map(item => ({ ...item.pick, flavor: item.pick.flavor || item.pick.kind || 'backup_1td', kind: item.pick.kind || 'backup_1td' }))
  const clean = pick => pick ? { ...pick, flavor: null, kind: null } : null
  const twos = multi.filter(pick => pick.prop === '2+ TDs').sort((a, b) => b.modelProb - a.modelProb || a._index - b._index)
  const threes = multi.filter(pick => pick.prop === '3+ TDs').sort((a, b) => b.modelProb - a.modelProb || a._index - b._index)
  return {
    ...row,
    confident: strip(clean(confident)),
    relativelySafe: strip(clean(relativelySafe)),
    upside: [...twos, ...threes, ...backups].map(strip),
    notes: [],
  }
}

function rankKey(pick, qFactor) {
  const factor = String(pick.status || '').toLowerCase() === 'questionable' ? qFactor : 1
  return pick.modelProb * factor
}

function strip(pick) {
  if (!pick) return pick
  const next = { ...pick }
  delete next._index
  return next
}

function sideContext(side, game, coverage, tdCoverage) {
  const key = String(game?.key || '').replace('@', '-')
  const entry = coverage?.games?.[key]?.offenses?.[side?.offense]
  const man = manShare(entry?.mix)
  const league = leagueManShare(coverage)
  return {
    tdCoverage,
    defense: side?.defense,
    manDef: man,
    zoneDef: man == null ? null : 1 - man,
    manLg: league,
    zoneLg: league == null ? null : 1 - league,
    clipped: entry?.mixNote === 'clipped',
    stale: entry?.mixNote === 'stale',
    hasMix: man != null && league != null,
  }
}

export const DEFAULT_TOUCHDOWN_VIEW = 'both'

function americanOddsRank(price) {
  if (price == null || price === '') return Number.NEGATIVE_INFINITY
  const value = Number(String(price).replace(/^\+/, ''))
  if (!Number.isFinite(value) || value === 0) return Number.NEGATIVE_INFINITY
  return value > 0 ? 1 + value / 100 : 1 + 100 / -value
}

function betterPick(current, candidate) {
  const currentProb = Number(current.modelProb)
  const candidateProb = Number(candidate.modelProb)
  if (candidateProb !== currentProb) return candidateProb > currentProb ? candidate : current
  const priceGap = americanOddsRank(candidate.price) - americanOddsRank(current.price)
  if (priceGap !== 0) return priceGap > 0 ? candidate : current
  return String(candidate.player).localeCompare(String(current.player)) < 0 ? candidate : current
}

function bestOf(picks) {
  const list = picks.filter(Boolean)
  if (!list.length) return null
  return list.reduce((best, pick) => betterPick(best, pick))
}

function mergedUpside(rows) {
  const picks = rows.flatMap(row => row.upside || [])
  const chosen = [
    bestOf(picks.filter(pick => pick.prop === '2+ TDs')),
    bestOf(picks.filter(pick => pick.prop === '3+ TDs')),
    bestOf(picks.filter(pick => pick.prop === 'Anytime TD')),
  ]
  return chosen.filter(Boolean)
}

export function mergeTouchdownSides(sides) {
  const grouped = new Map()
  for (const side of sides || []) {
    for (const row of side?.rows || []) {
      const list = grouped.get(row.position) || []
      list.push({ defense: side.defense, row })
      grouped.set(row.position, list)
    }
  }
  return [...grouped.keys()].sort((a, b) => {
    const peak = position => Math.max(...grouped.get(position).map(item => Number(item.row.tdsAllowed) || 0))
    return peak(b) - peak(a) || a.localeCompare(b)
  }).map(position => {
    const sources = grouped.get(position)
    const rows = sources.map(item => item.row)
    return {
      position,
      tdsAllowed: Math.max(...rows.map(row => Number(row.tdsAllowed) || 0)),
      sources,
      confident: bestOf(rows.map(row => row.confident)),
      relativelySafe: bestOf(rows.map(row => row.relativelySafe)),
      upside: mergedUpside(rows),
      notes: [],
    }
  })
}

export function applyCoverage(game, coverage, tdCoverage, rules, options) {
  if (!game || !coverage?.games || !tdCoverage?.players) return game
  const extraDamp = options?.coverageDamp ?? options?.extraDamp ?? 1
  let applied = false
  let stale = false
  const sides = (game.sides || []).map(side => {
    const context = { ...sideContext(side, game, coverage, tdCoverage), rules, extraDamp }
    if (!context.hasMix) return side
    applied = true
    if (context.stale) stale = true
    return { ...side, rows: (side.rows || []).map(row => adjustRow(row, context)) }
  })
  if (!applied) return game
  return { ...game, coverageApplied: true, coverageStale: stale, sides }
}
