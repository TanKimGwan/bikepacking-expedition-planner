<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L, { type LayerGroup, type Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { CanonicalLocation, ExpeditionPlan } from '@shared/contracts/expedition'

const props = withDefaults(
  defineProps<{
    plan?: ExpeditionPlan | null
    start?: CanonicalLocation
    destination?: CanonicalLocation
    selectedStageDay?: number | null
    pickMode?: 'start' | 'destination' | null
  }>(),
  { plan: null, selectedStageDay: null, pickMode: null },
)

const emit = defineEmits<{ picked: [lat: number, lng: number] }>()
const mapElement = ref<HTMLDivElement | null>(null)
let map: LeafletMap | null = null
let layers: LayerGroup | null = null

function marker(location: CanonicalLocation, color: string, role: 'start' | 'destination') {
  const tooltip = document.createElement('span')
  tooltip.textContent = location.label
  return L.circleMarker([location.lat, location.lng], {
    radius: 7,
    color,
    fillColor: color,
    fillOpacity: 1,
    weight: 3,
    className: `route-marker route-marker--${role}`,
  }).bindTooltip(tooltip)
}

function renderMap() {
  if (!map || !layers) return
  layers.clearLayers()
  const bounds: L.LatLngExpression[] = []
  const selected = props.selectedStageDay
    ? props.plan?.stages.find((stage) => stage.day === props.selectedStageDay)
    : undefined
  if (props.plan) {
    const route = props.plan.route.geometry.coordinates.map(
      ([lng, lat]) => [lat, lng] as L.LatLngExpression,
    )
    const base = L.polyline(route, { color: '#8090a0', weight: 4, opacity: selected ? 0.34 : 0.88 })
    layers.addLayer(base)
    const fitRoute = selected
      ? selected.geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression)
      : route
    fitRoute.forEach((point) => bounds.push(point))
    for (const stage of props.plan.stages) {
      if (!selected || stage.day === selected.day) {
        layers.addLayer(
          L.polyline(
            stage.geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression),
            {
              color: selected ? '#f27b35' : '#d6e4df',
              weight: selected ? 7 : 3,
              opacity: selected ? 0.95 : 0.6,
              dashArray: selected ? undefined : '5 8',
            },
          ),
        )
      }
    }
  }
  if (props.start) {
    layers.addLayer(marker(props.start, '#8bd0b2', 'start'))
    if (!selected) bounds.push([props.start.lat, props.start.lng])
  }
  if (props.destination) {
    layers.addLayer(marker(props.destination, '#f27b35', 'destination'))
    if (!selected) bounds.push([props.destination.lat, props.destination.lng])
  }
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 })
  else if (bounds.length === 1) map.setView(bounds[0], 10)
}

onMounted(async () => {
  await nextTick()
  if (!mapElement.value) return
  map = L.map(mapElement.value, { zoomControl: false, attributionControl: true }).setView(
    [24, 10],
    2,
  )
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map)
  layers = L.layerGroup().addTo(map)
  map.on('click', (event) => {
    if (props.pickMode) emit('picked', event.latlng.lat, event.latlng.lng)
  })
  renderMap()
})

watch(
  () => [
    props.plan?.id,
    props.selectedStageDay,
    props.start?.id,
    props.destination?.id,
    props.pickMode,
  ],
  renderMap,
)
onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div
    ref="mapElement"
    class="route-map"
    :class="{ 'route-map--picking': pickMode }"
    aria-label="Cycling route map"
  />
</template>
