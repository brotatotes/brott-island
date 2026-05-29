// Sim-eval CLI. Phase C: ranks variants by ticks survived (cap = ticks).
//
// Usage:
//   npm run eval -- --variants eval-variants.json --seeds 8 --ticks 50000 --out eval-results/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createWorld, run } from './sim/world';
import { SimConfig, AutoBuildPolicy } from './sim/types';

interface Variant {
  name: string;
  policy: AutoBuildPolicy;
  config?: Partial<SimConfig>;
}

interface Args {
  variantsPath: string;
  seeds: number[];
  ticks: number;
  outDir: string;
}

const DEFAULT_SEEDS = [1, 2, 3, 5, 7, 11, 13, 17];

function parseArgs(argv: string[]): Args {
  let variantsPath = '';
  let seedsCount = 8;
  let ticks = 50_000;
  let outDir = 'eval-results';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variants') variantsPath = argv[++i];
    else if (a === '--seeds') seedsCount = parseInt(argv[++i], 10);
    else if (a === '--ticks') ticks = parseInt(argv[++i], 10);
    else if (a === '--out') outDir = argv[++i];
  }
  if (!variantsPath) throw new Error('--variants <path> required');
  const seeds = DEFAULT_SEEDS.slice(0, seedsCount);
  return { variantsPath, seeds, ticks, outDir };
}

interface SeedRun {
  seed: number;
  ticksSurvived: number;
  meanBrottsAlive: number;
  blackouts: number;
  restarts: number;
  deaths: number;
  finalBrotts: number;
  finalGens: number;
  finalStations: number;
  wasted: number;
  gameOver: boolean;
}

interface VariantResult {
  name: string;
  policy: AutoBuildPolicy;
  config?: Partial<SimConfig>;
  perSeed: SeedRun[];
  meanSurvived: number;
  stdSurvived: number;
  meanBrottAlive: number;
  meanBlackouts: number;
  meanDeaths: number;
  winRate: number; // fraction reaching tick cap
  vsBaselinePct?: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

function runVariant(variant: Variant, seeds: number[], ticks: number): VariantResult {
  const perSeed: SeedRun[] = [];
  for (const seed of seeds) {
    const configOverride: Partial<SimConfig> = {
      ...(variant.config ?? {}),
      autoBuild: variant.policy,
    };
    const { world, rng, config } = createWorld({ seed, config: configOverride });
    run(world, config, rng, ticks);
    const survived = world.metrics.ticksSurvived;
    const meanBrottsAlive = survived > 0 ? world.metrics.brottTickAliveSum / survived : 0;
    perSeed.push({
      seed,
      ticksSurvived: survived,
      meanBrottsAlive,
      blackouts: world.metrics.blackouts,
      restarts: world.metrics.restarts,
      deaths: world.metrics.deaths,
      finalBrotts: world.brotts.length,
      finalGens: world.structures.filter(s => s.kind === 'tidal_generator' || s.kind === 'wind_turbine').length,
      finalStations: world.structures.filter(s => s.kind === 'recharge_station').length,
      wasted: world.metrics.totalPowerWasted,
      gameOver: world.gameOver,
    });
  }
  const survived = perSeed.map(s => s.ticksSurvived);
  return {
    name: variant.name,
    policy: variant.policy,
    config: variant.config,
    perSeed,
    meanSurvived: mean(survived),
    stdSurvived: stddev(survived),
    meanBrottAlive: mean(perSeed.map(s => s.meanBrottsAlive)),
    meanBlackouts: mean(perSeed.map(s => s.blackouts)),
    meanDeaths: mean(perSeed.map(s => s.deaths)),
    winRate: perSeed.filter(s => !s.gameOver).length / perSeed.length,
  };
}

function getGitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

function formatMarkdown(results: VariantResult[], ticks: number, seeds: number[]): string {
  const lines: string[] = [];
  lines.push(`# Sim-eval results (Phase C: survival)`);
  lines.push(``);
  lines.push(`- ticks per run: ${ticks}`);
  lines.push(`- seeds: ${seeds.join(', ')}`);
  lines.push(`- primary score: ticks survived (cap = ${ticks} = "won")`);
  lines.push(``);
  lines.push(`| variant | mean survived | std | win rate | mean Brotts | blackouts | deaths | vs baseline |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  // Sort by survival descending for the digest.
  const sorted = [...results].sort((a, b) => b.meanSurvived - a.meanSurvived);
  for (const r of sorted) {
    const vs = r.vsBaselinePct === undefined ? '—'
      : `${r.vsBaselinePct >= 0 ? '+' : ''}${r.vsBaselinePct.toFixed(1)}%`;
    lines.push(
      `| ${r.name} | ${r.meanSurvived.toFixed(0)} | ${r.stdSurvived.toFixed(0)} | ${(r.winRate * 100).toFixed(0)}% | ${r.meanBrottAlive.toFixed(1)} | ${r.meanBlackouts.toFixed(1)} | ${r.meanDeaths.toFixed(1)} | ${vs} |`,
    );
  }
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(args.variantsPath, 'utf8');
  const variants = JSON.parse(raw) as Variant[];
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('variants file must be a non-empty JSON array');
  }

  const t0 = Date.now();
  const results: VariantResult[] = [];
  for (const v of variants) results.push(runVariant(v, args.seeds, args.ticks));
  const elapsedMs = Date.now() - t0;

  const baseline = results.find(r => r.name === 'baseline') ?? results[0];
  for (const r of results) {
    if (baseline.meanSurvived > 0) {
      r.vsBaselinePct = (100 * (r.meanSurvived - baseline.meanSurvived)) / baseline.meanSurvived;
    }
  }

  const sha = getGitSha();
  const out = {
    gitSha: sha,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    ticks: args.ticks,
    seeds: args.seeds,
    elapsedMs,
    variants: results,
  };

  if (!existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });
  const outPath = join(args.outDir, `${sha}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  const md = formatMarkdown(results, args.ticks, args.seeds);
  process.stdout.write(md + '\n');
  process.stderr.write(`\nwrote ${outPath} (elapsed ${elapsedMs}ms)\n`);
}

main();
