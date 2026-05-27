// Sim-eval CLI. Runs N seeds x variants and reports aggregate metrics.
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
  if (!variantsPath) {
    throw new Error('--variants <path> required');
  }
  const seeds = DEFAULT_SEEDS.slice(0, seedsCount);
  return { variantsPath, seeds, ticks, outDir };
}

interface SeedRun {
  seed: number;
  delivered: number;
  generated: number;
  uptimePct: number;
  finalBrotts: number;
  finalGens: number;
  finalSalvage: number;
}

interface VariantResult {
  name: string;
  policy: AutoBuildPolicy;
  config?: Partial<SimConfig>;
  perSeed: SeedRun[];
  meanDelivered: number;
  stdDelivered: number;
  meanUptimePct: number;
  meanFinalBrotts: number;
  meanFinalGens: number;
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
    const gens = world.structures.filter(s => s.kind === 'tidal_generator').length;
    perSeed.push({
      seed,
      delivered: world.metrics.totalPowerDelivered,
      generated: world.metrics.totalPowerGenerated,
      uptimePct: (100 * world.metrics.ticksAtFullOutput) / ticks,
      finalBrotts: world.brotts.length,
      finalGens: gens,
      finalSalvage: world.inventory.salvage ?? 0,
    });
  }
  const delivered = perSeed.map(s => s.delivered);
  return {
    name: variant.name,
    policy: variant.policy,
    config: variant.config,
    perSeed,
    meanDelivered: mean(delivered),
    stdDelivered: stddev(delivered),
    meanUptimePct: mean(perSeed.map(s => s.uptimePct)),
    meanFinalBrotts: mean(perSeed.map(s => s.finalBrotts)),
    meanFinalGens: mean(perSeed.map(s => s.finalGens)),
  };
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function formatMarkdown(results: VariantResult[], ticks: number, seeds: number[]): string {
  const lines: string[] = [];
  lines.push(`# Sim-eval results`);
  lines.push(``);
  lines.push(`- ticks per run: ${ticks}`);
  lines.push(`- seeds: ${seeds.join(', ')}`);
  lines.push(``);
  lines.push(`| variant | mean delivered | std | vs baseline | mean uptime % | mean brotts | mean gens |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    const vs = r.vsBaselinePct === undefined
      ? '—'
      : `${r.vsBaselinePct >= 0 ? '+' : ''}${r.vsBaselinePct.toFixed(1)}%`;
    lines.push(
      `| ${r.name} | ${r.meanDelivered.toFixed(0)} | ${r.stdDelivered.toFixed(0)} | ${vs} | ${r.meanUptimePct.toFixed(1)} | ${r.meanFinalBrotts.toFixed(1)} | ${r.meanFinalGens.toFixed(1)} |`,
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
  for (const v of variants) {
    const r = runVariant(v, args.seeds, args.ticks);
    results.push(r);
  }
  const elapsedMs = Date.now() - t0;

  // vs-baseline %.
  const baseline = results[0];
  for (const r of results) {
    if (baseline.meanDelivered > 0) {
      r.vsBaselinePct = (100 * (r.meanDelivered - baseline.meanDelivered)) / baseline.meanDelivered;
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
