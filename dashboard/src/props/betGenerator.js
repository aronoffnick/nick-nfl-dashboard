// Bet generator: builds the top parlays for a chosen leg count, team(s), position and odds range
// from the game-day leg pool in parlays-wkN.json. Only legs with a saved getoddy snapshot price are used.

export const POSITIONS = ['All positions', 'QB', 'RB', 'WR', 'TE']

export function americanToDecimal(american) {
  const a = Number(american)
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a
}
export function decimalToAmerican(decimal) {
  return decimal >= 2 ? `+${Math.round((decimal - 1) * 100)}` : `-${Math.round(100 / (decimal - 1))}`
}
function parseOdds(value) {
  if (value == null || String(value).trim() === '') return null
  const n = Number(String(value).trim().replace(/^\+/, ''))
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : NaN
}

// Pool filtering. Returns { legs, excluded } where excluded counts why legs were left out.
export function generatorPool(game, { teams, position = 'All positions', includeTD = false } = {}) {
  const excluded = { unpriced: 0, td: 0, team: 0, position: 0 }
  const legs = []
  for (const leg of game?.legs || []) {
    if (teams?.length && !teams.includes(leg.team)) { excluded.team++; continue }
    if (leg.kind === 'td' && !includeTD) { excluded.td++; continue }
    if (leg.kind === 'ml' ? position !== 'All positions' : position !== 'All positions' && leg.pos !== position) { excluded.position++; continue }
    if (!leg.priced || leg.price == null) { excluded.unpriced++; continue }
    legs.push(leg)
  }
  return { legs: legs.sort((a, b) => b.p - a.p), excluded }
}

function playerKey(leg) {
  return leg.kind === 'ml' ? 'moneyline' : leg.player
}

// Top combinations: one leg per player, at most one moneyline, ranked by the product of model hit chances.
export function generateBets(game, { legs: size = 2, teams, position, includeTD, minOdds, maxOdds, top = 3, poolLimit = 30 } = {}) {
  const { legs: pool, excluded } = generatorPool(game, { teams, position, includeTD })
  const lo = parseOdds(minOdds), hi = parseOdds(maxOdds)
  if (Number.isNaN(lo) || Number.isNaN(hi)) return { results: [], excluded, pool: pool.length, error: 'Odds must be American odds like +300 or -150.' }
  const loD = lo == null ? null : americanToDecimal(lo), hiD = hi == null ? null : americanToDecimal(hi)
  const k = Math.max(1, Math.min(6, Number(size) || 1))
  const legsUsed = pool.slice(0, poolLimit)
  const best = []
  const pick = [], players = new Set()
  function consider() {
    const decimal = pick.reduce((product, leg) => product * americanToDecimal(leg.price), 1)
    if (loD != null && decimal < loD) return
    if (hiD != null && decimal > hiD) return
    const hit = pick.reduce((product, leg) => product * leg.p, 1)
    if (best.length === top && hit <= best[best.length - 1].hit) return
    best.push({ legs: [...pick], hit, decimal, payout: decimalToAmerican(decimal), implied: 1 / decimal })
    best.sort((a, b) => b.hit - a.hit)
    if (best.length > top) best.pop()
  }
  function walk(start) {
    if (pick.length === k) { consider(); return }
    for (let i = start; i <= legsUsed.length - (k - pick.length); i++) {
      const leg = legsUsed[i], key = playerKey(leg)
      if (players.has(key)) continue
      players.add(key); pick.push(leg)
      walk(i + 1)
      pick.pop(); players.delete(key)
    }
  }
  walk(0)
  const results = best.map(result => ({ ...result, adjusted: correlatedHit(result.legs, game?.corr || {}) }))
  return { results, excluded, pool: pool.length, error: null }
}

// Gaussian-copula estimate using the pipeline's pairwise correlations (same-team only, halved Spearman).
// Deterministic seed so the number does not jump between renders.
export function correlatedHit(legs, corr, sims = 20000) {
  const n = legs.length
  if (n < 2) return legs[0]?.p ?? null
  const R = legs.map((a, i) => legs.map((b, j) => i === j ? 1 : (corr[`${a.id}|${b.id}`] ?? corr[`${b.id}|${a.id}`] ?? 0)))
  if (R.every((row, i) => row.every((v, j) => i === j || v === 0))) return legs.reduce((p, leg) => p * leg.p, 1)
  const L = cholesky(R)
  if (!L) return null
  const cut = legs.map(leg => invNorm(1 - leg.p))
  let seed = 12345, hits = 0, spare = null
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed + 0.5) / 2147483648 }
  const gauss = () => {
    if (spare != null) { const s = spare; spare = null; return s }
    const u = rand(), v = rand(), r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v)
  }
  for (let s = 0; s < sims; s++) {
    const z = Array.from({ length: n }, gauss)
    let ok = true
    for (let i = 0; i < n && ok; i++) {
      let x = 0
      for (let j = 0; j <= i; j++) x += L[i][j] * z[j]
      if (x <= cut[i]) ok = false
    }
    if (ok) hits++
  }
  return hits / sims
}
function cholesky(A) {
  const n = A.length, L = A.map(() => Array(n).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let sum = A[i][j]
    for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
    if (i === j) { if (sum <= 0) return null; L[i][i] = Math.sqrt(sum) } else L[i][j] = sum / L[j][j]
  }
  return L
}
// Acklam's inverse normal CDF approximation.
function invNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const q0 = Math.min(Math.max(p, 1e-12), 1 - 1e-12)
  if (q0 < 0.02425) { const q = Math.sqrt(-2 * Math.log(q0)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1) }
  if (q0 > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - q0)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1) }
  const q = q0 - 0.5, r = q * q
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
}
