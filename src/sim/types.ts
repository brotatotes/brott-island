// Core sim types. No DOM, no rendering concerns.
// Progression-ready: capabilities/tier/inventory exist on day 1 even if mostly unused.

export type Vec2 = { x: number; y: number };

export type Capability = 'clean' | 'recharge' | 'collect' | 'repair';

export type Job = 'auto' | 'clean' | 'collect' | 'recharge_only';

export type BrottTaskKind = 'idle' | 'walk' | 'clean' | 'recharge' | 'collect' | 'repair';

export type Phase = 'recovery' | 'operations';

export interface BrottTask {
  kind: BrottTaskKind;
  targetId?: string;     // structure or debris id
  targetPos?: Vec2;      // for walk
  progress: number;      // 0..1 for ongoing work
}

export interface Brott {
  id: string;
  name: string;
  pos: Vec2;
  energy: number;        // 0..1
  capabilities: Capability[];
  task: BrottTask;
  job: Job;
}

export type StructureKind = 'tidal_generator' | 'wind_turbine' | 'charger' | 'intake';

// Generator-like structures: anything that produces power and is maintained by Brotts
// (cleaned, repaired, counted toward auto-build ratios). Add new producers here.
export const GENERATOR_KINDS: StructureKind[] = ['tidal_generator', 'wind_turbine'];
export function isGenerator(s: { kind: StructureKind }): boolean {
  return s.kind === 'tidal_generator' || s.kind === 'wind_turbine';
}

export interface Structure {
  id: string;
  kind: StructureKind;
  pos: Vec2;
  tier: number;          // day 1: always 1
  health: number;        // 0..1
  fouling: number;       // 0..1, generator only
  outputBase: number;    // kW nominal output, generator only
}

export interface Debris {
  id: string;
  pos: Vec2;
  // future: kind/mass for variety; salvage yield is currently fixed
}

export type Inventory = Record<string, number>;

export interface SimEvent {
  tick: number;
  kind: 'storm';
  targetId: string;
  magnitude: number;
}

export interface World {
  tick: number;
  phase: Phase;                // 'recovery' until starter structures repaired, then 'operations'
  rngState: number;            // for reproducibility/save (not yet used)
  brotts: Brott[];
  structures: Structure[];
  debris: Debris[];
  inventory: Inventory;        // global stockpile: power, salvage, ...
  metrics: {
    totalPowerGenerated: number;
    totalPowerDelivered: number;
    debrisCollected: number;
    ticksAtFullOutput: number;
  };
  // Auto-build bookkeeping (deterministic; populated even when policy disabled)
  lastBuildTick: number;
  brottIdleHistory: number[];  // ring buffer, 0/1 per tick — "was any brott idle this tick"
  events: SimEvent[];          // recent sim events (storms, etc.); capped ring buffer
}

export interface AutoBuildPolicy {
  enabled: boolean;             // default false
  brottPerGenTarget: number;    // default 1.0
  maxIdleRatio: number;         // default 0.5
  buildCooldownTicks: number;   // default 200
  windRatio?: number;           // default 0 → all-tidal. fraction of generators that should be wind.
}

export interface SimConfig {
  // tuning knobs the agent can sweep over
  brottSpeed: number;             // tiles/tick
  brottEnergyDrainPerTick: number;
  brottRechargeRate: number;      // energy/tick when on charger
  cleanRate: number;              // fouling reduced per tick when cleaning
  repairRate: number;             // health restored per tick when repairing
  collectDuration: number;        // ticks to collect one debris
  foulingRatePerTick: number;     // fouling added per tick
  debrisSpawnChance: number;      // per tick, 0..1
  lowEnergyThreshold: number;     // brott returns to charge below this
  highFoulingThreshold: number;   // brott prioritizes cleaning above this
  batteryCapacity: number;        // max kWh stored locally; overflow goes to delivered
  // Wind tunables (Phase B). Defaults give wind a meaningful niche
  // (cheap-to-scale + storm-vulnerable) without strictly dominating tidal.
  windBaseOutput: number;         // wind turbine nominal kW (was hard-coded 120)
  windCost: number;               // salvage cost per wind turbine
  windMeanFactor: number;         // mean of windFactor() over long horizons (~0.5)
  // Storm damage (Phase B). Wind turbines occasionally take direct health hits.
  stormChancePerTick: number;     // probability of a storm event per tick (0..1)
  stormDamageMin: number;         // min health damage per affected turbine
  stormDamageMax: number;         // max health damage per affected turbine
  stormTurbineHitChance: number;  // per-turbine probability of being hit during a storm
  autoBuild?: AutoBuildPolicy;    // optional automatic salvage spend (off by default)
}

export const DEFAULT_CONFIG: SimConfig = {
  brottSpeed: 0.15,
  brottEnergyDrainPerTick: 0.0006,
  brottRechargeRate: 0.01,
  cleanRate: 0.015,
  repairRate: 0.005,
  collectDuration: 40,
  foulingRatePerTick: 0.0008,
  batteryCapacity: 500,
  debrisSpawnChance: 0.012,
  lowEnergyThreshold: 0.25,
  highFoulingThreshold: 0.5,
  windBaseOutput: 320,
  windCost: 30,
  windMeanFactor: 0.7,
  // Storm: ~1 event per ~1250 ticks (~40 per 50k-tick run). Each storm checks every wind
  // turbine independently at 95% hit chance, damaging in [0.05, 0.18]. Brott repair verb
  // restores health. Balance: balanced-mix (windRatio=0.5) beats baseline by ~7% with
  // higher variance; wind-only is high-output but risky (large fleets get hammered per storm).
  stormChancePerTick: 0.0008,
  stormDamageMin: 0.05,
  stormDamageMax: 0.18,
  stormTurbineHitChance: 0.95,
  autoBuild: {
    enabled: false,
    brottPerGenTarget: 1.0,
    maxIdleRatio: 0.5,
    buildCooldownTicks: 200,
    windRatio: 0,
  },
};
