<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CanonicalLocation } from '@shared/contracts/expedition'

import { reverseGeocode } from '@/api/geocoding-api'
import { PRESETS, type PresetId } from '@/application/presets'
import { downloadGpx } from '@/application/gpx'
import ElevationChart from '@/components/ElevationChart.vue'
import LocationField from '@/components/LocationField.vue'
import RouteMap from '@/components/RouteMap.vue'
import StageCard from '@/components/StageCard.vue'
import { usePlannerStore } from '@/stores/planner'
import { formatDistance, formatDuration, formatElevation } from '@/utils/format'

const route = useRoute()
const planner = usePlannerStore()
const mapPickMode = ref<'start' | 'destination' | null>(null)
const presetId = ref<PresetId | ''>('')
const copiedPlanId = ref(false)

const showParameters = computed(() => planner.hasLocations)
const routeProfileLabel = computed(() =>
  (planner.currentPlan?.input.routeProfile ?? planner.draftInput.routeProfile) === 'mixed-surface'
    ? 'Mixed surface'
    : 'Paved priority',
)
const displayedStart = computed(() => planner.currentPlan?.input.start ?? planner.draftInput.start)
const displayedDestination = computed(
  () => planner.currentPlan?.input.destination ?? planner.draftInput.destination,
)

onMounted(() => {
  const queryPreset = route.query.example
  if (typeof queryPreset === 'string' && queryPreset in PRESETS) {
    presetId.value = queryPreset as PresetId
    planner.setDraft(PRESETS[presetId.value].input)
  }
})

function applyPreset() {
  if (!presetId.value) return
  planner.setDraft(PRESETS[presetId.value].input)
}

function setUnits(value: 'metric' | 'imperial') {
  planner.setUnits(value)
}

async function pickLocation(lat: number, lng: number) {
  if (!mapPickMode.value) return
  const field = mapPickMode.value
  const fallback: CanonicalLocation = {
    id: `map:${lat.toFixed(5)},${lng.toFixed(5)}`,
    label: `Map point ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat,
    lng,
  }
  planner.setLocation(field, fallback)
  mapPickMode.value = null
  try {
    const location = await reverseGeocode(lat, lng)
    if (location) planner.setLocation(field, location)
  } catch {
    // Coordinate labels remain valid when reverse geocoding is unavailable.
  }
}

function selectPreset(value: string) {
  presetId.value = value as PresetId | ''
  applyPreset()
}

async function copyPlanId() {
  if (!planner.currentPlan) return
  await navigator.clipboard?.writeText(planner.currentPlan.id)
  copiedPlanId.value = true
  setTimeout(() => {
    copiedPlanId.value = false
  }, 1500)
}
</script>

<template>
  <main class="planner-page">
    <header class="topbar shell-width planner-topbar">
      <a class="brand-mark" href="/">WAYPOINT <span>/</span> EXPEDITION PLANNER</a>
      <div class="planner-topbar-right">
        <span class="live-dot" /> <span>Route intelligence for humans and agents</span
        ><span v-if="planner.webMcpAvailable" class="agent-chip">WebMCP ready</span>
      </div>
    </header>

    <section class="planner-layout shell-width">
      <div class="control-column">
        <div class="planner-intro">
          <p class="eyebrow"><span class="eyebrow-dot" /> Expedition desk</p>
          <h1>Plan the ride<br /><em>between the dots.</em></h1>
          <p>
            Start with two places. We’ll turn the distance into days you can read, ride, and export.
          </p>
        </div>

        <div class="example-strip">
          <label for="preset">QUICK START</label>
          <select
            id="preset"
            v-model="presetId"
            @change="selectPreset(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Choose a curated route…</option>
            <option v-for="(preset, id) in PRESETS" :key="id" :value="id">
              {{ preset.label }}
            </option>
          </select>
        </div>

        <form class="planning-form" @submit.prevent="planner.generate">
          <div class="form-section-heading">
            <span>01</span>
            <div>
              <strong>Where are you going?</strong><small>Search a place or click the map.</small>
            </div>
          </div>
          <LocationField
            label="Start"
            placeholder="A city, town, or trailhead"
            :model-value="planner.draftInput.start"
            accent="mint"
            @selected="planner.setLocation('start', $event)"
            @cleared="planner.setDraft({ start: undefined })"
          />
          <button
            class="map-pick-button"
            :class="{ active: mapPickMode === 'start' }"
            type="button"
            @click="mapPickMode = mapPickMode === 'start' ? null : 'start'"
          >
            {{ mapPickMode === 'start' ? 'Click the map to place start' : '＋ Set start on map' }}
          </button>
          <LocationField
            label="Destination"
            placeholder="Where the next chapter ends"
            :model-value="planner.draftInput.destination"
            accent="orange"
            @selected="planner.setLocation('destination', $event)"
            @cleared="planner.setDraft({ destination: undefined })"
          />
          <button
            class="map-pick-button"
            :class="{ active: mapPickMode === 'destination' }"
            type="button"
            @click="mapPickMode = mapPickMode === 'destination' ? null : 'destination'"
          >
            {{
              mapPickMode === 'destination'
                ? 'Click the map to place destination'
                : '＋ Set destination on map'
            }}
          </button>

          <Transition name="reveal">
            <div v-if="showParameters" class="parameters-section">
              <div class="form-section-heading">
                <span>02</span>
                <div>
                  <strong>What kind of day feels right?</strong
                  ><small>These choices shape pacing and terrain intent.</small>
                </div>
              </div>
              <div class="parameter-grid">
                <div class="field-group">
                  <label for="days">DAYS</label
                  ><select id="days" v-model.number="planner.draftInput.days">
                    <option v-for="day in [2, 3, 4, 5, 6, 7]" :key="day" :value="day">
                      {{ day }} days
                    </option>
                  </select>
                </div>
                <div class="field-group">
                  <label for="bike">BIKE TYPE</label
                  ><select id="bike" v-model="planner.draftInput.bikeType">
                    <option value="road">Road bike</option>
                    <option value="gravel">Gravel bike</option>
                    <option value="touring">Touring bike</option>
                    <option value="mtb">MTB</option>
                  </select>
                </div>
                <div class="field-group">
                  <label for="profile">ROUTE PROFILE</label
                  ><select id="profile" v-model="planner.draftInput.routeProfile">
                    <option value="paved-priority">Prioritize paved roads</option>
                    <option value="mixed-surface">Mixed surface</option>
                  </select>
                </div>
                <div class="field-group">
                  <label for="fitness">FITNESS</label
                  ><select id="fitness" v-model="planner.draftInput.fitness">
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="experienced">Experienced</option>
                  </select>
                </div>
              </div>
            </div>
          </Transition>
          <button
            class="button button--primary generate-button"
            type="submit"
            :disabled="!planner.canGenerate || planner.status === 'planning'"
          >
            <span>{{
              planner.status === 'planning'
                ? 'Reading the route…'
                : planner.currentPlan
                  ? 'Regenerate expedition'
                  : 'Generate expedition'
            }}</span
            ><span class="button-arrow">↗</span>
          </button>
        </form>

        <div v-if="planner.error" class="error-panel" role="alert">
          <strong>{{ planner.error.code.replaceAll('_', ' ') }}</strong
          ><span>{{ planner.error.message }}</span
          ><small v-if="planner.currentPlan">Your last successful plan is still visible.</small>
        </div>
        <div class="agent-status">
          <span class="agent-status-icon">⌁</span
          ><span v-if="planner.webMcpAvailable"
            ><strong>Agent tools ready.</strong> The same planner can be operated through
            WebMCP.</span
          ><span v-else
            ><strong>Human-first mode.</strong> Agent tools are unavailable in this browser.</span
          >
        </div>
      </div>

      <div class="map-column">
        <div class="map-caption">
          <span v-if="mapPickMode" class="map-pick-caption"
            >Map picking active · {{ mapPickMode }}</span
          ><span v-else>{{
            planner.currentPlan ? 'Live route view' : 'Preview map · click to place a location'
          }}</span
          ><span class="map-legend"
            ><i class="legend-dot legend-dot--mint" /> start
            <i class="legend-dot legend-dot--orange" /> destination</span
          >
        </div>
        <RouteMap
          :plan="planner.currentPlan"
          :start="displayedStart"
          :destination="displayedDestination"
          :selected-stage-day="planner.selectedStageDay"
          :pick-mode="mapPickMode"
          @picked="pickLocation"
        />
        <div v-if="planner.status === 'planning'" class="map-loading">
          <span class="spinner" /> Routing the expedition across real cycling roads…
        </div>
        <div v-else class="map-note">
          <span>⌁</span>
          {{
            planner.currentPlan
              ? `Profile: ${routeProfileLabel} · ${planner.currentPlan.provenance.source === 'cached' ? 'cached demo route' : 'live provider route'}`
              : 'OpenStreetMap base map · route provider loads after Generate'
          }}
        </div>
      </div>
    </section>

    <section v-if="planner.currentPlan" class="results-shell shell-width">
      <div class="result-heading">
        <div>
          <p class="eyebrow"><span class="eyebrow-dot eyebrow-dot--orange" /> Expedition brief</p>
          <h2>
            {{ planner.currentPlan.input.start.locality ?? planner.currentPlan.input.start.label }}
            <span>→</span>
            {{
              planner.currentPlan.input.destination.locality ??
              planner.currentPlan.input.destination.label
            }}
          </h2>
        </div>
        <div class="result-actions">
          <div class="unit-toggle" role="group" aria-label="Unit system">
            <button
              :class="{ active: planner.unitSystem === 'metric' }"
              type="button"
              @click="setUnits('metric')"
            >
              Metric</button
            ><button
              :class="{ active: planner.unitSystem === 'imperial' }"
              type="button"
              @click="setUnits('imperial')"
            >
              Imperial
            </button>
          </div>
          <button
            class="button button--outline"
            type="button"
            @click="downloadGpx(planner.currentPlan)"
          >
            ↓ Export GPX
          </button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-lead">
          <span class="summary-label">TOTAL DISTANCE</span
          ><strong>{{
            formatDistance(planner.currentPlan.summary.totalDistanceMeters, planner.unitSystem, 1)
          }}</strong
          ><span>{{ planner.currentPlan.input.days }} riding days · {{ routeProfileLabel }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-label">ASCENT</span
          ><strong>{{
            formatElevation(planner.currentPlan.summary.totalAscentMeters, planner.unitSystem)
          }}</strong
          ><small>Across full route</small>
        </div>
        <div class="summary-stat">
          <span class="summary-label">AVERAGE / DAY</span
          ><strong>{{
            formatDistance(planner.currentPlan.summary.averageDistanceMeters, planner.unitSystem, 1)
          }}</strong
          ><small>{{ planner.currentPlan.input.fitness }} pace</small>
        </div>
        <div class="summary-stat">
          <span class="summary-label">RIDING TIME</span
          ><strong
            >~
            {{
              formatDuration(planner.currentPlan.summary.estimatedTotalRidingTimeSeconds)
            }}</strong
          ><small>Stops not included</small>
        </div>
      </div>
      <div
        class="feasibility-banner"
        :class="`feasibility-banner--${planner.currentPlan.feasibility.level}`"
      >
        <span class="feasibility-mark">{{
          planner.currentPlan.feasibility.level === 'comfortable' ? '✓' : '!'
        }}</span>
        <div>
          <strong>{{ planner.currentPlan.feasibility.title }}</strong
          ><span>{{ planner.currentPlan.feasibility.message }}</span>
        </div>
        <small>Riding time excludes meal stops, long rests, photos, and mechanical issues.</small>
      </div>
      <div v-if="planner.currentPlan.warnings.length" class="warning-list">
        <div
          v-for="warning in planner.currentPlan.warnings"
          :key="warning.code"
          class="warning-item"
          :class="`warning-item--${warning.severity}`"
        >
          <span>!</span>
          <div>
            <strong>{{ warning.title }}</strong>
            <p>{{ warning.message }}</p>
          </div>
        </div>
      </div>
      <div class="result-columns">
        <div class="stages-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">DAILY STAGES</span>
              <h3>A rhythm for the road</h3>
            </div>
            <span>{{ planner.currentPlan.stages.length }} stages</span>
          </div>
          <div class="stage-list">
            <StageCard
              v-for="stage in planner.currentPlan.stages"
              :key="stage.day"
              :stage="stage"
              :units="planner.unitSystem"
              :active="planner.selectedStageDay === stage.day"
              :is-final="stage.day === planner.currentPlan.stages.length"
              @select="
                planner.selectStage(planner.selectedStageDay === stage.day ? null : stage.day)
              "
            />
          </div>
        </div>
        <div class="elevation-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">ELEVATION PROFILE</span>
              <h3>Read the effort</h3>
            </div>
            <span>Full route</span>
          </div>
          <ElevationChart :plan="planner.currentPlan" :units="planner.unitSystem" />
        </div>
      </div>
      <div class="result-footnote">
        <span
          >PLAN ID
          <button type="button" @click="copyPlanId">
            {{ copiedPlanId ? 'Copied' : planner.currentPlan.id.slice(0, 18) + '…' }}
          </button></span
        ><span>Generated {{ new Date(planner.currentPlan.generatedAt).toLocaleString() }}</span
        ><span
          >Source:
          {{
            planner.currentPlan.provenance.source === 'cached'
              ? 'cached curated fallback'
              : 'live provider pipeline'
          }}</span
        >
      </div>
    </section>
    <footer class="planner-footer shell-width">
      <span>WAYPOINT / Plan with the terrain in mind.</span
      ><span>Metric default · GPX 1.1 · WebMCP tools registered when supported</span>
    </footer>
  </main>
</template>
