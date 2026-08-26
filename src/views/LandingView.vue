<script setup lang="ts">
import { RouterLink } from 'vue-router'

import '@/landing.css'
</script>

<template>
  <main class="landing-page">
    <nav class="landing-nav" aria-label="Primary">
      <div class="landing-nav-inner">
        <RouterLink class="brand-mark landing-brand" to="/" aria-label="Waypoint home">
          <span>WAYPOINT</span><b aria-hidden="true">/</b><span>EXPEDITION</span>
        </RouterLink>
        <div class="landing-nav-meta">
          <span class="topbar-note">WEBMCP CHALLENGE / 2026</span>
          <RouterLink class="landing-nav-link" to="/planner"
            >Open planner <span aria-hidden="true">↗</span></RouterLink
          >
        </div>
      </div>
    </nav>

    <section class="landing-hero shell-width" aria-labelledby="landing-title">
      <div class="landing-copy">
        <p class="landing-kicker">
          <span class="landing-kicker-mark" aria-hidden="true" /> Multi-day route planning
        </p>
        <h1 id="landing-title">
          Two places in
          <span>A ride you can actually picture.</span>
        </h1>
        <p class="landing-lede">
          Waypoint turns a start, destination, and a little honest self-knowledge into a cycling
          expedition with stages, elevation, and a route you can take with you.
        </p>
        <div class="landing-actions">
          <RouterLink class="button button--primary" to="/planner?example=sf-santa-cruz"
            >Plan a sample expedition <span aria-hidden="true">↗</span></RouterLink
          >
          <RouterLink class="button button--ghost" to="/planner">Start from scratch</RouterLink>
        </div>
      </div>

      <figure
        class="landing-route-card"
        aria-label="Example expedition from San Francisco to Santa Cruz"
      >
        <figcaption class="route-card-header">
          <span>FIELD NOTE / 001</span><span>CURATED EXAMPLE</span>
        </figcaption>
        <div class="route-card-line">
          <span class="route-node route-node--start" aria-hidden="true" />
          <div><small>START</small><strong>San Francisco</strong></div>
        </div>
        <div class="route-card-track" aria-hidden="true">
          <span class="track-mark track-mark--one" /><span
            class="track-mark track-mark--two"
          /><span class="track-mark track-mark--three" />
        </div>
        <div class="route-card-line route-card-line--end">
          <span class="route-node route-node--end" aria-hidden="true" />
          <div><small>DESTINATION</small><strong>Santa Cruz</strong></div>
        </div>
        <div class="route-card-footer">
          <span><b>3</b><small>DAYS</small></span
          ><span><b>~ 124</b><small>KM</small></span
          ><span><b>↑ 1,937</b><small>M ASCENT</small></span>
        </div>
      </figure>
    </section>

    <section class="landing-proof shell-width" aria-labelledby="proof-title">
      <div class="proof-intro">
        <p class="proof-kicker">READ THE ROUTE</p>
        <h2 id="proof-title">The useful part is what the map leaves out.</h2>
        <p>Waypoint keeps the tradeoffs visible before you commit to the first turn.</p>
      </div>
      <ol class="proof-list">
        <li>
          <span class="proof-number">01</span>
          <div>
            <strong>Know your days</strong>
            <p>See a practical rhythm, not just a line on a map.</p>
          </div>
        </li>
        <li>
          <span class="proof-number">02</span>
          <div>
            <strong>Read the terrain</strong>
            <p>Climb totals and a full-route profile make effort visible.</p>
          </div>
        </li>
        <li>
          <span class="proof-number">03</span>
          <div>
            <strong>Ask it structurally</strong>
            <p>The same planner is available as WebMCP tools for an agent.</p>
          </div>
        </li>
      </ol>
    </section>

    <footer class="landing-footer shell-width">
      <p class="landing-footer-statement">Real routes. Clear tradeoffs. No brave guesses.</p>
      <div class="landing-footer-meta">
        <span>WAYPOINT / 2026</span>
        <span>Built for the WebMCP Challenge</span>
        <RouterLink class="landing-footer-link" to="/planner"
          >Plan an expedition <span aria-hidden="true">↗</span></RouterLink
        >
      </div>
    </footer>
  </main>
</template>
