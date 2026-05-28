import { createWorld, run } from '../src/sim/world';
import { SimConfig } from '../src/sim/types';
const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
const TICKS = 50_000;
function runOne(config: Partial<SimConfig>) {
  const ds: number[] = [];
  for (const seed of SEEDS) {
    const { world, rng, config: cfg } = createWorld({ seed, config });
    run(world, cfg, rng, TICKS);
    ds.push(world.metrics.totalPowerDelivered);
  }
  const m = ds.reduce((s, x) => s + x, 0) / ds.length;
  const v = ds.reduce((s, x) => s + (x - m) ** 2, 0) / (ds.length - 1);
  return { mean: m, std: Math.sqrt(v), min: Math.min(...ds), max: Math.max(...ds) };
}
const p = (extra: any = {}) => ({ enabled: true, brottPerGenTarget: 1.0, maxIdleRatio: 0.5, buildCooldownTicks: 200, ...extra });
function eval1(name: string, cfg: Partial<SimConfig>) {
  console.log('===', name);
  const base = runOne({ ...cfg, autoBuild: p() });
  for (const [vn, wr] of [['baseline', undefined], ['tidal-heavy 0.2', 0.2], ['balanced 0.5', 0.5], ['wind-heavy 0.8', 0.8], ['wind-only 1.0', 1.0]] as const) {
    const r = runOne({ ...cfg, autoBuild: p(wr === undefined ? {} : { windRatio: wr }) });
    const pct = 100 * (r.mean - base.mean) / base.mean;
    const cv = 100 * r.std / r.mean;
    console.log(' ', vn.padEnd(16), 'mean=', r.mean.toFixed(0).padStart(9), `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`, 'CV=', cv.toFixed(1) + '%', 'min=', r.min.toFixed(0), 'max=', r.max.toFixed(0));
  }
}

eval1('out=320 m=0.7 c=30 storm=0.0008 hit=0.95 dmg=0.05-0.18', { windBaseOutput: 320, windMeanFactor: 0.7, windCost: 30, stormChancePerTick: 0.0008, stormTurbineHitChance: 0.95, stormDamageMin: 0.05, stormDamageMax: 0.18 });
eval1('out=280 m=0.65 c=30 storm=0.0008 hit=0.95 dmg=0.05-0.18', { windBaseOutput: 280, windMeanFactor: 0.65, windCost: 30, stormChancePerTick: 0.0008, stormTurbineHitChance: 0.95, stormDamageMin: 0.05, stormDamageMax: 0.18 });
