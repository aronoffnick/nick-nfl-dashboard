import { fileForWeek, weeksOnDisk } from './weekFiles.js'
import { accuracyLines } from './accuracyLines.js'

export function latestCalibration() {
  const weeks = weeksOnDisk('calibration')
  if (!weeks.length) return null
  return fileForWeek('calibration', weeks[weeks.length - 1]).data
}

export function calibrationBefore(week) {
  const weeks = weeksOnDisk('calibration').filter(value => value < Number(week))
  if (!weeks.length) return null
  return fileForWeek('calibration', weeks[weeks.length - 1]).data
}

export { accuracyLines }
