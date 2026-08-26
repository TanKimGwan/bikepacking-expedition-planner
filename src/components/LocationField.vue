<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import type { CanonicalLocation } from '@shared/contracts/expedition'

import { searchLocations } from '@/api/geocoding-api'

const props = withDefaults(
  defineProps<{
    label: string
    placeholder: string
    modelValue?: CanonicalLocation
    accent: 'mint' | 'orange'
  }>(),
  { modelValue: undefined },
)
const emit = defineEmits<{ selected: [location: CanonicalLocation]; cleared: [] }>()
const query = ref(props.modelValue?.label ?? '')
const results = ref<CanonicalLocation[]>([])
const busy = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.modelValue,
  (value) => {
    if (value && value.label !== query.value) query.value = value.label
  },
)
watch(query, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (value && value !== props.modelValue?.label) emit('cleared')
  if (value.trim().length < 3 || value === props.modelValue?.label) {
    results.value = []
    return
  }
  debounceTimer = setTimeout(async () => {
    busy.value = true
    try {
      results.value = await searchLocations(value.trim())
    } catch {
      results.value = []
    } finally {
      busy.value = false
    }
  }, 350)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function select(location: CanonicalLocation) {
  query.value = location.label
  results.value = []
  emit('selected', location)
}

function clear() {
  query.value = ''
  results.value = []
  emit('cleared')
}
</script>

<template>
  <div class="field-group location-field">
    <label :for="label.toLowerCase().replaceAll(' ', '-')">{{ label }}</label>
    <div class="location-input" :class="`location-input--${accent}`">
      <span class="location-pin" aria-hidden="true">●</span>
      <input
        :id="label.toLowerCase().replaceAll(' ', '-')"
        v-model="query"
        :placeholder="placeholder"
        autocomplete="off"
      />
      <button
        v-if="query"
        class="input-clear"
        type="button"
        :aria-label="`Clear ${label}`"
        @click="clear"
      >
        ×
      </button>
    </div>
    <div v-if="busy" class="field-hint">Searching places…</div>
    <ul v-if="results.length" class="location-results">
      <li v-for="result in results" :key="result.id">
        <button type="button" @click="select(result)">
          <strong>{{ result.locality ?? result.label.split(',')[0] }}</strong>
          <span>{{ result.label }}</span>
        </button>
      </li>
    </ul>
    <div v-else-if="query.length > 0 && query.length < 3" class="field-hint">
      Type 3 or more characters to search.
    </div>
  </div>
</template>
