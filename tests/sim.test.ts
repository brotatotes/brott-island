import { describe, it, expect } from 'vitest';
import { createWorld, run, tick, buildTidalGenerator, TIDAL_GENERATOR_COST } from '../src/sim/world';

describe('sim core', () => {
  it('is deterministic given the same seed', () => {
    const a = createWorld({ seed: 42 });
    const b = createWorld({ seed: 42 });
    run(a.world, a.config, a.rng, 5000);
    run(b.world, b.config, b.rng, 5000);
    expect(a.world.metrics).toEqual(b.world.metrics);
    expect(a.world.brotts[0].pos).toEqual(b.world.brotts[0].pos);
    expect(a.world.inventory).toEqual(b.world.inventory);
  });

  it('different seeds diverge', () => {
    const a = createWorld({ seed: 1 });
    const b = createWorld({ seed: 2 });
    run(a.world, a.config, a.rng, 5000);
    run(b.world, b.config, b.rng, 5000);
    // RNG drives debris spawn; collected counts very likely differ
    const diff =
      a.world.metrics.debrisCollected !== b.world.metrics.debrisCollected ||
      a.world.debris.length !== b.world.debris.length;
    expect(diff).toBe(true);
  });

  it('generates power over time', () => {
    const { world, rng, config } = createWorld({ seed: 7 });
    run(world, config, rng, 2000);
    expect(world.metrics.totalPowerGenerated).toBeGreaterThan(0);
    expect(world.inventory.power).toBeGreaterThan(0);
  });

  it('brott returns to charger when low on energy', () => {
    const { world, rng, config } = createWorld({ seed: 3 });
    // Force low energy
    world.brotts[0].energy = 0.1;
    for (let i = 0; i < 500; i++) tick(world, config, rng);
    expect(world.brotts[0].energy).toBeGreaterThan(0.5);
  });

  it('brott collects debris into salvage', () => {
    const { world, rng, config } = createWorld({ seed: 11 });
    // Run long enough that some debris should have spawned and been collected
    run(world, config, rng, 20_000);
    expect(world.metrics.debrisCollected).toBeGreaterThan(0);
    expect(world.inventory.salvage).toBe(world.metrics.debrisCollected);
  });

  it('buildTidalGenerator fails without enough salvage', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = TIDAL_GENERATOR_COST - 1;
    const id = buildTidalGenerator(world);
    expect(id).toBeNull();
    expect(world.inventory.salvage).toBe(TIDAL_GENERATOR_COST - 1);
    expect(world.structures.filter(s => s.kind === 'tidal_generator').length).toBe(1);
  });

  it('buildTidalGenerator spends salvage and adds a generator', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = TIDAL_GENERATOR_COST + 10;
    const id = buildTidalGenerator(world);
    expect(id).not.toBeNull();
    expect(world.inventory.salvage).toBe(10);
    const gens = world.structures.filter(s => s.kind === 'tidal_generator');
    expect(gens.length).toBe(2);
    expect(gens[1].id).toBe(id);
    expect(gens[1].fouling).toBe(0);
    expect(gens[1].outputBase).toBe(100);
    // Placed further along shoreline
    expect(gens[1].pos.y).toBeGreaterThan(gens[0].pos.y);
  });

  it('brott cleans the dirtiest generator when multiple exist', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    world.inventory.salvage = TIDAL_GENERATOR_COST;
    const id2 = buildTidalGenerator(world)!;
    const gens = world.structures.filter(s => s.kind === 'tidal_generator');
    const g1 = gens.find(g => g.id !== id2)!;
    const g2 = gens.find(g => g.id === id2)!;
    // Make g2 dirtier; force brott idle.
    g1.fouling = 0.6;
    g2.fouling = 0.9;
    world.brotts[0].task = { kind: 'idle', progress: 0 };
    world.brotts[0].energy = 1;
    // One tick to pick a task.
    tick(world, config, rng);
    expect(world.brotts[0].task.targetId).toBe(g2.id);
  });

  it('sim module exports do not touch the DOM', () => {
    // Importing world/buildTidalGenerator under node would throw if it touched DOM.
    const { world } = createWorld({ seed: 1 });
    world.inventory.salvage = TIDAL_GENERATOR_COST;
    expect(() => buildTidalGenerator(world)).not.toThrow();
  });

  it('sim has no DOM dependencies (runs under node)', () => {
    // The fact that this test runs under vitest/node and produces results is the assertion.
    const { world, rng, config } = createWorld({ seed: 99 });
    run(world, config, rng, 100);
    expect(world.tick).toBe(100);
  });
});
