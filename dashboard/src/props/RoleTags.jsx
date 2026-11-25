import { roleTags } from './roleData.js'
/** WR / RB role chips from the Week 12 starters sheets (labels marked * in the sheet are usage-inferred). */
export default function RoleTags({ player, week }) {
  const tags = roleTags(player, week)
  if (!tags.length) return null
  return <span className="vb-roles" title={week ? `From the Week ${week} WR/RB starters sheets` : 'From the WR/RB starters sheets'}>{tags.map(t => <span key={t} className="vb-role">{t}</span>)}</span>
}
