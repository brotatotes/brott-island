// World tick. Deterministic given (world, config, rng).

import { makeRng, Rng } from './rng';
import { Brott, SimConfig, Structure, World, DEFAULT_CONFIG } from './types';
import { decideTask } from './brott';

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
    tier: 1, health: 1, fouling: 0, outputBase: 100,
  };
  const intake: Structure = {
    id: 'intake-1', kind: 'intake', pos: { x: 34, y: 18 },
    tier: 1, health: 1, fouling: 0, outputBase: 0,
  };

  const brott: Brott = {
    id: 'brott-1',
    name: 'Brott-001',
    pos: { x: 8, y: 10 },
    energy: 1,
    capabilities: ['clean', 'recharge', 'collect'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
  };

  const world: World = {
    tick: 0,
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
        if (struct?.kind === 'tidal_generator') {
          brott.task = { kind: 'clean', targetId: struct.id, progress: 0 };
        } else if (struct?.kind === 'charger') {
          brott.task = { kind: 'recharge', targetId: struct.id, progress: 0 };
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
    case 'collect': {
      brott.task.progress += 1 / config.collectDuration;
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      if (brott.task.progress >= 1) {
        const idx = world.debris.findIndex(d => d.id === brott.task.targetId);
        if (idx >= 0) {
          world.debris.splice(idx, 1);
          world.inventory.salvage = (world.inventory.salvage ?? 0) + 1;
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
    if (s.kind !== 'tidal_generator') continue;
    s.fouling = Math.min(1, s.fouling + _config.foulingRatePerTick);
    // Output scales with (1 - fouling) * health
    const out = s.outputBase * (1 - s.fouling) * s.health;
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
    // Spawn near intake with small jitter
    const id = `debris-${world.tick}-${Math.floor(rng() * 1e6)}`;
    world.debris.push({
      id,
      pos: { x: intake.pos.x + (rng() - 0.5) * 4, y: intake.pos.y + (rng() - 0.5) * 4 },
    });
  }
}

export function tick(world: World, config: SimConfig, rng: Rng): void {
  world.tick += 1;
  maybeSpawnDebris(world, config, rng);
  stepGenerators(world, config);
  for (const b of world.brotts) stepBrott(world, b, config);
}

export function run(world: World, config: SimConfig, rng: Rng, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world, config, rng);
}

// --- Sim actions (called from UI; keep DOM-free) ---

export const TIDAL_GENERATOR_COST = 50;

// Canvas is 640x400 at TILE=16 → 40x25 tile world. Shore at x=24.
// Generator slots: columns at x=28 and x=34 (in water), y rows spaced 6 apart
// within visible bounds [y=2..23]. First slot matches the seeded generator.
const GENERATOR_SLOTS: { x: number; y: number }[] = [
  { x: 28, y: 14 },
  { x: 28, y: 8 },
  { x: 28, y: 20 },
  { x: 34, y: 11 },
  { x: 34, y: 17 },
  { x: 34, y: 5 },
  { x: 34, y: 23 },
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
export const MAX_BROTTS = 4;

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
    capabilities: ['clean', 'recharge', 'collect'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
  });
  return id;
}
