// Brott behavior. Pure functions: (world, brott, config) -> task decision.
// Day 1 policy: priority-based. Low energy -> recharge. High fouling -> clean. Else collect debris if any. Else idle.

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

function pickBrokenForRepair(world: World): Structure | undefined {
  // Priority: charger > generator > intake.
  const charger = world.structures.find(s => s.kind === 'charger' && s.health < 0.8);
  if (charger) return charger;
  const gens = world.structures.filter(s => s.kind === 'tidal_generator' || s.kind === 'wind_turbine' ? s.health < 0.8 : false);
  if (gens.length > 0) {
    // Lowest-health generator first.
    let best = gens[0];
    for (const g of gens) if (g.health < best.health) best = g;
    return best;
  }
  const intake = world.structures.find(s => s.kind === 'intake' && s.health < 0.8);
  if (intake) return intake;
  return undefined;
}

function structuresOfKind(world: World, kind: Structure['kind']): Structure[] {
  return world.structures.filter(s => s.kind === kind);
}

export function decideTask(world: World, brott: Brott, config: SimConfig): BrottTask {
  // Already busy with a target task? Keep going unless preempted by low energy.
  if (brott.task.kind === 'recharge' && brott.energy < 1) return brott.task;
  if (brott.task.kind === 'repair' && brott.task.targetId) {
    const s = world.structures.find(st => st.id === brott.task.targetId);
    if (s && s.health < 1 && brott.energy >= config.lowEnergyThreshold) return brott.task;
  }
  // Low energy always wins, regardless of job restriction.
  if (brott.energy < config.lowEnergyThreshold && brott.task.kind !== 'recharge') {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
  }

  const job = brott.job ?? 'auto';

  // recharge_only: head to (and stay at) the charger; never pick work.
  if (job === 'recharge_only') {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
    return { kind: 'idle', progress: 0 };
  }

  // Phase 1 / dormant structures: any structure under health 0.8 must be repaired before anything else.
  // Priority charger > generator > intake so brotts stay charged, then output flows, then salvage flows.
  // Applied across all non-recharge_only jobs so recovery can actually complete even under restricted jobs.
  const broken = pickBrokenForRepair(world);
  if (broken) {
    return { kind: 'walk', targetId: broken.id, targetPos: broken.pos, progress: 0 };
  }

  // For non-auto jobs, ongoing tasks must match the job; otherwise re-decide.
  if (brott.task.kind === 'walk' || brott.task.kind === 'clean' || brott.task.kind === 'collect') {
    if (job === 'auto') return brott.task;
    if (job === 'clean' && (brott.task.kind === 'clean' || brott.task.kind === 'walk')) {
      // walk could be toward a debris from before — re-validate the target kind.
      const tid = brott.task.targetId;
      const isCleanTarget = !!tid && world.structures.some(s => s.id === tid && isGenerator(s));
      const isChargerWalk = !!tid && world.structures.some(s => s.id === tid && s.kind === 'charger');
      if (brott.task.kind === 'clean' || isCleanTarget || isChargerWalk) return brott.task;
    }
    if (job === 'collect' && (brott.task.kind === 'collect' || brott.task.kind === 'walk')) {
      const tid = brott.task.targetId;
      const isDebrisTarget = !!tid && world.debris.some(d => d.id === tid);
      const isChargerWalk = !!tid && world.structures.some(s => s.id === tid && s.kind === 'charger');
      if (brott.task.kind === 'collect' || isDebrisTarget || isChargerWalk) return brott.task;
    }
  }

  // Idle: pick a priority based on job.
  const gens = world.structures.filter(isGenerator);
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

  // No work for this job. For restricted jobs, idle at the charger.
  if (job === 'clean' || job === 'collect') {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
    return { kind: 'idle', progress: 0 };
  }

  // auto: top up energy opportunistically if not full
  if (brott.energy < 0.95) {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
  }
  return { kind: 'idle', progress: 0 };
}
