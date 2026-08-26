import { createRouter, createWebHistory } from 'vue-router'

import LandingView from '@/views/LandingView.vue'
import PlannerView from '@/views/PlannerView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: LandingView },
    { path: '/planner', name: 'planner', component: PlannerView },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
