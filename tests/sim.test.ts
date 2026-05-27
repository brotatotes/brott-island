import { describe, it, expect } from 'vitest';
import { createWorld, run, tick } from '../src/sim/world';

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

  it('sim has no DOM dependencies (runs under node)', () => {
    // The fact that this test runs under vitest/node and produces results is the assertion.
    const { world, rng, config } = createWorld({ seed: 99 });
    run(world, config, rng, 100);
    expect(world.tick).toBe(100);
  });
});
