import { describe, expect, it } from 'vitest'

import { toElevationChartPoints } from '@/application/elevation-chart'

describe('elevation chart points', () => {
  it('uses cumulative distance for the linear x axis', () => {
    expect(
      toElevationChartPoints(
        [
          { lng: 0, lat: 0, distanceFromStartMeters: 0, elevationMeters: 10 },
          { lng: 1, lat: 0, distanceFromStartMeters: 278_000, elevationMeters: 20 },
          { lng: 2, lat: 0, distanceFromStartMeters: 1_000_000, elevationMeters: 30 },
        ],
        'metric',
      ),
    ).toEqual([
      { x: 0, y: 10 },
      { x: 278, y: 20 },
      { x: 1000, y: 30 },
    ])
  })
})
