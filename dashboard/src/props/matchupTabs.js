export const BET_VIEWS = ['generator', 'flyers', 'parlays', 'projections', 'touchdowns']
export const STAT_VIEWS = ['scatter', 'stocks', 'history']

const ALIAS = {
  scatter: ['stats', 'scatter'],
  history: ['stats', 'history'],
  'recent-opponents': ['stats', 'history'],
  'recent opponents': ['stats', 'history'],
  stocks: ['stats', 'stocks'],
  'stat-metrics': ['stats', 'stocks'],
  'stat metrics': ['stats', 'stocks'],
  bets: ['bets', 'generator'],
  generator: ['bets', 'generator'],
  flyers: ['bets', 'flyers'],
  parlays: ['bets', 'parlays'],
  projections: ['bets', 'projections'],
  touchdowns: ['bets', 'touchdowns'],
}

export function parseMatchupHash(hash) {
  const raw = String(hash || '').replace(/^#/, '').trim().toLowerCase().replace(/\+/g, ' ')
  if (!raw) return { tab: 'bets', view: 'generator' }
  const [main, sub] = raw.split('/')
  if (main === 'bets' && BET_VIEWS.includes(sub)) return { tab: 'bets', view: sub }
  if (main === 'stats' && STAT_VIEWS.includes(sub)) return { tab: 'stats', view: sub }
  if (main === 'stats') return { tab: 'stats', view: 'scatter' }
  if (ALIAS[raw]) {
    const [tab, view] = ALIAS[raw]
    return { tab, view }
  }
  return { tab: 'bets', view: 'generator' }
}

export function formatMatchupHash(tab, view) {
  return `#${tab}/${view}`
}
