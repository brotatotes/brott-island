// World tick. Deterministic given (world, config, rng).

import { makeRng, Rng } from './rng';
import { Brott, SimConfig, Structure, World, DEFAULT_CONFIG, isGenerator } from './types';
import { decideTask } from './brott';

/**
 * Deterministic wind multiplier for the given tick.
 * Returns a value in [0.1, 1.0]. Mean is roughly 0.5 over long horizons —
 * wind turbines produce ~half the throughput of an equally-rated tidal
 * generator on average, but with high variance (intermittency is the point).
 */
export function windFactor(tick: number): number {
  const TWO_PI = Math.PI * 2;
  // Two sine components: a slow ~700-tick weather cycle plus a faster ~137-tick gust pattern.
  const slow = Math.sin((tick / 700) * TWO_PI);
  const fast = Math.sin((tick / 137) * TWO_PI + 1.3);
  const raw = 0.5 + 0.3 * slow + 0.2 * fast;
  if (raw < 0.1) return 0.1;
  if (raw > 1.0) return 1.0;
  return raw;
}

export interface SimOptions {
  seed?: number;
  config?: Partial<SimConfig>;
}

export function createWorld(opts: SimOptions = {}): { world: World; rng: Rng; config: SimConfig } {
  const seed = opts.seed ?? 1;
  const rng = makeRng(seed);
  const config: SimConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };

  const charger: Structure = {
    id: 'charger-1', kind: 'charger', pos: { x: 8, y: 10 },
    tier: 1, health: 1, fouling: 0, outputBase: 0,
  };
  const generator: Structure = {
    id: 'tidal-1', kind: 'tidal_generator', pos: { x: 28, y: 14 },
    tier: 1, health: 0, fouling: 0, outputBase: 100,
  };
  const intake: Structure = {
    id: 'intake-1', kind: 'intake', pos: { x: 34, y: 18 },
    tier: 1, health: 0, fouling: 0, outputBase: 0,
  };

  const brott: Brott = {
    id: 'brott-1',
    name: 'Brott-001',
    pos: { x: 8, y: 10 },
    energy: 1,
    capabilities: ['clean', 'recharge', 'collect', 'repair'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
  };

  const world: World = {
    tick: 0,
    phase: 'recovery',
    rngState: seed,
    brotts: [brott],
    structures: [charger, generator, intake],
    debris: [],
    inventory: { power: 0, salvage: 0 },
    metrics: {
      totalPowerGenerated: 0,
      totalPowerDelivered: 0,
      debrisCollected: 0,
      ticksAtFullOutput: 0,
    },
    lastBuildTick: 0,
    brottIdleHistory: [],
  };

  return { world, rng, config };
}

function stepBrott(world: World, brott: Brott, config: SimConfig): void {
  // Re-decide if idle or task target gone
  if (brott.task.kind === 'idle') {
    brott.task = decideTask(world, brott, config);
  }
  // Validate target still exists
  if (brott.task.targetId) {
    const stillExists =
      world.structures.some(s => s.id === brott.task.targetId) ||
      world.debris.some(d => d.id === brott.task.targetId);
    if (!stillExists) brott.task = { kind: 'idle', progress: 0 };
  }

  switch (brott.task.kind) {
    case 'idle': {
      brott.task = decideTask(world, brott, config);
      break;
    }
    case 'walk': {
      const t = brott.task.targetPos!;
      const dx = t.x - brott.pos.x;
      const dy = t.y - brott.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < config.brottSpeed) {
        brott.pos.x = t.x;
        brott.pos.y = t.y;
        // Arrived: convert to action based on target kind
        const struct = world.structures.find(s => s.id === brott.task.targetId);
        const debris = world.debris.find(de => de.id === brott.task.targetId);
        if (struct?.kind === 'tidal_generator' || struct?.kind === 'wind_turbine') {
          if (struct.health < 0.8) {
            brott.task = { kind: 'repair', targetId: struct.id, progress: 0 };
          } else {
            brott.task = { kind: 'clean', targetId: struct.id, progress: 0 };
          }
        } else if (struct?.kind === 'charger') {
          brott.task = { kind: 'recharge', targetId: struct.id, progress: 0 };
        } else if (struct?.kind === 'intake') {
          if (struct.health < 0.8) {
            brott.task = { kind: 'repair', targetId: struct.id, progress: 0 };
          } else {
            brott.task = { kind: 'idle', progress: 0 };
          }
        } else if (debris) {
          brott.task = { kind: 'collect', targetId: debris.id, progress: 0 };
        } else {
          brott.task = { kind: 'idle', progress: 0 };
        }
      } else {
        brott.pos.x += (dx / d) * config.brottSpeed;
        brott.pos.y += (dy / d) * config.brottSpeed;
        brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      }
      break;
    }
    case 'clean': {
      const gen = world.structures.find(s => s.id === brott.task.targetId);
      if (!gen) { brott.task = { kind: 'idle', progress: 0 }; break; }
      gen.fouling = Math.max(0, gen.fouling - config.cleanRate);
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      if (gen.fouling <= 0.001) {
        gen.fouling = 0;
        brott.task = { kind: 'idle', progress: 0 };
      }
      break;
    }
    case 'recharge': {
      brott.energy = Math.min(1, brott.energy + config.brottRechargeRate);
      if (brott.energy >= 1) brott.task = { kind: 'idle', progress: 0 };
      break;
    }
    case 'repair': {
      const struct = world.structures.find(s => s.id === brott.task.targetId);
      if (!struct) { brott.task = { kind: 'idle', progress: 0 }; break; }
      struct.health = Math.min(1, struct.health + config.repairRate);
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      if (struct.health >= 1) {
        struct.health = 1;
        brott.task = { kind: 'idle', progress: 0 };
      }
      break;
    }
    case 'collect': {
      brott.task.progress += 1 / config.collectDuration;
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      if (brott.task.progress >= 1) {
        const idx = world.debris.findIndex(d => d.id === brott.task.targetId);
        if (idx >= 0) {
          world.debris.splice(idx, 1);
          world.inventory.salvage = (world.inventory.salvage ?? 0) + 2;
          world.metrics.debrisCollected += 1;
        }
        brott.task = { kind: 'idle', progress: 0 };
      }
      break;
    }
  }
}

function stepGenerators(world: World, _config: SimConfig): void {
  const cap = _config.batteryCapacity;
  for (const s of world.structures) {
    if (!isGenerator(s)) continue;
    // Dormant generators (health < 0.8) don't accrue fouling and produce no output.
    if (s.health < 0.8) continue;
    s.fouling = Math.min(1, s.fouling + _config.foulingRatePerTick);
    // Output scales with (1 - fouling) * health, and — for wind turbines — wind factor.
    const envFactor = s.kind === 'wind_turbine' ? windFactor(world.tick) : 1;
    const out = s.outputBase * (1 - s.fouling) * s.health * envFactor;
    world.metrics.totalPowerGenerated += out;
    const before = world.inventory.power ?? 0;
    const after = before + out;
    if (after <= cap) {
      world.inventory.power = after;
    } else {
      world.inventory.power = cap;
      const overflow = after - cap;
      // Overflow auto-transmits to mainland.
      world.metrics.totalPowerDelivered += overflow;
    }
    if (s.fouling < 0.01) world.metrics.ticksAtFullOutput += 1;
  }
}

function maybeSpawnDebris(world: World, config: SimConfig, rng: Rng): void {
  if (rng() < config.debrisSpawnChance) {
    const intake = world.structures.find(s => s.kind === 'intake');
    if (!intake) return;
    // No debris flow until the intake is brought online.
    if (intake.health < 0.8) return;
    // Spawn near intake with small jitter
    const id = `debris-${world.tick}-${Math.floor(rng() * 1e6)}`;
    world.debris.push({
      id,
      pos: { x: intake.pos.x + (rng() - 0.5) * 4, y: intake.pos.y + (rng() - 0.5) * 4 },
    });
  }
}

const IDLE_HISTORY_MAX = 500;

function recordIdleSample(world: World): void {
  // 1 if any brott was idle this tick (after stepping), else 0.
  // "Idle" = task.kind === 'idle' OR 'recharge' at full energy (rare edge).
  const anyIdle = world.brotts.some(b => b.task.kind === 'idle');
  world.brottIdleHistory.push(anyIdle ? 1 : 0);
  if (world.brottIdleHistory.length > IDLE_HISTORY_MAX) {
    world.brottIdleHistory.shift();
  }
}

export function runAutoBuildPolicy(world: World, config: SimConfig): void {
  const p = config.autoBuild;
  if (!p || !p.enabled) return;
  if (world.phase === 'recovery') return;
  if (world.tick - world.lastBuildTick < p.buildCooldownTicks) return;

  // Skip while utilization is too low (brotts mostly idle).
  const hist = world.brottIdleHistory;
  if (hist.length > 0) {
    let sum = 0;
    for (let i = 0; i < hist.length; i++) sum += hist[i];
    const idleRatio = sum / hist.length;
    if (idleRatio > p.maxIdleRatio) return;
  }

  const brottCount = world.brotts.length;
  const genCount = world.structures.filter(isGenerator).length;
  const ratio = brottCount / Math.max(1, genCount);
  const preferBrott = ratio < p.brottPerGenTarget;

  let id: string | null;
  if (preferBrott) {
    id = buildBrott(world);
    if (id === null) id = buildAnyGenerator(world, p);
  } else {
    id = buildAnyGenerator(world, p);
    if (id === null) id = buildBrott(world);
  }
  if (id !== null) {
    world.lastBuildTick = world.tick;
  }
}

export function tick(world: World, config: SimConfig, rng: Rng): void {
  world.tick += 1;
  maybeSpawnDebris(world, config, rng);
  stepGenerators(world, config);
  for (const b of world.brotts) stepBrott(world, b, config);
  recordIdleSample(world);
  maybeTransitionPhase(world);
  runAutoBuildPolicy(world, config);
}

function maybeTransitionPhase(world: World): void {
  if (world.phase !== 'recovery') return;
  const charger = world.structures.find(s => s.id === 'charger-1');
  const gen = world.structures.find(s => s.id === 'tidal-1');
  const intake = world.structures.find(s => s.id === 'intake-1');
  if (!charger || !gen || !intake) return;
  if (charger.health >= 0.8 && gen.health >= 0.8 && intake.health >= 0.8) {
    world.phase = 'operations';
  }
}

export function run(world: World, config: SimConfig, rng: Rng, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world, config, rng);
}

// --- Sim actions (called from UI; keep DOM-free) ---

export const TIDAL_GENERATOR_COST = 50;

// Canvas is 640x400 at TILE=16 → 40x25 tile world. Shore at x=24.
// Generator slots: three water columns (x=27, 32, 37) × five rows (y=4..22),
// 15 total. First slot matches the seeded generator's spot (x=27,y=13 → first slot reused).
const GENERATOR_SLOTS: { x: number; y: number }[] = [
  { x: 28, y: 14 },
  { x: 28, y: 8 },
  { x: 28, y: 20 },
  { x: 34, y: 11 },
  { x: 34, y: 17 },
  { x: 34, y: 5 },
  { x: 34, y: 23 },
  { x: 31, y: 6 },
  { x: 31, y: 11 },
  { x: 31, y: 16 },
  { x: 31, y: 21 },
  { x: 37, y: 8 },
  { x: 37, y: 14 },
  { x: 37, y: 20 },
];

/**
 * Attempt to build a new tidal generator. Returns the new structure id on success, null on failure.
 * Spends `TIDAL_GENERATOR_COST` salvage. Places the generator in the next unoccupied slot
 * inside the visible canvas bounds. Returns null if salvage insufficient OR no slots free.
 */
export function buildTidalGenerator(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < TIDAL_GENERATOR_COST) return null;

  // Find first unoccupied slot.
  const occupied = new Set(
    world.structures
      .filter(s => s.kind === 'tidal_generator')
      .map(s => `${s.pos.x},${s.pos.y}`),
  );
  const slot = GENERATOR_SLOTS.find(s => !occupied.has(`${s.x},${s.y}`));
  if (!slot) return null;

  world.inventory.salvage = (world.inventory.salvage ?? 0) - TIDAL_GENERATOR_COST;

  const n = world.structures.filter(s => s.kind === 'tidal_generator').length + 1;
  const id = `tidal-${n}`;
  world.structures.push({
    id,
    kind: 'tidal_generator',
    pos: { x: slot.x, y: slot.y },
    tier: 1,
    health: 1,
    fouling: 0,
    outputBase: 100,
  });
  return id;
}

export const MAX_TIDAL_GENERATORS = GENERATOR_SLOTS.length;

// --- Brott building ---

export const BROTT_COST = 100;
export const MAX_BROTTS = 10;

/**
 * Attempt to build a new brott. Returns the new brott id on success, null on failure.
 * Spends BROTT_COST salvage. Spawns at the charger position with full energy and 'auto' job.
 * Returns null if salvage insufficient OR max-brotts cap hit.
 */
export function buildBrott(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < BROTT_COST) return null;
  if (world.brotts.length >= MAX_BROTTS) return null;
  const charger = world.structures.find(s => s.kind === 'charger');
  if (!charger) return null;

  world.inventory.salvage = (world.inventory.salvage ?? 0) - BROTT_COST;

  const n = world.brotts.length + 1;
  const id = `brott-${n}`;
  const name = `Brott-${String(n).padStart(3, '0')}`;
  world.brotts.push({
    id,
    name,
    pos: { x: charger.pos.x, y: charger.pos.y },
    energy: 1,
    capabilities: ['clean', 'recharge', 'collect', 'repair'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
  });
  return id;
}

// --- Wind turbine building ---
//
// Design notes (Phase A second-generator type):
//
//   Tidal generator (existing): 100 kW nominal, steady. Output = 100*(1-fouling)*health.
//     Cost 50 salvage. Placed offshore (water columns east of the shore at x=24).
//
//   Wind turbine (new):
//     - Higher nominal rating (120 kW) but weather-modulated.
//     - Wind multiplier ranges [0.1 .. 1.0] with mean ~0.5 (see windFactor()) \u2192
//       average effective throughput ~60 kW vs tidal's steady ~100 kW.
//       Wind is *cheaper per turbine* but *less reliable per turbine*.
//     - Cost 35 salvage (cheaper than tidal). Placed ON LAND \u2014 x < shore (24).
//     - Brotts maintain wind turbines the same way as tidal generators
//       (fouling accrues, cleaning resets it, repair restores health).
//       Justification: the framework already treats both as `isGenerator`,
//       so brott logic + UI build buttons stack cleanly. No new verb required.
//
//   Mix implications (verified by eval):
//     - All-tidal: predictable, high steady delivered.
//     - All-wind: cheaper to scale + more units, but intermittency drags mean.
//     - Mixed: best of both \u2014 wind fills cheap capacity while tidal anchors baseline.

export const WIND_TURBINE_COST = 35;
export const WIND_TURBINE_BASE_OUTPUT = 120;

// Wind turbines live on land (x < SHORE_TILE_X=24). 14 slots scattered across the\n// island so they don't collide with the charger (x=8, y=10) or each other.
const WIND_TURBINE_SLOTS: { x: number; y: number }[] = [
  { x: 4, y: 4 },
  { x: 14, y: 4 },
  { x: 20, y: 4 },
  { x: 4, y: 16 },
  { x: 4, y: 22 },
  { x: 14, y: 22 },
  { x: 20, y: 22 },
  { x: 20, y: 10 },
  { x: 14, y: 16 },
  { x: 14, y: 10 },
  { x: 20, y: 16 },
  { x: 2, y: 10 },
  { x: 11, y: 7 },
  { x: 17, y: 7 },
];

export const MAX_WIND_TURBINES = WIND_TURBINE_SLOTS.length;

/**
 * Attempt to build a new wind turbine. Returns id on success, null on failure.
 * Spends `WIND_TURBINE_COST` salvage. Places at next unoccupied land slot.
 */
export function buildWindTurbine(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < WIND_TURBINE_COST) return null;

  const occupied = new Set(
    world.structures
      .filter(s => s.kind === 'wind_turbine')
      .map(s => `${s.pos.x},${s.pos.y}`),
  );
  const slot = WIND_TURBINE_SLOTS.find(s => !occupied.has(`${s.x},${s.y}`));
  if (!slot) return null;

  world.inventory.salvage = (world.inventory.salvage ?? 0) - WIND_TURBINE_COST;

  const n = world.structures.filter(s => s.kind === 'wind_turbine').length + 1;
  const id = `wind-${n}`;
  world.structures.push({
    id,
    kind: 'wind_turbine',
    pos: { x: slot.x, y: slot.y },
    tier: 1,
    health: 1,
    fouling: 0,
    outputBase: WIND_TURBINE_BASE_OUTPUT,
  });
  return id;
}

/**
 * Auto-build helper: picks tidal or wind based on policy.windRatio.
 * windRatio is the desired fraction of generators that should be wind turbines.
 * windRatio=0 \u2192 always tidal; windRatio=1 \u2192 always wind; 0.5 \u2192 balanced.
 * Falls back to the other type if the preferred type can't build (slots full or unaffordable).
 */
export function buildAnyGenerator(world: World, policy: { windRatio?: number }): string | null {
  const windRatio = policy.windRatio ?? 0;
  const winds = world.structures.filter(s => s.kind === 'wind_turbine').length;
  const tidals = world.structures.filter(s => s.kind === 'tidal_generator').length;
  const total = winds + tidals;
  const currentWindFrac = total === 0 ? 0 : winds / total;
  const preferWind = currentWindFrac < windRatio;

  if (preferWind) {
    const windSlotsFull = winds >= MAX_WIND_TURBINES;
    if (!windSlotsFull) return buildWindTurbine(world);
    return buildTidalGenerator(world);
  } else {
    const tidalSlotsFull = tidals >= MAX_TIDAL_GENERATORS;
    if (!tidalSlotsFull) return buildTidalGenerator(world);
    return buildWindTurbine(world);
  }
}
