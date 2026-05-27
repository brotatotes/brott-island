// Node entry. Runs sim with no rendering. Emits metrics JSON for the agent loop.
//
// Usage:
//   npm run headless -- --seed 42 --ticks 10000 --json
//   npm run headless -- --seed 42 --ticks 10000          # human-readable

import { createWorld, run } from './sim/world';

interface Args {
  seed: number;
  ticks: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, ticks: 10_000, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = parseInt(argv[++i], 10);
    else if (a === '--ticks') out.ticks = parseInt(argv[++i], 10);
    else if (a === '--json') out.json = true;
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { world, rng, config } = createWorld({ seed: args.seed });
  const t0 = Date.now();
  run(world, config, rng, args.ticks);
  const elapsedMs = Date.now() - t0;

  const gen = world.structures.find(s => s.kind === 'tidal_generator')!;
  const summary = {
    seed: args.seed,
    ticks: args.ticks,
    elapsedMs,
    metrics: world.metrics,
    finalState: {
      power: world.inventory.power,
      salvage: world.inventory.salvage,
      debrisRemaining: world.debris.length,
      generatorFouling: gen.fouling,
      brottEnergy: world.brotts[0].energy,
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
    console.log(`  power generated: ${m.totalPowerGenerated.toFixed(0)} kWh`);
    console.log(`  power delivered: ${m.totalPowerDelivered.toFixed(0)} kWh`);
    console.log(`  debris collected: ${m.debrisCollected}`);
    console.log(`  ticks at full output: ${m.ticksAtFullOutput} (${(100 * m.ticksAtFullOutput / args.ticks).toFixed(1)}%)`);
    console.log(`  final fouling: ${(f.generatorFouling * 100).toFixed(1)}%`);
    console.log(`  final energy:  ${(f.brottEnergy * 100).toFixed(1)}%`);
    console.log(`  salvage:       ${f.salvage}`);
    console.log(`  debris on map: ${f.debrisRemaining}`);
  }
}

main();
