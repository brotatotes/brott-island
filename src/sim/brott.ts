// Brott behavior. Pure functions: (world, brott, config) -> task decision.

import { Brott, Structure, World, SimConfig, BrottTask, Vec2 } from './types';
import { isGenerator } from './types';

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearest<T extends { pos: Vec2 }>(from: Vec2, items: T[]): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const it of items) {
    const d = dist(from, it.pos);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function rechargeTargets(world: World): Structure[] {
  // Online recharge stations preferred; fall back to any (so Brott can at least walk there).
  const all = world.structures.filter(s => s.kind === 'recharge_station' && s.health >= 0.8);
  const online = all.filter(s => s.online);
  return online.length > 0 ? online : all;
}

function pickBrokenForRepair(world: World): Structure | undefined {
  // Priority: recharge station > generator > intake.
  const station = world.structures.find(s => s.kind === 'recharge_station' && s.health < 0.8);
  if (station) return station;
  const gens = world.structures.filter(s => isGenerator(s) && s.health < 0.8);
  if (gens.length > 0) {
    let best = gens[0];
    for (const g of gens) if (g.health < best.health) best = g;
    return best;
  }
  const intake = world.structures.find(s => s.kind === 'intake' && s.health < 0.8);
  if (intake) return intake;
  return undefined;
}

/**
 * Pick a healthy-but-offline structure that should be restarted, subject to
 * battery threshold. Priority: recharge stations (so colony can refill) > generators.
 * Solar stations are always-online so they're never in this list.
 */
function pickOfflineForRestart(world: World, config: SimConfig): Structure | undefined {
  const cap = config.batteryCapacity;
  const thresh = cap * config.batteryRestartThreshold;
  if ((world.inventory.power ?? 0) < thresh) return undefined;

  const station = world.structures.find(
    s => s.kind === 'recharge_station' && s.health >= 0.8 && !s.online,
  );
  if (station) return station;
  const gen = world.structures.find(s => isGenerator(s) && s.health >= 0.8 && !s.online);
  if (gen) return gen;
  return undefined;
}

export function decideTask(world: World, brott: Brott, config: SimConfig): BrottTask {
  if (brott.task.kind === 'recharge' && brott.energy < 1) {
    const tgt = world.structures.find(s => s.id === brott.task.targetId);
    if (tgt && tgt.online) return brott.task;
  }
  if (brott.task.kind === 'repair' && brott.task.targetId) {
    const s = world.structures.find(st => st.id === brott.task.targetId);
    if (s && s.health < 1 && brott.energy >= config.lowEnergyThreshold) return brott.task;
  }
  if (brott.task.kind === 'restart' && brott.task.targetId) {
    const s = world.structures.find(st => st.id === brott.task.targetId);
    if (s && !s.online && s.health >= 0.8 && brott.energy >= config.lowEnergyThreshold) return brott.task;
  }
  if (brott.energy < config.lowEnergyThreshold && brott.task.kind !== 'recharge') {
    const station = nearest(brott.pos, rechargeTargets(world));
    if (station) return { kind: 'walk', targetId: station.id, targetPos: station.pos, progress: 0 };
  }

  const job = brott.job ?? 'auto';

  if (job === 'recharge_only') {
    const station = nearest(brott.pos, rechargeTargets(world));
    if (station) return { kind: 'walk', targetId: station.id, targetPos: station.pos, progress: 0 };
    return { kind: 'idle', progress: 0 };
  }

  // Repair: any broken structure.
  const broken = pickBrokenForRepair(world);
  if (broken) {
    return { kind: 'walk', targetId: broken.id, targetPos: broken.pos, progress: 0 };
  }

  // Restart: offline healthy structures, if battery permits.
  const offline = pickOfflineForRestart(world, config);
  if (offline) {
    return { kind: 'walk', targetId: offline.id, targetPos: offline.pos, progress: 0 };
  }

  // Continue ongoing task if compatible with job.
  if (brott.task.kind === 'walk' || brott.task.kind === 'clean' || brott.task.kind === 'collect') {
    if (job === 'auto') return brott.task;
    if (job === 'clean' && (brott.task.kind === 'clean' || brott.task.kind === 'walk')) {
      const tid = brott.task.targetId;
      const isCleanTarget = !!tid && world.structures.some(s => s.id === tid && isGenerator(s));
      const isStationWalk = !!tid && world.structures.some(s => s.id === tid && s.kind === 'recharge_station');
      if (brott.task.kind === 'clean' || isCleanTarget || isStationWalk) return brott.task;
    }
    if (job === 'collect' && (brott.task.kind === 'collect' || brott.task.kind === 'walk')) {
      const tid = brott.task.targetId;
      const isDebrisTarget = !!tid && world.debris.some(d => d.id === tid);
      const isStationWalk = !!tid && world.structures.some(s => s.id === tid && s.kind === 'recharge_station');
      if (brott.task.kind === 'collect' || isDebrisTarget || isStationWalk) return brott.task;
    }
  }

  const gens = world.structures.filter(s => isGenerator(s) && s.online);
  const considerClean = job === 'auto' || job === 'clean';
  const considerCollect = job === 'auto' || job === 'collect';

  if (considerClean) {
    let dirtiest: Structure | undefined;
    let dirtiestF = config.highFoulingThreshold;
    for (const g of gens) {
      if (g.fouling >= dirtiestF) { dirtiestF = g.fouling; dirtiest = g; }
    }
    if (dirtiest) {
      return { kind: 'walk', targetId: dirtiest.id, targetPos: dirtiest.pos, progress: 0 };
    }
  }
  if (considerCollect && world.debris.length > 0) {
    const d = nearest(brott.pos, world.debris)!;
    return { kind: 'walk', targetId: d.id, targetPos: d.pos, progress: 0 };
  }

  if (job === 'clean' || job === 'collect') {
    const station = nearest(brott.pos, rechargeTargets(world));
    if (station) return { kind: 'walk', targetId: station.id, targetPos: station.pos, progress: 0 };
    return { kind: 'idle', progress: 0 };
  }

  // auto: top up energy if not full
  if (brott.energy < 0.95) {
    const station = nearest(brott.pos, rechargeTargets(world));
    if (station) return { kind: 'walk', targetId: station.id, targetPos: station.pos, progress: 0 };
  }
  return { kind: 'idle', progress: 0 };
}
