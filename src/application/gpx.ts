import type { ExpeditionPlan } from '@shared/contracts/expedition'

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'\"]/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ??
      character,
  )
}

export function sanitizeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'expedition'
  )
}

export function gpxFilename(plan: ExpeditionPlan): string {
  return `${sanitizeFilename(plan.input.start.locality ?? plan.input.start.label)}-${sanitizeFilename(plan.input.destination.locality ?? plan.input.destination.label)}-bikepacking.gpx`
}

export function buildGpx(plan: ExpeditionPlan): string {
  const trackPoints = plan.route.geometry.coordinates
    .map(
      ([lng, lat, elevation]) =>
        `      <trkpt lat="${lat}" lon="${lng}">${elevation === undefined ? '' : `<ele>${elevation}</ele>`}</trkpt>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Waypoint Bikepacking Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(plan.input.start.label)} to ${escapeXml(plan.input.destination.label)}</name></metadata>
  <trk>
    <name>${escapeXml(plan.input.start.label)} to ${escapeXml(plan.input.destination.label)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`
}

export function downloadGpx(plan: ExpeditionPlan): void {
  const blob = new Blob([buildGpx(plan)], { type: 'application/gpx+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = gpxFilename(plan)
  link.click()
  URL.revokeObjectURL(url)
}
