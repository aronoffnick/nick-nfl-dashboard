import { roleTags } from './roleData.js'
/** WR / RB role chips from the Week 12 starters sheets (labels marked * in the sheet are usage-inferred). */
export default function RoleTags({ player }) {
  const tags = roleTags(player)
  if (!tags.length) return null
  return <span className="vb-roles" title="From the Week 12 WR/RB starters sheets; RB roles are inferred from 2026 usage">{tags.map(t => <span key={t} className="vb-role">{t}</span>)}</span>
}
