// Weekly files are picked by the ESPN week number in the filename
// (scatter-wk12.json, wr-starters-week12.json, …). A missing week is blank,
// not the previous week's file.
import { bookFrom } from '../props/roleEligibility.js'

const groups = {
  scatter: import.meta.glob('./scatter-wk*.json', { eager: true, import: 'default' }),
  tdRisk: import.meta.glob('./td-riskscale-wk*.json', { eager: true, import: 'default' }),
  defense: import.meta.glob('./defense-vs-opponents-wk*.json', { eager: true, import: 'default' }),
  wr: import.meta.glob('../props/wr-starters-week*.json', { eager: true, import: 'default' }),
  rb: import.meta.glob('../props/rb-starters-week*.json', { eager: true, import: 'default' }),
  usage: import.meta.glob('../props/rb-usage-week*.json', { eager: true, import: 'default' }),
}

function index(modules) {
  return Object.entries(modules).flatMap(([path, data]) => {
    const match = path.match(/(?:wk|week)(\d+)/i)
    return match ? [{ week: Number(match[1]), data }] : []
  }).sort((a, b) => a.week - b.week)
}

const indexed = Object.fromEntries(Object.entries(groups).map(([kind, modules]) => [kind, index(modules)]))

export function roleBookForWeek(week) {
  const rb = fileForWeek('rb', week)
  const wr = fileForWeek('wr', week)
  const usage = fileForWeek('usage', week)
  if (week != null && (!rb.matched || !wr.matched)) return { matched: false, week: Number(week), rbByName: new Map(), wrByName: new Map() }
  return bookFrom(rb.data || [], usage.data || [], wr.data || [], { matched: true, week: rb.week })
}

export function weeksOnDisk(kind) {
  return indexed[kind].map(row => row.week)
}

export function fileForWeek(kind, week) {
  const rows = indexed[kind] || []
  if (!rows.length) return { data: null, week: null, matched: false }
  if (week == null) {
    const latest = rows[rows.length - 1]
    return { data: latest.data, week: latest.week, matched: true }
  }
  const exact = rows.find(row => row.week === Number(week))
  return exact ? { data: exact.data, week: exact.week, matched: true } : { data: null, week: Number(week), matched: false }
}
