export function accuracyLines(data) {
  return Array.isArray(data?.lines) ? data.lines.filter(line => typeof line === 'string' && line.trim()) : []
}
