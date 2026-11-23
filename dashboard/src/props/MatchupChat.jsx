import { useMemo, useState } from 'react'
import { statFor } from './analysis.js'
import { performance, relevantMetrics } from './performance.js'
import { valid } from './model.js'
import './chat.css'

const fmt = (n, key) => valid(n) ? n.toFixed(key?.endsWith('TD') ? 2 : 1) : '—'
const possessive = name => name.endsWith('s') ? `${name}'` : `${name}'s`
const mentions = (text, term) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `.includes(` ${term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `)

function answerFor(question, { matchup, players, halfLife, lookback, inDepth }) {
  const q = question.trim().toLowerCase()
  const sides = [matchup.away, matchup.home]
  const names = players.map(p => p.name).sort((a, b) => b.length - a.length)
  const mentioned = names.filter(name => q.includes(name.toLowerCase()))
  const player = mentioned.length ? players.find(p => p.name === mentioned[0]) : null
  const chosenTeam = sides.find(t => [t.name, t.abbr, ...[t.name.split(' ')[0], t.name.split(' ').at(-1)]].some(term => mentions(q, term)))

  if (player && !(mentioned.length > 1 || /compare|versus|\bvs\b|better/.test(q))) {
    const rows = relevantMetrics(player).map(([key, label]) => ({
      key, label, projection: player.unavailable ? null : statFor(player, key, halfLife, lookback).projection,
      support: performance(player, key, halfLife, lookback),
    })).filter(row => row.projection != null || row.support.n > 0)
    const lines = rows.map(row => `${row.label}: ${fmt(row.projection, row.key)} projected; ${row.support.label.toLowerCase()} at ${row.support.threshold}+ (${row.support.n} valid recent appearances${row.support.weightedRate == null ? '' : `, ${Math.round(row.support.weightedRate * 100)}% recent weighted frequency`}).`).slice(0, inDepth ? 6 : 3)
    const availability = player.unavailable ? `The projection is withheld because the roster marks ${player.name} unavailable.` : `${player.name} is listed ${player.injury || player.status}; roster status can lag.`
    return [
      `${player.name} (${player.team.abbr}, ${player.position}): ${availability}`,
      ...(lines.length ? lines : ['There is not enough usable recent data for a projection.']),
      'Those frequencies describe prior results at the dashboard benchmark. They are not probabilities that the player will reach a sportsbook line.',
    ]
  }

  if (mentioned.length > 1 || /compare|versus|\bvs\b|better/.test(q)) {
    const compared = mentioned.length ? mentioned.slice(0, 2).map(name => players.find(p => p.name === name)) : []
    if (compared.length === 2) {
      return compared.map(p => {
        const rows = relevantMetrics(p).map(([key, label]) => ({ key, label, projection: p.unavailable ? null : statFor(p, key, halfLife, lookback).projection, support: performance(p, key, halfLife, lookback) }))
        const top = rows.filter(r => valid(r.projection)).sort((a, b) => b.projection - a.projection).slice(0, inDepth ? 4 : 2)
        return `${p.name} (${p.team.abbr}): ${top.map(r => `${r.label} ${fmt(r.projection, r.key)} projected; ${r.support.label.toLowerCase()}`).join('; ') || 'No usable projections'}.`
      }).concat('These are different statistics and roles, so compare each player within the same market. Historical support is not a forecast probability.')
    }
  }

  if (/big.game|likely|likelihood|support|prop|player|sgp|touchdown|yards|reception/.test(q)) {
    const pool = players.filter(p => !chosenTeam || p.team.id === chosenTeam.id)
    const signals = pool.flatMap(p => relevantMetrics(p).map(([key, label]) => {
      const result = performance(p, key, halfLife, lookback)
      return { player: p, key, label, result, projection: p.unavailable ? null : statFor(p, key, halfLife, lookback).projection }
    })).filter(s => s.result.level === 'high' && valid(s.projection))
      .sort((a, b) => b.result.weightedRate - a.result.weightedRate || b.result.n - a.result.n)
    if (!signals.length) return [`I don't see a qualifying higher-support signal${chosenTeam ? ` for ${chosenTeam.name}` : ''} in the current matchup data.`, 'Higher support means at least two-thirds recent weighted frequency at the dashboard benchmark, with enough valid appearances and no availability flag. It is historical support, not a forecast probability.']
    return [
      `Higher big-game support${chosenTeam ? ` for ${chosenTeam.name}` : ' in this matchup'} (ranked by recent weighted benchmark frequency):`,
      ...signals.slice(0, inDepth ? 8 : 4).map(s => `${s.player.name} (${s.player.team.abbr}) — ${s.label}: ${fmt(s.projection, s.key)} projected; ${Math.round(s.result.weightedRate * 100)}% weighted frequency at ${s.result.threshold}+ (${s.result.hits}/${s.result.n} recent appearances).`),
      'These historical frequencies are not probabilities of clearing a betting line, and player outcomes can be correlated.',
    ]
  }

  if (/vulnerab|weak|attack|exploit|defense|defence/.test(q) && !/path|win|victory/.test(q)) {
    const opponent = chosenTeam || matchup.away
    const weaknesses = [
      { name: 'Pass defense', rank: opponent.ranks.passD, yards: opponent.recent.passD },
      { name: 'Rush defense', rank: opponent.ranks.rushD, yards: opponent.recent.rushD },
    ].sort((a, b) => b.rank - a.rank)
    return [
      `${possessive(opponent.name)} clearest team-level vulnerability in this dashboard snapshot is ${weaknesses[0].name.toLowerCase()}: rank #${weaknesses[0].rank}, allowing ${fmt(weaknesses[0].yards)} yards per game on the recent weighted view.`,
      `The other side: ${weaknesses[1].name.toLowerCase()} ranks #${weaknesses[1].rank} (${fmt(weaknesses[1].yards)} yards allowed). Lower defensive rank means fewer yards allowed.`,
      ...(inDepth ? ['These are team totals, not player-position prop lines. The matchup explorer’s Defense trends tab breaks recent opponent production down by position and statistic.'] : []),
    ]
  }

  if (/model|margin|score|why.*favor|project/.test(q) && !/path|win|victory/.test(q)) {
    return [
      `The dashboard projects ${matchup.away.abbr} ${fmt(matchup.awayPoints)} and ${matchup.home.abbr} ${fmt(matchup.homePoints)}: ${matchup.margin < .05 ? 'a toss-up' : `${matchup.winner.name} by ${fmt(matchup.margin)} points`}.`,
      'Its team model blends exponentially weighted points scored and allowed (80%) with an estimate based on passing and rushing yardage (20%), then applies the configured home advantage.',
      ...(inDepth ? [`The model currently uses a ${halfLife}-game half-life and ${matchup.neutral ? 'no venue adjustment at this neutral site' : 'the configured home advantage shown above'}. It does not adjust for confirmed starting quarterback, injury-driven role changes, weather, or sportsbook lines. The margin is an uncalibrated model estimate, not certainty.`] : ['The dashboard labels this a transparent heuristic; it does not include live injury, quarterback, weather, or sportsbook adjustments.']),
    ]
  }

  const target = chosenTeam || (matchup.margin < .05 ? matchup.home : sides.find(t => t.id !== matchup.winner.id))
  const opponent = sides.find(t => t.id !== target.id)
  const edges = [
    { label: 'Rushing offense vs. opponent rush defense', rank: target.ranks.rushO, defenseRank: opponent.ranks.rushD, yards: target.recent.rushO },
    { label: 'Passing offense vs. opponent pass defense', rank: target.ranks.passO, defenseRank: opponent.ranks.passD, yards: target.recent.passO },
  ].sort((a, b) => (b.defenseRank - b.rank) - (a.defenseRank - a.rank))
  const threats = players.filter(p => p.team.id === opponent.id).flatMap(p => relevantMetrics(p).map(([key, label]) => ({ p, key, label, value: p.unavailable ? null : statFor(p, key, halfLife, lookback).projection, support: performance(p, key, halfLife, lookback) })))
    .filter(x => valid(x.value) && ['passYds', 'rushYds', 'recYds'].includes(x.key))
    .sort((a, b) => b.value - a.value).slice(0, inDepth ? 4 : 2)
  const own = players.filter(p => p.team.id === target.id).flatMap(p => relevantMetrics(p).map(([key, label]) => ({ p, key, label, value: p.unavailable ? null : statFor(p, key, halfLife, lookback).projection, support: performance(p, key, halfLife, lookback) })))
    .filter(x => valid(x.value) && ['passYds', 'rushYds', 'recYds', 'rec', 'totalTD'].includes(x.key))
    .sort((a, b) => (b.support.weightedRate ?? -1) - (a.support.weightedRate ?? -1) || b.value - a.value).slice(0, inDepth ? 5 : 3)

  return [
    `${possessive(target.name)} path starts with beating the dashboard’s projected score of ${fmt(target === matchup.away ? matchup.awayPoints : matchup.homePoints)}. The model currently has ${matchup.winner.name} by ${fmt(matchup.margin)}.`,
    `${edges[0].label} is the more promising statistical route in the dashboard’s current ranking view: ${target.abbr} is #${edges[0].rank} in that offense, while ${opponent.abbr} is #${edges[0].defenseRank} in that defense. ${target.abbr} averages ${fmt(edges[0].yards)} yards in the recent weighted view.`,
    `Key ${target.abbr} contributors from the player projections: ${own.slice(0, inDepth ? 5 : 3).map(x => `${x.p.name} ${x.label.toLowerCase()} ${fmt(x.value, x.key)} (${x.support.label.toLowerCase()})`).join('; ') || 'no qualifying player projections'}.`,
    `The defensive challenge is containing ${possessive(opponent.name)} projected threats: ${threats.slice(0, inDepth ? 4 : 2).map(x => `${x.p.name} ${x.label.toLowerCase()} ${fmt(x.value, x.key)}`).join('; ') || 'the opponent’s offense'}.`,
    ...(inDepth ? [`Practical game plan: use the stronger ground/pass matchup to stay ahead of the chains, protect the ball, and make the opponent finish drives rather than give up explosive plays. To turn the model’s lean around, ${target.name} likely needs a turnover or red-zone edge and to outperform its current score projection.`, 'Projections use prior current-season appearances and opponent-position adjustments. Status can lag; no confirmed quarterback, injury-driven usage, or weather adjustment is included.'] : ['This is a data-based game plan, not a certainty. Player support frequencies are historical and are not calibrated win probabilities.']),
  ]
}

const suggestions = matchup => [
  `${possessive(matchup.home.name)} path to victory?`,
  `Where is ${matchup.away.name} vulnerable?`,
  'Who has the strongest big-game support?',
  'Explain the projected margin',
]

export default function MatchupChat({ matchup, players, halfLife, lookback }) {
  const [question, setQuestion] = useState('')
  const [inDepth, setInDepth] = useState(false)
  const [messages, setMessages] = useState([])
  const promptChoices = useMemo(() => suggestions(matchup), [matchup])

  function send(value = question) {
    const text = value.trim()
    if (!text) return
    const reply = answerFor(text, { matchup, players, halfLife, lookback, inDepth })
    setMessages(current => [...current, { question: text, reply }])
    setQuestion('')
  }

  return <section className="matchup-chat" aria-label="Ask the matchup">
    <div className="matchup-chat-intro"><div><p className="eyebrow">MATCHUP ASSISTANT</p><h3>Ask this matchup</h3><p>Answers use the dashboard’s current team rankings, player projections, status labels, and recent game data.</p></div>
      <label className="chat-depth"><input type="checkbox" checked={inDepth} onChange={e => setInDepth(e.target.checked)}/> In depth</label>
    </div>
    {!messages.length && <div className="chat-suggestions" aria-label="Suggested questions">{promptChoices.map(prompt => <button type="button" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div>}
    <div className="chat-thread" aria-live="polite">
      {messages.map((message, index) => <article className="chat-turn" key={`${index}:${message.question}`}>
        <p className="chat-question">{message.question}</p>
        <div className="chat-answer">{message.reply.map((line, i) => <p key={i}>{line}</p>)}</div>
      </article>)}
    </div>
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); send() }}>
      <label className="chat-sr-only" htmlFor="matchup-question">Ask a question about this matchup</label>
      <input id="matchup-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder={`Ask about ${matchup.away.abbr} at ${matchup.home.abbr}…`} maxLength={240}/>
      <button type="submit" disabled={!question.trim()}>Ask</button>
    </form>
    <p className="chat-note">Free, dashboard-powered answers. Historical frequencies are not betting probabilities; the model does not account for confirmed quarterback changes, weather, or all injury effects.</p>
  </section>
}
