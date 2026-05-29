// Node entry. Runs sim with no rendering. Emits metrics JSON for the agent loop.

import { createWorld, run } from './sim/world';

interface Args {
  seed: number;
  ticks: number;
  json: boolean;
  autoBuild: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, ticks: 50_000, json: false, autoBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = parseInt(argv[++i], 10);
    else if (a === '--ticks') out.ticks = parseInt(argv[++i], 10);
    else if (a === '--json') out.json = true;
    else if (a === '--auto-build') out.autoBuild = true;
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const configOverride = args.autoBuild
    ? { autoBuild: { enabled: true, brottPerGenTarget: 1.0, maxIdleRatio: 0.5, buildCooldownTicks: 200, rechargeStationRatio: 0.15 } }
    : undefined;
  const { world, rng, config } = createWorld({ seed: args.seed, config: configOverride });
  const t0 = Date.now();
  run(world, config, rng, args.ticks);
  const elapsedMs = Date.now() - t0;

  const summary = {
    seed: args.seed,
    ticks: args.ticks,
    elapsedMs,
    metrics: world.metrics,
    gameOver: world.gameOver,
    finalState: {
      power: world.inventory.power,
      salvage: world.inventory.salvage,
      brotts: world.brotts.length,
      generators: world.structures.filter(s => s.kind === 'tidal_generator' || s.kind === 'wind_turbine').length,
      stations: world.structures.filter(s => s.kind === 'recharge_station').length,
      offline: world.structures.filter(s => !s.online).length,
    },
    config,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    const m = summary.metrics;
    const f = summary.finalState;
    console.log(`brott-island headless run`);
    console.log(`  seed:    ${args.seed}`);
    console.log(`  ticks:   ${args.ticks}  (${elapsedMs}ms)`);
    console.log(`  survived: ${m.ticksSurvived} ticks${world.gameOver ? ' (GAME OVER)' : ''}`);
    console.log(`  power generated: ${m.totalPowerGenerated.toFixed(0)} kWh`);
    console.log(`  power consumed:  ${m.totalPowerConsumed.toFixed(0)} kWh`);
    console.log(`  power wasted:    ${m.totalPowerWasted.toFixed(0)} kWh`);
    console.log(`  blackouts: ${m.blackouts}  restarts: ${m.restarts}  deaths: ${m.deaths}`);
    console.log(`  brotts: ${f.brotts}  generators: ${f.generators}  stations: ${f.stations}`);
    console.log(`  battery: ${f.power?.toFixed(0)} kWh  salvage: ${f.salvage}`);
    if (args.autoBuild) console.log(`  auto-build: ON`);
  }
}

main();
