# brott-island

A cozy robot island sim. Brotts maintain a multi-source power station on a small temperate-green coastal island, balancing tidal, wave, wind, and geothermal generation against weather, equipment wear, and a mainland power commitment.

## What it is

Minutes-scale watchable simulation. Small named cast of robots (Brotts) inherits a dormant outpost and brings it back online (Phase 1), then keeps it running (Phase 2). Watcher has light input (placement, parameter tweaks, occasional intervention) — Brotts run autonomously by rule-based behavior, no LLM in the loop.

Web stack, deployed to GitHub Pages. Headless sim mode from day 1 so an agent can iterate overnight against a fitness signal (kWh delivered, uptime, equipment health).

## Design lock (2026-05-27)

- **Setting:** small temperate-green coastal island
- **Outpost:** multi-source power station — tidal, wave, wind, geothermal — transmitting to mainland
- **Brotts:** small named cast of robots, individuals matter, you can name them
- **Phases:** recovery → ongoing operations
- **Watch scale:** minutes per session, fast-forward later for ambient
- **Player role:** watcher with light input (gardener/nudge mode)
- **Stack:** TypeScript + Canvas 2D, Vite, deployed to GitHub Pages

## Day 1 scope

Multiple Brotts (up to 4) operating one or more tidal generators, with per-Brott job assignment. Three verbs:

1. **Clean** — generator accumulates fouling over time, output drops
2. **Recharge** — Brott energy depletes with activity, return to charger
3. **Collect debris** — driftwood washes up at the intake, produces salvage

Salvage is a visible counter with no use yet. Milestone 2 spends salvage to build a second generator — first real progression beat.

**Phase 1 (recovery):** sim opens with a dormant outpost — generator and water intake at 0 health, charger online. The starter Brott repairs structures (**repair** is a fourth verb, available from day 1 on the starter Brott) until all three starter structures hit health ≥ 0.8. At that point the world transitions to Phase 2 (ongoing ops): generator starts producing, debris starts spawning, build buttons unlock, and auto-build (when enabled) starts firing. With the default seed this transition happens around tick ~545.

## Architecture

```
src/
  sim/        # pure simulation, no DOM, headless-runnable
    types.ts  # Brott, Structure, World, Event
    world.ts  # state + tick()
    brott.ts  # behavior / decision logic
    rng.ts    # seeded RNG so runs are reproducible
  render/     # Canvas 2D rendering, reads sim state, never writes it
    scene.ts
  main.ts     # browser entry: sim + render loop
  headless.ts # node entry: run N ticks, emit metrics JSON
```

**Hard rule:** `src/sim/` must be free of `window`, `document`, `Canvas`, or any DOM symbol. The sim runs identically in browser and Node so the agent's headless iteration is bit-for-bit comparable to what a human watches.

**Progression-ready, not progression-implemented.** Day 1 data model includes:

- `Brott.capabilities: string[]` (day 1: `['clean','recharge','collect']`)
- `Structure.tier: number` (day 1: all `1`)
- generic `Inventory` map (day 1: `power`, `salvage`)
- `research/tree.json` (day 1: empty)

These are scaffolding for milestone 2+ so we don't have to rewrite types when we add the second generator, the repair tool, or the second Brott.

## Run it

```bash
npm install
npm run dev       # browser, hot reload
npm run build     # production build to dist/
npm run headless  # node, run N ticks, print metrics
npm test          # vitest, sim correctness
```

## Headless harness

`npm run headless -- --seed 42 --ticks 10000 --json` runs the sim with no rendering and emits a metrics blob. The agent's overnight loop:

1. Pick a variant (rule tweak, parameter, Brott policy)
2. Run headless with N seeds
3. Aggregate metrics (mean kWh delivered, uptime %, downtime events)
4. Compare to baseline
5. PR or roll back

This is the *whole point* of the project — not the game, the loop around the game.

## Status

Phase 0 — scaffolding. Day 1 loop not yet runnable. Track in [issues](https://github.com/brotatotes/brott-island/issues).

## Headless optimization loop

The sim has an opt-in **auto-build policy** (`SimConfig.autoBuild`) that automatically spends salvage on new brotts/generators while the sim runs. Off by default for human play; turned on for headless variant sweeps.

Knobs (see `src/sim/types.ts → AutoBuildPolicy`):

- `brottPerGenTarget` — desired brott/gen ratio; builds a brott when current ratio drops below this, else builds a generator.
- `maxIdleRatio` — skip building if recent brott-idle ratio exceeds this (don't overcrowd).
- `buildCooldownTicks` — minimum ticks between builds.
- `windRatio` (0..1) — when building a generator, probability of building a wind turbine vs tidal. `0` = all-tidal (baseline), `0.5` = balanced mix, `1.0` = all-wind. Nightly eval sweeps this across 7 values.

### Wind vs tidal

Two generator types with different risk profiles:

- **Tidal generators** are offshore + submerged. Steady output, accumulate fouling over time (cleaned by the brott `clean` verb), immune to storms.
- **Wind turbines** are on-land. Higher peak output (320 base) but intermittent (driven by a wind cycle, mean ~0.7), and **vulnerable to storms** — every ~1250 ticks a storm event damages each live turbine independently (95% hit chance, 5–18% health loss). Brotts auto-repair via the existing `repair` verb. Larger wind fleets get hit harder per storm, so all-wind builds are higher mean but higher variance.

Current tuning (50k ticks, 8 seeds):

| variant | mean delivered | vs baseline | CV |
| --- | ---: | ---: | ---: |
| baseline (all tidal) | 16,154,551 | +0.0% | 2.5% |
| balanced (windRatio=0.5) | 17,174,156 | +6.3% | 3.4% |
| wind-only (windRatio=1.0) | 21,184,359 | +31.1% | 4.8% |

Balanced beats baseline cleanly; wind-only is the high-mean/high-variance gamble.


### Eval harness

```bash
npm run eval -- --variants eval-variants.json --seeds 8 --ticks 50000 --out eval-results/
```

Runs each variant (see [`eval-variants.json`](./eval-variants.json)) across N seeds, aggregates `delivered`, `uptime %`, and final entity counts, writes `eval-results/<git-sha>.json`, and prints a markdown digest.

### Watch the policy run

```bash
npm run headless -- --auto-build --ticks 50000
```

### Nightly cron

A `brott-sim-nightly` cron job (3 AM ET) re-runs the eval against the latest `main`, commits the new `eval-results/<sha>.json`, and posts a top-3 digest to Discord `#brott-sim`.

## License

MIT.
