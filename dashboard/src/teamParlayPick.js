export function chooseGroup(pool, count, lo, hi) {
  let best = null
  const walk = (start, picked) => {
    if (picked.length === count) {
      const decimal = picked.reduce((product, leg) => product * leg.decimal, 1)
      const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1))
      if (american < lo || american > hi) return
      const hit = picked.reduce((product, leg) => product * leg.prob, 1)
      if (!best || hit > best.hit) best = { legs: picked, hit, american }
      return
    }
    for (let i = start; i <= pool.length - (count - picked.length); i++) walk(i + 1, [...picked, pool[i]])
  }
  if (count >= 2 && count <= pool.length) walk(0, [])
  return best
}
