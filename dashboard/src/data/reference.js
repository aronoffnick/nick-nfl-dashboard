// Behind-the-scenes reference data (no tab of its own). The former "Defense vs position" panel's
// numbers live in defense-vs-opponents-wk12.json and are imported by other tabs (e.g. Scatter Plot).
import defense from './defense-vs-opponents-wk12.json'

/** What `defenseAbbr` allowed to `pos` (Weeks 1-11): factors are allowed ÷ league average. */
export const defenseVs = (defenseAbbr, pos) => defense.defenses[defenseAbbr]?.[pos === 'FB' ? 'RB' : pos] || null
