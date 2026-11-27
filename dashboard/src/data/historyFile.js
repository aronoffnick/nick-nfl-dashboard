const files = import.meta.glob('./history-*.json', { eager: true, import: 'default' })

export function bundledHistory(year) {
  for (const [path, data] of Object.entries(files)) {
    if (Number(data?.season) === Number(year) || path.includes(String(year))) return data
  }
  return null
}

export function remember(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (error) {
    const quota = error?.name === 'QuotaExceededError' || error?.code === 22
    if (!quota) return false
    try {
      for (const saved of Object.keys(localStorage)) {
        if (saved.startsWith('nick-nfl-boxscore-')) localStorage.removeItem(saved)
      }
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }
}
