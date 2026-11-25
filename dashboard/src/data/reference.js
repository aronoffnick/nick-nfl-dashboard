// Behind-the-scenes reference data (no tab of its own). The former "Defense vs position" panel's
// numbers live in defense-vs-opponents-wk12.json and are imported by other tabs (e.g. Scatter Plot).
import { fileForWeek } from './weekFiles.js'

/** What `defenseAbbr` allowed to `pos` for that week's file. Missing week returns null. */
export const defenseVs = (defenseAbbr, pos, week) => {
  const file = fileForWeek('defense', week)
  if (!file.matched) return null
  return file.data.defenses?.[defenseAbbr]?.[pos === 'FB' ? 'RB' : pos] || null
}
