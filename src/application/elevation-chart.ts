import type { RoutePoint } from '@shared/contracts/expedition'

export type ElevationChartUnit = 'metric' | 'imperial'

export function toElevationChartPoints(
  points: readonly RoutePoint[],
  units: ElevationChartUnit,
): Array<{ x: number; y: number }> {
  const metersPerDistanceUnit = units === 'imperial' ? 1_609.344 : 1_000
  const elevationMultiplier = units === 'imperial' ? 3.28084 : 1
  return points.map((point) => ({
    x: point.distanceFromStartMeters / metersPerDistanceUnit,
    y: (point.elevationMeters ?? 0) * elevationMultiplier,
  }))
}
