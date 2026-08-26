import { z } from 'zod'

export const BikeTypeSchema = z.enum(['road', 'gravel', 'touring', 'mtb'])
export const RouteProfileSchema = z.enum(['paved-priority', 'mixed-surface'])
export const FitnessLevelSchema = z.enum(['beginner', 'intermediate', 'experienced'])

export const CanonicalLocationSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  locality: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  countryCode: z.string().max(10).optional(),
  settlementType: z.enum(['city', 'town', 'village', 'hamlet']).optional(),
})

export const ExpeditionInputSchema = z.object({
  start: CanonicalLocationSchema,
  destination: CanonicalLocationSchema,
  days: z.number().int().min(2).max(7),
  bikeType: BikeTypeSchema,
  routeProfile: RouteProfileSchema,
  fitness: FitnessLevelSchema,
})

export const DraftExpeditionInputSchema = ExpeditionInputSchema.partial()

export const RouteCoordinateSchema = z.array(z.number().finite()).min(2).max(3)
export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(RouteCoordinateSchema).min(2),
})

export const RoutePointSchema = z.object({
  lng: z.number().finite(),
  lat: z.number().finite(),
  elevationMeters: z.number().finite().optional(),
  distanceFromStartMeters: z.number().finite().nonnegative(),
})

export const NormalizedRouteSchema = z.object({
  geometry: LineStringSchema,
  points: z.array(RoutePointSchema).min(2),
  elevationPoints: z.array(RoutePointSchema).min(2).optional(),
  distanceMeters: z.number().finite().positive(),
  ascentMeters: z.number().finite().nonnegative(),
  descentMeters: z.number().finite().nonnegative(),
})

export const WarningSeveritySchema = z.enum(['info', 'warning'])
export const PlanWarningSchema = z.object({
  code: z.string().min(1),
  severity: WarningSeveritySchema,
  title: z.string().min(1),
  message: z.string().min(1),
})

export const ExpeditionStageSchema = z.object({
  day: z.number().int().min(1),
  startDistanceMeters: z.number().finite().nonnegative(),
  endDistanceMeters: z.number().finite().positive(),
  geometry: LineStringSchema,
  distanceMeters: z.number().finite().positive(),
  ascentMeters: z.number().finite().nonnegative(),
  descentMeters: z.number().finite().nonnegative(),
  start: CanonicalLocationSchema,
  end: CanonicalLocationSchema,
  estimatedRidingTimeSeconds: z.number().finite().positive(),
})

export const FeasibilityResultSchema = z.object({
  level: z.enum(['comfortable', 'demanding']),
  title: z.string().min(1),
  message: z.string().min(1),
  averageDistanceMeters: z.number().finite().positive(),
  recommendedDailyDistanceMeters: z.number().finite().positive(),
})

export const ExpeditionSummarySchema = z.object({
  totalDistanceMeters: z.number().finite().positive(),
  totalAscentMeters: z.number().finite().nonnegative(),
  days: z.number().int().min(2).max(7),
  averageDistanceMeters: z.number().finite().positive(),
  estimatedTotalRidingTimeSeconds: z.number().finite().positive(),
})

export const ProviderProvenanceSchema = z.object({
  routingProvider: z.string().min(1),
  elevationProvider: z.string().min(1),
  settlementProvider: z.string().min(1),
  geocodingProvider: z.string().min(1),
  source: z.enum(['live', 'cached']),
})

export const ExpeditionPlanSchema = z.object({
  id: z.string().uuid(),
  generatedAt: z.string().datetime(),
  input: ExpeditionInputSchema,
  route: NormalizedRouteSchema,
  stages: z.array(ExpeditionStageSchema).min(2),
  summary: ExpeditionSummarySchema,
  feasibility: FeasibilityResultSchema,
  warnings: z.array(PlanWarningSchema),
  provenance: ProviderProvenanceSchema,
})

export const ApiErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: z.string().optional(),
})

export type BikeType = z.infer<typeof BikeTypeSchema>
export type RouteProfile = z.infer<typeof RouteProfileSchema>
export type FitnessLevel = z.infer<typeof FitnessLevelSchema>
export type CanonicalLocation = z.infer<typeof CanonicalLocationSchema>
export type ExpeditionInput = z.infer<typeof ExpeditionInputSchema>
export type DraftExpeditionInput = z.infer<typeof DraftExpeditionInputSchema>
export type RoutePoint = z.infer<typeof RoutePointSchema>
export type LineString = z.infer<typeof LineStringSchema>
export type NormalizedRoute = z.infer<typeof NormalizedRouteSchema>
export type PlanWarning = z.infer<typeof PlanWarningSchema>
export type ExpeditionStage = z.infer<typeof ExpeditionStageSchema>
export type FeasibilityResult = z.infer<typeof FeasibilityResultSchema>
export type ExpeditionSummary = z.infer<typeof ExpeditionSummarySchema>
export type ProviderProvenance = z.infer<typeof ProviderProvenanceSchema>
export type ExpeditionPlan = z.infer<typeof ExpeditionPlanSchema>
export type ApiErrorPayload = z.infer<typeof ApiErrorPayloadSchema>
