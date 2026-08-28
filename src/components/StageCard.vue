<script setup lang="ts">
import type { ExpeditionStage } from '@shared/contracts/expedition'
import type { UnitSystem } from '@/stores/planner'
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatEffortLevel,
  formatRelativeEffortLabel,
  formatSettlementType,
} from '@/utils/format'

defineProps<{ stage: ExpeditionStage; units: UnitSystem; active: boolean; isFinal: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>

<template>
  <button
    class="stage-card"
    :class="{ 'stage-card--active': active }"
    :aria-pressed="active"
    type="button"
    @click="emit('select')"
  >
    <span class="stage-day">Day {{ stage.day.toString().padStart(2, '0') }}</span>
    <span class="stage-route"
      ><strong>{{ stage.start.locality ?? stage.start.label }}</strong
      ><span>→</span><strong>{{ stage.end.locality ?? stage.end.label }}</strong></span
    >
    <span class="stage-stat-row"
      ><span>{{ formatDistance(stage.distanceMeters, units) }}</span
      ><span>↑ {{ formatElevation(stage.ascentMeters, units) }}</span
      ><span>~ {{ formatDuration(stage.estimatedRidingTimeSeconds) }}</span></span
    >
    <span v-if="stage.effort" class="stage-effort-row">
      <span>{{ formatEffortLevel(stage.effort.distanceLevel) }}</span>
      <span>{{ formatEffortLevel(stage.effort.climbingLevel) }}</span>
      <span v-for="label in stage.effort.relativeLabels" :key="label" class="stage-effort-label">
        {{ formatRelativeEffortLabel(label) }}
      </span>
    </span>
    <span v-if="isFinal" class="stage-endpoint">Final destination</span>
    <span v-else class="stage-endpoint"
      >Ends at {{ formatSettlementType(stage.end.settlementType).toLowerCase() }}</span
    >
  </button>
</template>
