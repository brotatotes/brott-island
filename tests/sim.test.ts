import { describe, it, expect } from 'vitest';
import {
  createWorld, run, tick,
  buildTidalGenerator, TIDAL_GENERATOR_COST,
  buildBrott, BROTT_COST, brottCap,
  buildWindTurbine, WIND_TURBINE_COST,
  buildAnyGenerator, windFactor,
  buildRechargeStation, RECHARGE_STATION_COST, MAX_RECHARGE_STATIONS,
} from '../src/sim/world';
import { isBasicProducer, isParasitic } from '../src/sim/types';

// Skip the staged recovery (solar already up + repair wind/tidal/intake).
function skipRecovery(world: ReturnType<typeof createWorld>['world']): void {
  for (const s of world.structures) s.health = 1;
  world.phase = 'operations';
  world.brotts[0].pos = { x: 8, y: 10 };
}

describe('sim core (Phase C)', () => {
  it('is deterministic given the same seed', () => {
    const a = createWorld({ seed: 42 });
    const b = createWorld({ seed: 42 });
    skipRecovery(a.world); skipRecovery(b.world);
    run(a.world, a.config, a.rng, 3000);
    run(b.world, b.config, b.rng, 3000);
    expect(a.world.metrics).toEqual(b.world.metrics);
    expect(a.world.brotts[0]?.pos).toEqual(b.world.brotts[0]?.pos);
    expect(a.world.inventory).toEqual(b.world.inventory);
  });

  it('different seeds diverge', () => {
    const a = createWorld({ seed: 1 });
    const b = createWorld({ seed: 2 });
    skipRecovery(a.world); skipRecovery(b.world);
    run(a.world, a.config, a.rng, 5000);
    run(b.world, b.config, b.rng, 5000);
    const diff = a.world.metrics.debrisCollected !== b.world.metrics.debrisCollected
      || a.world.debris.length !== b.world.debris.length;
    expect(diff).toBe(true);
  });

  it('starts in recovery with solar station online + wind/tidal/intake broken', () => {
    const { world } = createWorld({ seed: 1 });
    expect(world.phase).toBe('recovery');
    const station = world.structures.find(s => s.id === 'station-1')!;
    const wind = world.structures.find(s => s.id === 'wind-1')!;
    const tidalS = world.structures.find(s => s.id === 'tidal-1')!;
    expect(station.health).toBe(1);
    expect(station.solar).toBe(true);
    expect(station.online).toBe(true);
    expect(wind.health).toBeLessThan(0.8);
    expect(tidalS.health).toBeLessThan(0.8);
  });

  it('recovery completes when all starter structures are repaired', () => {
    const { world, rng, config } = createWorld({ seed: 1 });
    let transitioned = false;
    for (let i = 0; i < 40_000; i++) {
      tick(world, config, rng);
      if (world.phase === 'operations') { transitioned = true; break; }
    }
    expect(transitioned).toBe(true);
  });

  it('damaged buildings draw zero power', () => {
    const { world, rng, config } = createWorld({ seed: 1 });
    skipRecovery(world);
    // Break tidal: should stop drawing parasitic
    const tidalS = world.structures.find(s => s.id === 'tidal-1')!;
    tidalS.health = 0.1;
    world.inventory.power = 50;
    const before = world.metrics.totalPowerConsumed;
    for (let i = 0; i < 100; i++) tick(world, config, rng);
    const tidalConsumed = world.metrics.totalPowerConsumed - before;
    // Damaged tidal should not contribute parasitic draw; only stations draw.
    // 100 ticks * 0.5 (idle) for the one station = 50 max.
    expect(tidalConsumed).toBeLessThanOrEqual(100 * (config.rechargeStationIdleDraw + config.rechargeStationActiveDraw) + 1);
  });
});

describe('battery flow', () => {
  it('wind produces, tidal parasitic draws, overflow wastes', () => {
    const { world, rng, config } = createWorld({ seed: 7 });
    skipRecovery(world);
    run(world, config, rng, 5000);
    expect(world.metrics.totalPowerGenerated).toBeGreaterThan(0);
    expect(world.metrics.totalPowerConsumed).toBeGreaterThan(0);
    expect(world.inventory.power).toBeLessThanOrEqual(config.batteryCapacity + 0.001);
  });

  it('solar station produces trickle while everything else is broken', () => {
    const { world, rng, config } = createWorld({ seed: 7 });
    skipRecovery(world);
    // Break all generators, leave solar station + brott alive
    for (const s of world.structures) {
      if (s.kind === 'tidal_generator' || s.kind === 'wind_turbine') s.health = 0.1;
    }
    world.inventory.power = 0;
    const before = world.metrics.totalPowerGenerated;
    for (let i = 0; i < 500; i++) tick(world, config, rng);
    expect(world.metrics.totalPowerGenerated - before).toBeGreaterThan(0);
  });
});

describe('blackout cascade', () => {
  it('battery hits 0 → tidal generators go offline; wind stays online', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    skipRecovery(world);
    // Force battery to a tiny amount and add many tidal generators with very heavy parasitic draw.
    world.inventory.salvage = 9999;
    for (let i = 0; i < 5; i++) buildTidalGenerator(world);
    // Break wind so only tidal is producing — but tidal draw exceeds production with fouling.
    const wind = world.structures.find(s => s.id === 'wind-1')!;
    wind.health = 0.1;
    world.inventory.power = 0;
    // Crank parasitic to guarantee blackout
    (config as any).tidalParasiticDraw = 5000;
    for (let i = 0; i < 50; i++) tick(world, config, rng);
    const tidals = world.structures.filter(s => s.kind === 'tidal_generator');
    const anyOffline = tidals.some(s => !s.online);
    expect(anyOffline).toBe(true);
    expect(world.metrics.blackouts).toBeGreaterThan(0);
  });

  it('solar station NEVER goes offline in blackout', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.power = 0;
    (config as any).tidalParasiticDraw = 100000;
    for (let i = 0; i < 20; i++) tick(world, config, rng);
    const solar = world.structures.find(s => s.id === 'station-1')!;
    expect(solar.online).toBe(true);
  });

  it('wind turbines NEVER auto-go-offline in blackout', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.power = 0;
    (config as any).tidalParasiticDraw = 100000;
    for (let i = 0; i < 20; i++) tick(world, config, rng);
    const wind = world.structures.find(s => s.id === 'wind-1')!;
    expect(wind.online).toBe(true);
  });
});

describe('restart verb', () => {
  it('brott restarts an offline structure once battery clears threshold', () => {
    const { world, rng, config } = createWorld({ seed: 9 });
    skipRecovery(world);
    // Mark tidal offline manually
    const tidalS = world.structures.find(s => s.id === 'tidal-1')!;
    tidalS.online = false;
    // Make sure brott has full energy and battery above threshold.
    world.brotts[0].energy = 1;
    world.inventory.power = config.batteryCapacity * 0.9;
    // Let it run — brott should walk over and restart.
    let restored = false;
    for (let i = 0; i < 4000; i++) {
      tick(world, config, rng);
      if (tidalS.online) { restored = true; break; }
    }
    expect(restored).toBe(true);
    expect(world.metrics.restarts).toBeGreaterThan(0);
  });

  it('brott will NOT restart if battery below threshold', () => {
    const { world, rng, config } = createWorld({ seed: 9 });
    skipRecovery(world);
    const tidalS = world.structures.find(s => s.id === 'tidal-1')!;
    tidalS.online = false;
    // Remove wind entirely so brott can't repair-and-recharge the battery.
    world.structures = world.structures.filter(s => s.id !== 'wind-1');
    // Remove solar too so trickle doesn't push battery past threshold.
    // (brott won't be able to repair-restore it if it's gone)
    world.structures = world.structures.filter(s => s.id !== 'station-1');
    world.inventory.power = config.batteryCapacity * 0.05; // below 20%
    for (let i = 0; i < 1000; i++) tick(world, config, rng);
    expect(tidalS.online).toBe(false);
    // Confirm battery stayed under threshold (solar trickle + active draw should keep it low).
    expect((world.inventory.power ?? 0) / config.batteryCapacity).toBeLessThan(config.batteryRestartThreshold);
  });
});

describe('recharge station = Brott cap', () => {
  it('brott cap == number of recharge stations', () => {
    const { world } = createWorld({ seed: 1 });
    skipRecovery(world);
    expect(brottCap(world)).toBe(1);
    expect(world.brotts.length).toBe(1);
  });

  it('cannot build more brotts than stations', () => {
    const { world } = createWorld({ seed: 1 });
    skipRecovery(world);
    world.inventory.salvage = BROTT_COST * 10;
    const id = buildBrott(world);
    expect(id).toBeNull();
    expect(world.brotts.length).toBe(1);
  });

  it('building a recharge station unlocks a new Brott slot', () => {
    const { world } = createWorld({ seed: 1 });
    skipRecovery(world);
    world.inventory.salvage = RECHARGE_STATION_COST + BROTT_COST;
    const stationId = buildRechargeStation(world);
    expect(stationId).not.toBeNull();
    expect(brottCap(world)).toBe(2);
    const brottId = buildBrott(world);
    expect(brottId).not.toBeNull();
    expect(world.brotts.length).toBe(2);
  });

  it('recharge stations cap at MAX_RECHARGE_STATIONS', () => {
    const { world } = createWorld({ seed: 1 });
    skipRecovery(world);
    world.inventory.salvage = RECHARGE_STATION_COST * 100;
    while (world.structures.filter(s => s.kind === 'recharge_station').length < MAX_RECHARGE_STATIONS) {
      const r = buildRechargeStation(world);
      expect(r).not.toBeNull();
    }
    const overflow = buildRechargeStation(world);
    expect(overflow).toBeNull();
  });

  it('first recharge station is solar; subsequent are plain', () => {
    const { world } = createWorld({ seed: 1 });
    skipRecovery(world);
    const first = world.structures.find(s => s.kind === 'recharge_station')!;
    expect(first.solar).toBe(true);
    world.inventory.salvage = RECHARGE_STATION_COST;
    const id = buildRechargeStation(world)!;
    const newStation = world.structures.find(s => s.id === id)!;
    expect(newStation.solar).toBeFalsy();
  });
});

describe('game over conditions', () => {
  it('game over when battery zero AND no basic producers', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    skipRecovery(world);
    // Break wind. Solar station is still up — so this should NOT game over.
    const wind = world.structures.find(s => s.id === 'wind-1')!;
    wind.health = 0.1;
    // Solar is basic — so still ok
    expect(world.gameOver).toBe(false);
    // Now break solar too.
    const solar = world.structures.find(s => s.id === 'station-1')!;
    solar.health = 0.1;
    world.inventory.power = 0;
    (config as any).tidalParasiticDraw = 100000;
    for (let i = 0; i < 50; i++) tick(world, config, rng);
    expect(world.gameOver).toBe(true);
  });

  it('no game-over if wind keeps producing', () => {
    const { world, rng, config } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.power = 0;
    for (let i = 0; i < 5000; i++) tick(world, config, rng);
    expect(world.gameOver).toBe(false);
  });

  it('isBasicProducer / isParasitic classify correctly', () => {
    const { world } = createWorld({ seed: 1 });
    const solar = world.structures.find(s => s.id === 'station-1')!;
    const wind = world.structures.find(s => s.id === 'wind-1')!;
    const tidalS = world.structures.find(s => s.id === 'tidal-1')!;
    solar.health = 1; wind.health = 1; tidalS.health = 1;
    expect(isBasicProducer(solar)).toBe(true);
    expect(isBasicProducer(wind)).toBe(true);
    expect(isBasicProducer(tidalS)).toBe(false);
    expect(isParasitic(tidalS)).toBe(true);
    expect(isParasitic(solar)).toBe(false);
    expect(isParasitic(wind)).toBe(false);
  });
});

describe('survival metric', () => {
  it('ticksSurvived advances during operations only', () => {
    const { world, rng, config } = createWorld({ seed: 1 });
    // Recovery doesn't count.
    for (let i = 0; i < 50; i++) tick(world, config, rng);
    expect(world.metrics.ticksSurvived).toBe(0);
    skipRecovery(world);
    for (let i = 0; i < 100; i++) tick(world, config, rng);
    expect(world.metrics.ticksSurvived).toBe(100);
  });

  it('brottTickAliveSum reflects roster size over time', () => {
    const { world, rng, config } = createWorld({ seed: 1 });
    skipRecovery(world);
    for (let i = 0; i < 100; i++) tick(world, config, rng);
    expect(world.metrics.brottTickAliveSum).toBe(100);
  });
});

describe('auto-build (Phase C)', () => {
  it('auto-build enabled actually builds and survives long', () => {
    const { world, rng, config } = createWorld({
      seed: 5,
      config: { autoBuild: { enabled: true, brottPerGenTarget: 1.0, maxIdleRatio: 1.0, buildCooldownTicks: 200, windRatio: 0.5, rechargeStationRatio: 0.2 } },
    });
    run(world, config, rng, 50_000);
    expect(world.metrics.ticksSurvived).toBeGreaterThan(40_000);
    // Auto-build should at least add infrastructure beyond starter (extra station or gens).
    const extras = world.structures.length - 4; // 4 seeded structures
    expect(extras).toBeGreaterThan(0);
  });

  it('auto-build is deterministic given seed', () => {
    const a = createWorld({
      seed: 42,
      config: { autoBuild: { enabled: true, brottPerGenTarget: 1.0, maxIdleRatio: 0.5, buildCooldownTicks: 200, windRatio: 0.5, rechargeStationRatio: 0.15 } },
    });
    const b = createWorld({
      seed: 42,
      config: { autoBuild: { enabled: true, brottPerGenTarget: 1.0, maxIdleRatio: 0.5, buildCooldownTicks: 200, windRatio: 0.5, rechargeStationRatio: 0.15 } },
    });
    run(a.world, a.config, a.rng, 20_000);
    run(b.world, b.config, b.rng, 20_000);
    expect(a.world.brotts.length).toBe(b.world.brotts.length);
    expect(a.world.structures.length).toBe(b.world.structures.length);
    expect(a.world.metrics).toEqual(b.world.metrics);
  });
});

describe('build menu', () => {
  it('buildTidalGenerator spends salvage and adds a generator', () => {
    const { world } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.salvage = TIDAL_GENERATOR_COST + 10;
    const id = buildTidalGenerator(world);
    expect(id).not.toBeNull();
    expect(world.inventory.salvage).toBe(10);
  });

  it('buildWindTurbine spends salvage and adds a turbine', () => {
    const { world } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.salvage = WIND_TURBINE_COST + 5;
    const id = buildWindTurbine(world);
    expect(id).not.toBeNull();
    expect(world.inventory.salvage).toBe(5);
  });

  it('buildAnyGenerator follows windRatio preference', () => {
    const { world } = createWorld({ seed: 5 });
    skipRecovery(world);
    world.inventory.salvage = 9999;
    // windRatio=1 → should pick wind first when below target
    const id = buildAnyGenerator(world, { windRatio: 1 });
    const s = world.structures.find(st => st.id === id);
    expect(s?.kind).toBe('wind_turbine');
  });
});

describe('windFactor', () => {
  it('returns value within bounds', () => {
    for (let t = 0; t < 5000; t += 17) {
      const w = windFactor(t);
      expect(w).toBeGreaterThanOrEqual(0.1);
      expect(w).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('sim has no DOM dependencies', () => {
  it('runs under node', () => {
    const { world, rng, config } = createWorld({ seed: 99 });
    run(world, config, rng, 100);
    expect(world.tick).toBe(100);
  });
});
