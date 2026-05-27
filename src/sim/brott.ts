// Brott behavior. Pure functions: (world, brott, config) -> task decision.
// Day 1 policy: priority-based. Low energy -> recharge. High fouling -> clean. Else collect debris if any. Else idle.

import { Brott, Structure, World, SimConfig, BrottTask, Vec2 } from './types';

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

function structuresOfKind(world: World, kind: Structure['kind']): Structure[] {
  return world.structures.filter(s => s.kind === kind);
}

export function decideTask(world: World, brott: Brott, config: SimConfig): BrottTask {
  // Already busy with a target task? Keep going unless preempted by low energy.
  if (brott.task.kind === 'recharge' && brott.energy < 1) return brott.task;
  if (brott.energy < config.lowEnergyThreshold && brott.task.kind !== 'recharge') {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
  }
  if (brott.task.kind === 'walk' || brott.task.kind === 'clean' || brott.task.kind === 'collect') {
    // ongoing task is still valid as long as target exists; let world.ts re-validate
    return brott.task;
  }

  // Idle: pick a priority
  const gens = structuresOfKind(world, 'tidal_generator');
  const dirty = gens.find(g => g.fouling >= config.highFoulingThreshold);
  if (dirty) {
    return { kind: 'walk', targetId: dirty.id, targetPos: dirty.pos, progress: 0 };
  }
  if (world.debris.length > 0) {
    const d = nearest(brott.pos, world.debris)!;
    return { kind: 'walk', targetId: d.id, targetPos: d.pos, progress: 0 };
  }
  // No work — top up energy opportunistically if not full
  if (brott.energy < 0.95) {
    const charger = nearest(brott.pos, structuresOfKind(world, 'charger'));
    if (charger) return { kind: 'walk', targetId: charger.id, targetPos: charger.pos, progress: 0 };
  }
  return { kind: 'idle', progress: 0 };
}
