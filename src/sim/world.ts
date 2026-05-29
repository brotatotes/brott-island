// World tick. Deterministic given (world, config, rng).

import { makeRng, Rng } from './rng';
import {
  Brott, SimConfig, Structure, World, DEFAULT_CONFIG,
  isGenerator, isParasitic, isBasicProducer,
} from './types';
import { decideTask } from './brott';

/**
 * Deterministic wind multiplier for the given tick.
 */
export function windFactor(tick: number, mean: number = 0.5): number {
  const TWO_PI = Math.PI * 2;
  const slow = Math.sin((tick / 700) * TWO_PI);
  const fast = Math.sin((tick / 137) * TWO_PI + 1.3);
  const raw = mean + 0.3 * slow + 0.2 * fast;
  if (raw < 0.1) return 0.1;
  if (raw > 1.2) return 1.2;
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

  // Phase C re-staged opening: the SOLAR recharge station is the first thing
  // standing. Wind turbine is dormant. Tidal generator is dormant. Intake is
  // dormant. Player learns mechanics by repairing in this order:
  //   1. solar station (already up — teaches "this is safe")
  //   2. wind turbine  (basic, self-sustaining)
  //   3. tidal generator (parasitic, powerhouse)
  //   4. intake (debris → salvage flow)
  const solarStation: Structure = {
    id: 'station-1', kind: 'recharge_station', pos: { x: 8, y: 10 },
    tier: 1, health: 1, fouling: 0, outputBase: 0,
    online: true, solar: true,
  };
  const windTurbine: Structure = {
    id: 'wind-1', kind: 'wind_turbine', pos: { x: 14, y: 10 },
    tier: 1, health: 0, fouling: 0, outputBase: 320,
    online: true,
  };
  const tidal: Structure = {
    id: 'tidal-1', kind: 'tidal_generator', pos: { x: 28, y: 14 },
    tier: 1, health: 0, fouling: 0, outputBase: 100,
    online: true,
  };
  const intake: Structure = {
    id: 'intake-1', kind: 'intake', pos: { x: 34, y: 18 },
    tier: 1, health: 0, fouling: 0, outputBase: 0,
    online: true,
  };

  const brott: Brott = {
    id: 'brott-1',
    name: 'Brott-001',
    pos: { x: 8, y: 10 },
    energy: 1,
    capabilities: ['clean', 'recharge', 'collect', 'repair', 'restart'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
    stationId: 'station-1',
  };

  const world: World = {
    tick: 0,
    phase: 'recovery',
    rngState: seed,
    brotts: [brott],
    structures: [solarStation, windTurbine, tidal, intake],
    debris: [],
    inventory: { power: 0, salvage: 0 },
    metrics: {
      totalPowerGenerated: 0,
      totalPowerDelivered: 0,
      totalPowerConsumed: 0,
      totalPowerWasted: 0,
      debrisCollected: 0,
      ticksAtFullOutput: 0,
      ticksSurvived: 0,
      blackouts: 0,
      restarts: 0,
      brottTickAliveSum: 0,
      deaths: 0,
    },
    lastBuildTick: 0,
    brottIdleHistory: [],
    events: [],
    gameOver: false,
    lowBatteryAlarmFired: false,
  };

  return { world, rng, config };
}

function stepBrott(world: World, brott: Brott, config: SimConfig): void {
  if (brott.task.kind === 'idle') {
    brott.task = decideTask(world, brott, config);
  }
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
        const struct = world.structures.find(s => s.id === brott.task.targetId);
        const debris = world.debris.find(de => de.id === brott.task.targetId);
        if (struct && (struct.kind === 'tidal_generator' || struct.kind === 'wind_turbine')) {
          if (struct.health < 0.8) {
            brott.task = { kind: 'repair', targetId: struct.id, progress: 0 };
          } else if (!struct.online) {
            brott.task = { kind: 'restart', targetId: struct.id, progress: 0 };
          } else {
            brott.task = { kind: 'clean', targetId: struct.id, progress: 0 };
          }
        } else if (struct?.kind === 'recharge_station') {
          if (struct.health < 0.8) {
            brott.task = { kind: 'repair', targetId: struct.id, progress: 0 };
          } else if (!struct.online) {
            brott.task = { kind: 'restart', targetId: struct.id, progress: 0 };
          } else {
            brott.task = { kind: 'recharge', targetId: struct.id, progress: 0 };
          }
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
      if (!gen || !gen.online) { brott.task = { kind: 'idle', progress: 0 }; break; }
      gen.fouling = Math.max(0, gen.fouling - config.cleanRate);
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick);
      if (gen.fouling <= 0.001) {
        gen.fouling = 0;
        brott.task = { kind: 'idle', progress: 0 };
      }
      break;
    }
    case 'recharge': {
      const station = world.structures.find(s => s.id === brott.task.targetId);
      if (!station || !station.online) { brott.task = { kind: 'idle', progress: 0 }; break; }
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
    case 'restart': {
      const struct = world.structures.find(s => s.id === brott.task.targetId);
      if (!struct) { brott.task = { kind: 'idle', progress: 0 }; break; }
      // Guard: don't restart if battery has dropped below threshold again.
      const cap = config.batteryCapacity;
      const thresh = cap * config.batteryRestartThreshold;
      if ((world.inventory.power ?? 0) < thresh) {
        brott.task = { kind: 'idle', progress: 0 };
        break;
      }
      if (struct.online || struct.health < 0.8) {
        brott.task = { kind: 'idle', progress: 0 };
        break;
      }
      brott.task.progress += config.restartRate;
      brott.energy = Math.max(0, brott.energy - config.brottEnergyDrainPerTick * 2);
      if (brott.task.progress >= 1) {
        struct.online = true;
        world.metrics.restarts += 1;
        world.events.push({ tick: world.tick, kind: 'restart', targetId: struct.id, magnitude: 0 });
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

/**
 * Step generators, recharge stations, and battery flow.
 * - Wind turbines: produce, zero draw, always-on (basic).
 * - Tidal generators: produce, parasitic draw, blackout-disable on battery zero.
 * - Solar station: trickle-produces, zero draw, always-on.
 * - Plain stations: zero produce, idle + active draw, blackout-disable.
 * - Damaged structures (<0.8) produce/draw nothing.
 */
function stepPowerFlow(world: World, config: SimConfig): void {
  const cap = config.batteryCapacity;
  let inflow = 0;
  let outflow = 0;

  // Count active rechargers per station for active-draw accounting.
  const activeRechargersByStation = new Map<string, number>();
  for (const b of world.brotts) {
    if (b.task.kind === 'recharge' && b.task.targetId) {
      activeRechargersByStation.set(
        b.task.targetId,
        (activeRechargersByStation.get(b.task.targetId) ?? 0) + 1,
      );
    }
  }

  for (const s of world.structures) {
    if (s.health < 0.8) continue;
    if (!s.online) continue;

    if (s.kind === 'wind_turbine') {
      s.fouling = Math.min(1, s.fouling + config.foulingRatePerTick);
      const envFactor = windFactor(world.tick, config.windMeanFactor);
      const out = s.outputBase * (1 - s.fouling) * s.health * envFactor;
      inflow += out;
      if (s.fouling < 0.01) world.metrics.ticksAtFullOutput += 1;
    } else if (s.kind === 'tidal_generator') {
      s.fouling = Math.min(1, s.fouling + config.foulingRatePerTick);
      const out = s.outputBase * (1 - s.fouling) * s.health;
      inflow += out;
      outflow += config.tidalParasiticDraw;
      if (s.fouling < 0.01) world.metrics.ticksAtFullOutput += 1;
    } else if (s.kind === 'recharge_station') {
      if (s.solar) {
        inflow += config.solarTrickleOutput;
        // Active recharging at a solar station draws from battery (solar covers idle but Brott load extra)
        const active = activeRechargersByStation.get(s.id) ?? 0;
        // Solar station: idle is covered by panel; active recharge still draws extra
        outflow += active * config.rechargeStationActiveDraw;
      } else {
        outflow += config.rechargeStationIdleDraw;
        const active = activeRechargersByStation.get(s.id) ?? 0;
        outflow += active * config.rechargeStationActiveDraw;
      }
    }
  }

  world.metrics.totalPowerGenerated += inflow;
  world.metrics.totalPowerConsumed += outflow;

  let battery = world.inventory.power ?? 0;
  battery += inflow;
  battery -= outflow;
  if (battery > cap) {
    const waste = battery - cap;
    world.metrics.totalPowerWasted += waste;
    world.metrics.totalPowerDelivered += waste; // legacy "delivered" = overflow wasted
    battery = cap;
  }
  if (battery < 0) battery = 0;
  world.inventory.power = battery;

  // Blackout cascade: battery exactly zero → every parasitic structure goes offline.
  if (battery <= 0) {
    let firedAny = false;
    for (const s of world.structures) {
      if (isParasitic(s) && s.online) {
        s.online = false;
        firedAny = true;
        world.events.push({ tick: world.tick, kind: 'blackout', targetId: s.id, magnitude: 0 });
      }
    }
    if (firedAny) world.metrics.blackouts += 1;
  }

  // First-time low-battery alarm.
  if (
    !world.lowBatteryAlarmFired &&
    battery > 0 &&
    battery / cap < config.lowBatteryAlarmThreshold &&
    world.phase === 'operations'
  ) {
    world.lowBatteryAlarmFired = true;
    world.events.push({ tick: world.tick, kind: 'low_battery_first', targetId: '', magnitude: battery / cap });
  }
}

function maybeSpawnDebris(world: World, config: SimConfig, rng: Rng): void {
  if (rng() < config.debrisSpawnChance) {
    const intake = world.structures.find(s => s.kind === 'intake');
    if (!intake) return;
    if (intake.health < 0.8) return;
    const id = `debris-${world.tick}-${Math.floor(rng() * 1e6)}`;
    world.debris.push({
      id,
      pos: { x: intake.pos.x + (rng() - 0.5) * 4, y: intake.pos.y + (rng() - 0.5) * 4 },
    });
  }
}

const IDLE_HISTORY_MAX = 500;

function recordIdleSample(world: World): void {
  const anyIdle = world.brotts.some(b => b.task.kind === 'idle');
  world.brottIdleHistory.push(anyIdle ? 1 : 0);
  if (world.brottIdleHistory.length > IDLE_HISTORY_MAX) {
    world.brottIdleHistory.shift();
  }
}

/**
 * Brott death: any Brott whose energy hits exactly zero dies. Slot freed
 * (station no longer "occupied" by them). Brott removed from world.brotts.
 */
function maybeKillBrotts(world: World): void {
  if (world.brotts.length === 0) return;
  const survivors: Brott[] = [];
  for (const b of world.brotts) {
    if (b.energy <= 0) {
      world.metrics.deaths += 1;
      world.events.push({ tick: world.tick, kind: 'brott_died', targetId: b.id, magnitude: 0 });
      // freed slot — auto-build / build menu can refill.
    } else {
      survivors.push(b);
    }
  }
  if (survivors.length !== world.brotts.length) {
    world.brotts = survivors;
  }
}

/**
 * Game over: no Brotts left, OR battery at zero with no basic producers (no path to recover).
 */
function checkGameOver(world: World): void {
  if (world.gameOver) return;
  if (world.phase !== 'operations') return;
  const battery = world.inventory.power ?? 0;
  const anyBasic = world.structures.some(s => isBasicProducer(s));
  const anyBrott = world.brotts.length > 0;
  if (!anyBrott && battery <= 0) {
    world.gameOver = true;
    world.events.push({ tick: world.tick, kind: 'game_over', targetId: 'no_brotts_no_battery', magnitude: 0 });
    return;
  }
  if (!anyBasic && battery <= 0) {
    world.gameOver = true;
    world.events.push({ tick: world.tick, kind: 'game_over', targetId: 'no_basic_gen', magnitude: 0 });
    return;
  }
}

export function runAutoBuildPolicy(world: World, config: SimConfig): void {
  const p = config.autoBuild;
  if (!p || !p.enabled) return;
  if (world.phase === 'recovery') return;
  if (world.gameOver) return;
  if (world.tick - world.lastBuildTick < p.buildCooldownTicks) return;

  const hist = world.brottIdleHistory;
  if (hist.length > 0) {
    let sum = 0;
    for (let i = 0; i < hist.length; i++) sum += hist[i];
    const idleRatio = sum / hist.length;
    if (idleRatio > p.maxIdleRatio) return;
  }

  const brottCount = world.brotts.length;
  const stations = world.structures.filter(s => s.kind === 'recharge_station');
  const stationCount = stations.length;
  const genCount = world.structures.filter(isGenerator).length;

  // Brott cap = station count
  const hasOpenSlot = brottCount < stationCount;
  const totalStructures = stationCount + genCount;
  const stationRatio = totalStructures === 0 ? 0 : stationCount / totalStructures;
  const wantMoreStations = stationRatio < (p.rechargeStationRatio ?? 0);

  const ratio = brottCount / Math.max(1, genCount);
  const wantBrott = ratio < p.brottPerGenTarget;
  const preferBrott = wantBrott && hasOpenSlot;
  const needSlotForBrott = wantBrott && !hasOpenSlot;

  let id: string | null = null;
  if (wantMoreStations) {
    id = buildRechargeStation(world);
    // Don't fall through to a generator if we wanted a station but can't afford one yet.
    if (id === null) {
      // still consume cooldown to avoid spamming the check every tick
      world.lastBuildTick = world.tick;
      return;
    }
  }
  // If colony wants more Brotts but has no slot, prioritize building a station
  // and DO NOT fall through to a generator — saving salvage for the station matters.
  if (id === null && needSlotForBrott) {
    id = buildRechargeStation(world);
    if (id === null) {
      world.lastBuildTick = world.tick;
      return;
    }
  }
  if (id === null && preferBrott) {
    id = buildBrott(world);
    if (id === null) {
      // Want a brott, have a slot, just lack salvage. Wait instead of
      // bleeding salvage into another generator we don't need.
      world.lastBuildTick = world.tick;
      return;
    }
  }
  if (id === null) {
    id = buildAnyGenerator(world, p, config);
  }
  if (id === null && !hasOpenSlot) {
    id = buildRechargeStation(world);
  }
  if (id === null) {
    id = buildBrott(world);
  }

  if (id !== null) {
    world.lastBuildTick = world.tick;
  }
}

function maybeStorm(world: World, config: SimConfig, rng: Rng): void {
  if (rng() >= config.stormChancePerTick) return;
  const winds = world.structures.filter(s => s.kind === 'wind_turbine');
  if (winds.length === 0) return;
  let anyHit = false;
  for (const target of winds) {
    if (rng() >= config.stormTurbineHitChance) continue;
    const span = config.stormDamageMax - config.stormDamageMin;
    const dmg = config.stormDamageMin + rng() * span;
    target.health = Math.max(0, target.health - dmg);
    world.events.push({ tick: world.tick, kind: 'storm', targetId: target.id, magnitude: dmg });
    anyHit = true;
  }
  if (!anyHit) {
    world.events.push({ tick: world.tick, kind: 'storm', targetId: '', magnitude: 0 });
  }
  if (world.events.length > 1000) world.events.splice(0, world.events.length - 1000);
}

export function tick(world: World, config: SimConfig, rng: Rng): void {
  if (world.gameOver) return;
  world.tick += 1;
  maybeSpawnDebris(world, config, rng);
  maybeStorm(world, config, rng);
  stepPowerFlow(world, config);
  for (const b of world.brotts) stepBrott(world, b, config);
  maybeKillBrotts(world);
  recordIdleSample(world);
  maybeTransitionPhase(world);
  runAutoBuildPolicy(world, config);
  if (world.phase === 'operations') {
    world.metrics.ticksSurvived += 1;
    world.metrics.brottTickAliveSum += world.brotts.length;
  }
  checkGameOver(world);
}

function maybeTransitionPhase(world: World): void {
  if (world.phase !== 'recovery') return;
  const station = world.structures.find(s => s.id === 'station-1');
  const wind = world.structures.find(s => s.id === 'wind-1');
  const tidalS = world.structures.find(s => s.id === 'tidal-1');
  const intake = world.structures.find(s => s.id === 'intake-1');
  if (!station || !wind || !tidalS || !intake) return;
  if (station.health >= 0.8 && wind.health >= 0.8 && tidalS.health >= 0.8 && intake.health >= 0.8) {
    world.phase = 'operations';
  }
}

export function run(world: World, config: SimConfig, rng: Rng, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    if (world.gameOver) return;
    tick(world, config, rng);
  }
}

// --- Sim actions ---

export const TIDAL_GENERATOR_COST = 50;
export const RECHARGE_STATION_COST = 60;
export const BROTT_COST = 100;

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

export function buildTidalGenerator(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < TIDAL_GENERATOR_COST) return null;
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
    online: true,
  });
  return id;
}

export const MAX_TIDAL_GENERATORS = GENERATOR_SLOTS.length;

// --- Recharge stations ---
//
// First station is solar (always-on, trickle producer). Subsequent stations
// are plain (parasitic). Brott cap = total station count.
const STATION_SLOTS: { x: number; y: number }[] = [
  { x: 8, y: 10 },
  { x: 6, y: 4 },
  { x: 6, y: 16 },
  { x: 12, y: 4 },
  { x: 18, y: 4 },
  { x: 18, y: 16 },
  { x: 12, y: 21 },
  { x: 18, y: 21 },
  { x: 4, y: 21 },
  { x: 4, y: 10 },
];

export const MAX_RECHARGE_STATIONS = STATION_SLOTS.length;

export function buildRechargeStation(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < RECHARGE_STATION_COST) return null;
  const occupied = new Set(
    world.structures.filter(s => s.kind === 'recharge_station').map(s => `${s.pos.x},${s.pos.y}`),
  );
  const slot = STATION_SLOTS.find(s => !occupied.has(`${s.x},${s.y}`));
  if (!slot) return null;

  world.inventory.salvage = (world.inventory.salvage ?? 0) - RECHARGE_STATION_COST;
  const n = world.structures.filter(s => s.kind === 'recharge_station').length + 1;
  const id = `station-${n}`;
  world.structures.push({
    id,
    kind: 'recharge_station',
    pos: { x: slot.x, y: slot.y },
    tier: 1,
    health: 1,
    fouling: 0,
    outputBase: 0,
    online: true,
    solar: false, // only station-1 (seeded) is solar
  });
  return id;
}

// --- Brott building ---
//
// Brott cap = number of recharge stations. No fixed MAX_BROTTS.

export function brottCap(world: World): number {
  return world.structures.filter(s => s.kind === 'recharge_station').length;
}

// Legacy alias retained for compatibility with older code paths that may still
// reference a hard cap; functionally now the same as brottCap(world). New code
// should call brottCap(world).
export const MAX_BROTTS = MAX_RECHARGE_STATIONS;

export function buildBrott(world: World): string | null {
  if ((world.inventory.salvage ?? 0) < BROTT_COST) return null;
  if (world.brotts.length >= brottCap(world)) return null;

  // Pick first station without a Brott assigned.
  const stations = world.structures.filter(s => s.kind === 'recharge_station');
  if (stations.length === 0) return null;
  const usedStationIds = new Set(world.brotts.map(b => b.stationId).filter((x): x is string => !!x));
  const homeStation = stations.find(s => !usedStationIds.has(s.id)) ?? stations[0];

  world.inventory.salvage = (world.inventory.salvage ?? 0) - BROTT_COST;
  const n = world.brotts.length + 1;
  const id = `brott-${n}`;
  const name = `Brott-${String(n).padStart(3, '0')}`;
  world.brotts.push({
    id,
    name,
    pos: { x: homeStation.pos.x, y: homeStation.pos.y },
    energy: 1,
    capabilities: ['clean', 'recharge', 'collect', 'repair', 'restart'],
    task: { kind: 'idle', progress: 0 },
    job: 'auto',
    stationId: homeStation.id,
  });
  return id;
}

// --- Wind turbine building ---

export const WIND_TURBINE_COST = 30;
export const WIND_TURBINE_BASE_OUTPUT = 320;

const WIND_TURBINE_SLOTS: { x: number; y: number }[] = [
  { x: 14, y: 10 }, // matches seeded wind-1
  { x: 20, y: 4 },
  { x: 14, y: 4 },
  { x: 4, y: 16 },
  { x: 20, y: 16 },
  { x: 20, y: 10 },
  { x: 11, y: 7 },
  { x: 17, y: 7 },
  { x: 11, y: 13 },
  { x: 17, y: 13 },
  { x: 2, y: 7 },
  { x: 2, y: 13 },
];

export const MAX_WIND_TURBINES = WIND_TURBINE_SLOTS.length;

export function buildWindTurbine(world: World, config: SimConfig = DEFAULT_CONFIG): string | null {
  const cost = config.windCost;
  if ((world.inventory.salvage ?? 0) < cost) return null;
  const occupied = new Set(
    world.structures.filter(s => s.kind === 'wind_turbine').map(s => `${s.pos.x},${s.pos.y}`),
  );
  const slot = WIND_TURBINE_SLOTS.find(s => !occupied.has(`${s.x},${s.y}`));
  if (!slot) return null;

  world.inventory.salvage = (world.inventory.salvage ?? 0) - cost;
  const n = world.structures.filter(s => s.kind === 'wind_turbine').length + 1;
  const id = `wind-${n}`;
  world.structures.push({
    id,
    kind: 'wind_turbine',
    pos: { x: slot.x, y: slot.y },
    tier: 1,
    health: 1,
    fouling: 0,
    outputBase: config.windBaseOutput,
    online: true,
  });
  return id;
}

export function buildAnyGenerator(
  world: World,
  policy: { windRatio?: number },
  config: SimConfig = DEFAULT_CONFIG,
): string | null {
  const windRatio = policy.windRatio ?? 0;
  const winds = world.structures.filter(s => s.kind === 'wind_turbine').length;
  const tidals = world.structures.filter(s => s.kind === 'tidal_generator').length;
  const total = winds + tidals;
  const currentWindFrac = total === 0 ? 0 : winds / total;
  const preferWind = currentWindFrac < windRatio;

  if (preferWind) {
    if (winds < MAX_WIND_TURBINES) return buildWindTurbine(world, config);
    return buildTidalGenerator(world);
  } else {
    if (tidals < MAX_TIDAL_GENERATORS) return buildTidalGenerator(world);
    return buildWindTurbine(world, config);
  }
}
