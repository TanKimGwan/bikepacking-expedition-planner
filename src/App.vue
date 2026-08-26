<script setup lang="ts">
import { onMounted } from 'vue'

import { registerWebMcp } from '@/webmcp/registry'
import { usePlannerStore } from '@/stores/planner'

const planner = usePlannerStore()
onMounted(async () => {
  await planner.restore()
  registerWebMcp(planner)
})
</script>

<template>
  <RouterView />
</template>
