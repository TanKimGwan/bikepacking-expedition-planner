<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="landing-page">
    <nav class="topbar shell-width">
      <RouterLink class="brand-mark" to="/">WAYPOINT <span>/</span> EXPEDITION PLANNER</RouterLink>
      <span class="topbar-note">Built for the WebMCP Challenge</span>
    </nav>
    <section class="landing-hero shell-width">
      <div class="landing-copy">
        <p class="eyebrow">
          <span class="eyebrow-dot" /> Multi-day route planning for the first ride beyond the
          familiar
        </p>
        <h1>Two places in. <em>A ride you can actually picture.</em></h1>
        <p class="landing-lede">
          Waypoint turns a start, destination, and a little honest self-knowledge into a cycling
          expedition with stages, elevation, and a route you can take with you.
        </p>
        <div class="landing-actions">
          <RouterLink class="button button--primary" to="/planner?example=sf-santa-cruz"
            >Plan a sample expedition <span>↗</span></RouterLink
          >
          <RouterLink class="button button--ghost" to="/planner">Start from scratch</RouterLink>
        </div>
      </div>
      <div class="landing-route-card" aria-label="Example expedition preview">
        <div class="route-card-header">
          <span>FIELD NOTE / 001</span><span>LIVE ROUTE IDEA</span>
        </div>
        <div class="route-card-line">
          <span class="route-node route-node--start" />
          <div><small>START</small><strong>San Francisco</strong></div>
        </div>
        <div class="route-card-track">
          <span class="track-mark track-mark--one" /><span
            class="track-mark track-mark--two"
          /><span class="track-mark track-mark--three" />
        </div>
        <div class="route-card-line route-card-line--end">
          <span class="route-node route-node--end" />
          <div><small>DESTINATION</small><strong>Santa Cruz</strong></div>
        </div>
        <div class="route-card-footer">
          <span><b>3</b> days</span><span><b>~ 130</b> km</span><span><b>↑ 1,050</b> m</span>
        </div>
      </div>
    </section>
    <section class="landing-proof shell-width">
      <div>
        <span class="proof-number">01</span><strong>Know your days</strong>
        <p>See a practical rhythm, not just a line on a map.</p>
      </div>
      <div>
        <span class="proof-number">02</span><strong>Read the terrain</strong>
        <p>Climb totals and a full-route profile make effort visible.</p>
      </div>
      <div>
        <span class="proof-number">03</span><strong>Ask it structurally</strong>
        <p>The same planner is available as WebMCP tools for an agent.</p>
      </div>
    </section>
    <footer class="landing-footer shell-width">
      <span>Waypoint / 2026</span><span>Real routes. Clear tradeoffs. No brave guesses.</span>
    </footer>
  </main>
</template>
