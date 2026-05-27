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
  for (const s of world.structures) {
    if (s.kind !== 'tidal_generator') continue;
    s.fouling = Math.min(1, s.fouling + _config.foulingRatePerTick);
    // Output scales with (1 - fouling) * health
    const out = s.outputBase * (1 - s.fouling) * s.health;
    world.metrics.totalPowerGenerated += out;
    // Day 1: power delivered = power generated (no buffer/loss yet)
    world.metrics.totalPowerDelivered += out;
    world.inventory.power = (world.inventory.power ?? 0) + out;
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

/**
 * Attempt to build a new tidal generator. Returns the new structure id on success, null on failure.
 * Spends `TIDAL_GENERATOR_COST` salvage. Places the generator further along the shoreline
 * from existing tidal generators, with a small offset so it doesn't overlap.
 */
export function buildTidalGenerator(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < TIDAL_GENERATOR_COST) return null;
  world.inventory.salvage = (world.inventory.salvage ?? 0) - TIDAL_GENERATOR_COST;

  // Place further along shoreline (y axis) from existing generators.
  const existingGens = world.structures.filter(s => s.kind === 'tidal_generator');
  const baseX = existingGens.length > 0 ? existingGens[0].pos.x : 28;
  const maxY = existingGens.reduce((m, s) => Math.max(m, s.pos.y), 0);
  const newPos = { x: baseX, y: maxY + 6 };

  const n = existingGens.length + 1;
  const id = `tidal-${n}`;
  world.structures.push({
    id,
    kind: 'tidal_generator',
    pos: newPos,
    tier: 1,
    health: 1,
    fouling: 0,
    outputBase: 100,
  });
  return id;
}
