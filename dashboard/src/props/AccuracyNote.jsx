import { accuracyLines, latestCalibration } from '../data/accuracy.js'

export default function AccuracyNote({ compact = false }) {
  const lines = accuracyLines(latestCalibration())
  if (!lines.length) return null
  if (compact) return <p className="prop-help">{lines.slice(0, 2).join(' ')}</p>
  return <details className="pick-accuracy">
    <summary><span className="pick-chevron" aria-hidden="true" />Projection accuracy</summary>
    {lines.map(line => <p key={line}>{line}</p>)}
  </details>
}
