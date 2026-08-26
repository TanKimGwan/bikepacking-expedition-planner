import type { UnitSystem } from '@/stores/planner'

export function formatDistance(meters: number, units: UnitSystem, digits = 0): string {
  const value = units === 'imperial' ? meters / 1_609.344 : meters / 1_000
  return `${value.toFixed(digits)} ${units === 'imperial' ? 'mi' : 'km'}`
}

export function formatElevation(meters: number, units: UnitSystem): string {
  const value = units === 'imperial' ? meters * 3.28084 : meters
  return `${Math.round(value).toLocaleString()} ${units === 'imperial' ? 'ft' : 'm'}`
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`
}

export function formatSettlementType(value?: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : 'Route point'
}
