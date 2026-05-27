import { describe, it, expect } from 'vitest';
import { createWorld, run, tick, buildTidalGenerator, TIDAL_GENERATOR_COST, buildBrott, BROTT_COST, MAX_BROTTS } from '../src/sim/world';

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

  it('battery caps stored power and overflow is delivered', () => {
    const { world, rng, config } = createWorld({ seed: 7 });
    run(world, config, rng, 20_000);
    expect(world.inventory.power).toBeLessThanOrEqual(config.batteryCapacity + 0.001);
    expect(world.metrics.totalPowerDelivered).toBeGreaterThan(0);
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
    // Placed in canvas bounds (sim world is 40x25 tiles)
    expect(gens[1].pos.x).toBeGreaterThanOrEqual(0);
    expect(gens[1].pos.x).toBeLessThanOrEqual(40);
    expect(gens[1].pos.y).toBeGreaterThanOrEqual(0);
    expect(gens[1].pos.y).toBeLessThanOrEqual(25);
    // Different from first generator's slot
    expect(`${gens[1].pos.x},${gens[1].pos.y}`).not.toBe(`${gens[0].pos.x},${gens[0].pos.y}`);
  });

  it('generator placement stays within canvas bounds across many builds', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = TIDAL_GENERATOR_COST * 20;
    for (let i = 0; i < 20; i++) buildTidalGenerator(world);
    const gens = world.structures.filter(s => s.kind === 'tidal_generator');
    for (const g of gens) {
      expect(g.pos.x).toBeGreaterThanOrEqual(0);
      expect(g.pos.x).toBeLessThanOrEqual(40);
      expect(g.pos.y).toBeGreaterThanOrEqual(0);
      expect(g.pos.y).toBeLessThanOrEqual(25);
    }
    // No two generators in the same slot
    const slots = new Set(gens.map(g => `${g.pos.x},${g.pos.y}`));
    expect(slots.size).toBe(gens.length);
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

  it('buildBrott fails without enough salvage', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = BROTT_COST - 1;
    const id = buildBrott(world);
    expect(id).toBeNull();
    expect(world.inventory.salvage).toBe(BROTT_COST - 1);
    expect(world.brotts.length).toBe(1);
  });

  it('buildBrott spends salvage and adds a brott at the charger with full energy + auto job', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = BROTT_COST + 25;
    const charger = world.structures.find(s => s.kind === 'charger')!;
    const id = buildBrott(world);
    expect(id).not.toBeNull();
    expect(world.inventory.salvage).toBe(25);
    expect(world.brotts.length).toBe(2);
    const nb = world.brotts.find(b => b.id === id)!;
    expect(nb.pos.x).toBe(charger.pos.x);
    expect(nb.pos.y).toBe(charger.pos.y);
    expect(nb.energy).toBe(1);
    expect(nb.job).toBe('auto');
    expect(nb.capabilities).toEqual(['clean', 'recharge', 'collect']);
    expect(nb.name).toBe('Brott-002');
  });

  it('buildBrott caps at MAX_BROTTS', () => {
    const { world } = createWorld({ seed: 5 });
    world.inventory.salvage = BROTT_COST * 100;
    let built = 1; // starts with 1
    while (built < MAX_BROTTS) {
      const id = buildBrott(world);
      expect(id).not.toBeNull();
      built += 1;
    }
    expect(world.brotts.length).toBe(MAX_BROTTS);
    // Next build should fail despite plenty of salvage.
    const overflow = buildBrott(world);
    expect(overflow).toBeNull();
    expect(world.brotts.length).toBe(MAX_BROTTS);
  });

  it('job=clean restricts brott to cleaning', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    const b = world.brotts[0];
    b.job = 'clean';
    b.energy = 1;
    b.task = { kind: 'idle', progress: 0 };
    // Generators clean (no clean work above threshold)
    for (const s of world.structures) if (s.kind === 'tidal_generator') s.fouling = 0;
    // Spawn debris explicitly
    world.debris.push({ id: 'debris-test-1', pos: { x: 34, y: 18 } });
    // Tick a few times to let it pick a task.
    for (let i = 0; i < 5; i++) tick(world, config, rng);
    expect(b.task.kind).not.toBe('collect');
    // Walking, it must NOT be walking toward the debris.
    if (b.task.kind === 'walk') {
      expect(b.task.targetId).not.toBe('debris-test-1');
    }
  });

  it('job=collect restricts brott to collection', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    const b = world.brotts[0];
    b.job = 'collect';
    b.energy = 1;
    b.task = { kind: 'idle', progress: 0 };
    // Force generators very dirty
    for (const s of world.structures) if (s.kind === 'tidal_generator') s.fouling = 0.95;
    // No debris yet — still should not start cleaning.
    for (let i = 0; i < 5; i++) tick(world, config, rng);
    expect(b.task.kind).not.toBe('clean');
    if (b.task.kind === 'walk') {
      const tid = b.task.targetId;
      const gen = world.structures.find(s => s.id === tid && s.kind === 'tidal_generator');
      expect(gen).toBeUndefined();
    }
  });

  it('job=recharge_only keeps brott at charger', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    const b = world.brotts[0];
    b.job = 'recharge_only';
    b.energy = 1;
    b.task = { kind: 'idle', progress: 0 };
    for (const s of world.structures) if (s.kind === 'tidal_generator') s.fouling = 0.95;
    world.debris.push({ id: 'debris-test-2', pos: { x: 34, y: 18 } });
    for (let i = 0; i < 500; i++) tick(world, config, rng);
    // Should never have picked clean or collect.
    expect(b.task.kind === 'clean' || b.task.kind === 'collect').toBe(false);
    // Debris must remain (nobody collected it).
    expect(world.debris.some(d => d.id === 'debris-test-2')).toBe(true);
    // Brott should be at or heading to charger.
    const charger = world.structures.find(s => s.kind === 'charger')!;
    const d = Math.hypot(b.pos.x - charger.pos.x, b.pos.y - charger.pos.y);
    expect(d).toBeLessThan(0.5);
  });

  it('low energy still wins over job restriction', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    const b = world.brotts[0];
    b.job = 'clean';
    b.energy = 0.1;
    b.task = { kind: 'idle', progress: 0 };
    for (const s of world.structures) if (s.kind === 'tidal_generator') s.fouling = 0;
    // Move brott away from charger so we can detect motion toward it.
    b.pos = { x: 30, y: 18 };
    for (let i = 0; i < 500; i++) tick(world, config, rng);
    expect(b.energy).toBeGreaterThan(0.5);
  });

  it('two brotts can have different jobs and act independently', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    world.inventory.salvage = BROTT_COST;
    const id2 = buildBrott(world)!;
    const b1 = world.brotts[0];
    const b2 = world.brotts.find(x => x.id === id2)!;
    b1.job = 'clean';
    b2.job = 'collect';
    run(world, config, rng, 500);
    expect(world.brotts.length).toBe(2);
    // Both should still be alive and operating (energy above 0 because they recharge when low).
    expect(b1.energy).toBeGreaterThan(0);
    expect(b2.energy).toBeGreaterThan(0);
  });
});
