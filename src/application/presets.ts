import type { DraftExpeditionInput } from '@shared/contracts/expedition'

export type PresetId = 'sf-santa-cruz' | 'amsterdam-brussels' | 'bandung-pangandaran'

export const PRESETS: Record<PresetId, { label: string; input: DraftExpeditionInput }> = {
  'sf-santa-cruz': {
    label: 'San Francisco → Santa Cruz',
    input: {
      start: {
        id: 'preset:sf',
        label: 'San Francisco, California',
        lat: 37.7749,
        lng: -122.4194,
        locality: 'San Francisco',
        region: 'California',
        country: 'United States',
      },
      destination: {
        id: 'preset:santa-cruz',
        label: 'Santa Cruz, California',
        lat: 36.9741,
        lng: -122.0308,
        locality: 'Santa Cruz',
        region: 'California',
        country: 'United States',
      },
      days: 3,
      bikeType: 'gravel',
      routeProfile: 'paved-priority',
      fitness: 'intermediate',
    },
  },
  'amsterdam-brussels': {
    label: 'Amsterdam → Brussels',
    input: {
      start: {
        id: 'preset:amsterdam',
        label: 'Amsterdam, Netherlands',
        lat: 52.3676,
        lng: 4.9041,
        locality: 'Amsterdam',
        country: 'Netherlands',
      },
      destination: {
        id: 'preset:brussels',
        label: 'Brussels, Belgium',
        lat: 50.8503,
        lng: 4.3517,
        locality: 'Brussels',
        country: 'Belgium',
      },
      days: 3,
      bikeType: 'touring',
      routeProfile: 'paved-priority',
      fitness: 'intermediate',
    },
  },
  'bandung-pangandaran': {
    label: 'Bandung → Pangandaran',
    input: {
      start: {
        id: 'preset:bandung',
        label: 'Bandung, West Java',
        lat: -6.9175,
        lng: 107.6191,
        locality: 'Bandung',
        region: 'West Java',
        country: 'Indonesia',
      },
      destination: {
        id: 'preset:pangandaran',
        label: 'Pangandaran, West Java',
        lat: -7.6907,
        lng: 108.353,
        locality: 'Pangandaran',
        region: 'West Java',
        country: 'Indonesia',
      },
      days: 4,
      bikeType: 'gravel',
      routeProfile: 'mixed-surface',
      fitness: 'experienced',
    },
  },
}
