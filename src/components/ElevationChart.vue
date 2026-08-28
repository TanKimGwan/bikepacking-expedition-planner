<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

import type { ExpeditionPlan } from '@shared/contracts/expedition'
import { toElevationChartPoints } from '@/application/elevation-chart'
import type { UnitSystem } from '@/stores/planner'
import { formatDistance, formatElevation } from '@/utils/format'

Chart.register(LinearScale, LineController, LineElement, PointElement, Tooltip, Filler)
const props = defineProps<{ plan: ExpeditionPlan; units: UnitSystem }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null
const descriptionId = 'elevation-chart-description'
const elevationDescription = computed(
  () =>
    `Elevation profile for ${formatDistance(props.plan.summary.totalDistanceMeters, props.units, 1)} route. Total ascent ${formatElevation(props.plan.summary.totalAscentMeters, props.units)} and total descent ${formatElevation(props.plan.route.descentMeters, props.units)}.`,
)

function render() {
  if (!canvas.value) return
  chart?.destroy()
  const points = props.plan.route.points
  const hasElevation = points.some((point) => point.elevationMeters !== undefined)
  if (!hasElevation) return
  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      datasets: [
        {
          data: toElevationChartPoints(points, props.units),
          borderColor: '#f27b35',
          backgroundColor: 'rgba(242, 123, 53, 0.16)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.22,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) =>
              ` ${formatElevation(Number(context.parsed.y) / (props.units === 'imperial' ? 3.28084 : 1), props.units)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { color: 'rgba(210, 226, 220, 0.12)' },
          ticks: {
            color: '#91a39e',
            maxTicksLimit: 6,
            callback: (value) => `${String(value)} ${props.units === 'imperial' ? 'mi' : 'km'}`,
          },
        },
        y: {
          grid: { color: 'rgba(210, 226, 220, 0.12)' },
          ticks: {
            color: '#91a39e',
            callback: (value) =>
              `${Number(value).toLocaleString()} ${props.units === 'imperial' ? 'ft' : 'm'}`,
          },
        },
      },
    },
  })
}

onMounted(render)
watch(() => [props.plan.id, props.units], render)
onBeforeUnmount(() => chart?.destroy())
</script>

<template>
  <div class="elevation-chart">
    <canvas
      ref="canvas"
      role="img"
      aria-label="Elevation profile"
      :aria-describedby="descriptionId"
    />
    <p :id="descriptionId" class="sr-only">{{ elevationDescription }}</p>
  </div>
</template>
