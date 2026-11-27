/** Chance the home team covers homeLine, using the same margin curve as a win. */
export function coverProb(signedHome, homeLine) {
  return 1 / (1 + Math.exp(-((signedHome || 0) + homeLine) / 7))
}

function pricedGroup(picked, lo, hi) {
  const decimal = picked.reduce((product, leg) => product * leg.decimal, 1)
  const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1))
  if (american < lo || american > hi) return null
  const hit = picked.reduce((product, leg) => product * leg.prob, 1)
  return { legs: picked, hit, american, decimal }
}

function walkGroups(pool, count, visit) {
  const walk = (start, picked) => {
    if (picked.length === count) {
      visit(picked)
      return
    }
    for (let i = start; i <= pool.length - (count - picked.length); i++) walk(i + 1, [...picked, pool[i]])
  }
  if (count >= 2 && count <= pool.length) walk(0, [])
}

export function chooseGroup(pool, count, lo, hi) {
  let best = null
  walkGroups(pool, count, picked => {
    const group = pricedGroup(picked, lo, hi)
    if (!group) return
    if (!best || group.hit > best.hit) best = group
  })
  return best
}

// Same odds window as chooseGroup. Among the parlays that fit, keep the higher total Kelly fraction.
export function chooseValueGroup(pool, count, lo, hi) {
  let best = null
  walkGroups(pool, count, picked => {
    const group = pricedGroup(picked, lo, hi)
    if (!group) return
    const value = picked.reduce((sum, leg) => sum + (Number(leg.kelly) || 0), 0)
    if (!best || value > best.value || (value === best.value && group.hit > best.hit)) best = { ...group, value }
  })
  if (best) best.legs = [...best.legs].sort((a, b) => (b.kelly || 0) - (a.kelly || 0))
  return best
}
