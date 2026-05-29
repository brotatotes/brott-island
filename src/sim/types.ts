// Core sim types. No DOM, no rendering concerns.
// Progression-ready: capabilities/tier/inventory exist on day 1 even if mostly unused.

export type Vec2 = { x: number; y: number };

export type Capability = 'clean' | 'recharge' | 'collect' | 'repair' | 'restart';

export type Job = 'auto' | 'clean' | 'collect' | 'recharge_only';

export type BrottTaskKind = 'idle' | 'walk' | 'clean' | 'recharge' | 'collect' | 'repair' | 'restart';

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
  stationId?: string;    // recharge station that owns this Brott's slot
}

// Phase C: 'charger' renamed to 'recharge_station'. First one carries solar=true.
export type StructureKind = 'tidal_generator' | 'wind_turbine' | 'recharge_station' | 'intake';

// Generator-like structures: anything that produces power and is maintained by Brotts
// (cleaned, repaired, counted toward auto-build ratios). Add new producers here.
export const GENERATOR_KINDS: StructureKind[] = ['tidal_generator', 'wind_turbine'];
export function isGenerator(s: { kind: StructureKind }): boolean {
  return s.kind === 'tidal_generator' || s.kind === 'wind_turbine';
}

/**
 * "Basic" producer = produces power with zero parasitic draw and never auto-powers-off
 * in a blackout. Wind turbines + solar recharge stations. Used for game-over check.
 */
export function isBasicProducer(s: { kind: StructureKind; solar?: boolean; health: number }): boolean {
  if (s.health < 0.8) return false;
  if (s.kind === 'wind_turbine') return true;
  if (s.kind === 'recharge_station' && s.solar) return true;
  return false;
}

/**
 * Parasitic = consumes battery while online. Auto-powers-off when battery hits zero.
 * Tidal generators + plain (non-solar) recharge stations.
 */
export function isParasitic(s: { kind: StructureKind; solar?: boolean }): boolean {
  if (s.kind === 'tidal_generator') return true;
  if (s.kind === 'recharge_station' && !s.solar) return true;
  return false;
}

export interface Structure {
  id: string;
  kind: StructureKind;
  pos: Vec2;
  tier: number;          // day 1: always 1
  health: number;        // 0..1
  fouling: number;       // 0..1, generator only
  outputBase: number;    // kW nominal output, generator only
  online: boolean;       // false when blackout-disabled; must be restarted by a Brott
  solar?: boolean;       // recharge stations only: true = solar panel, never offline
}

export interface Debris {
  id: string;
  pos: Vec2;
}

export type Inventory = Record<string, number>;

export type SimEventKind = 'storm' | 'blackout' | 'restart' | 'low_battery_first' | 'game_over' | 'brott_died';

export interface SimEvent {
  tick: number;
  kind: SimEventKind;
  targetId: string;
  magnitude: number;
}

export interface World {
  tick: number;
  phase: Phase;                // 'recovery' until starter structures repaired, then 'operations'
  rngState: number;
  brotts: Brott[];
  structures: Structure[];
  debris: Debris[];
  inventory: Inventory;        // global stockpile: power, salvage, ...
  metrics: {
    totalPowerGenerated: number;
    totalPowerDelivered: number;   // legacy/visibility — wasted overflow
    totalPowerConsumed: number;
    totalPowerWasted: number;
    debrisCollected: number;
    ticksAtFullOutput: number;
    ticksSurvived: number;         // primary score
    blackouts: number;
    restarts: number;
    brottTickAliveSum: number;     // secondary: aggregate Brott-tick count
    deaths: number;
  };
  // Auto-build bookkeeping
  lastBuildTick: number;
  brottIdleHistory: number[];
  events: SimEvent[];
  // Game state
  gameOver: boolean;
  lowBatteryAlarmFired: boolean;   // first-time low-battery cue tracking
}

export interface AutoBuildPolicy {
  enabled: boolean;
  brottPerGenTarget: number;
  maxIdleRatio: number;
  buildCooldownTicks: number;
  windRatio?: number;               // fraction of new generators that should be wind
  rechargeStationRatio?: number;    // fraction of total builds devoted to recharge stations
                                    // (so the Brott cap grows alongside the fleet)
}

export interface SimConfig {
  brottSpeed: number;
  brottEnergyDrainPerTick: number;
  brottRechargeRate: number;        // energy/tick when on a recharge station
  cleanRate: number;
  repairRate: number;
  restartRate: number;              // progress/tick on restart verb
  collectDuration: number;
  foulingRatePerTick: number;
  debrisSpawnChance: number;
  lowEnergyThreshold: number;
  highFoulingThreshold: number;
  batteryCapacity: number;          // max kWh stored on the island
  batteryRestartThreshold: number;  // 0..1 fraction of battery cap required before Brotts will restart offline buildings
  lowBatteryAlarmThreshold: number; // 0..1 fraction; below this triggers the first-time alarm
  // Power flows
  tidalParasiticDraw: number;       // kW consumed by each tidal generator each tick while online
  rechargeStationIdleDraw: number;  // kW consumed by a plain recharge station each tick (lights, sensors)
  rechargeStationActiveDraw: number;// kW additional draw when a Brott is recharging at a plain station
  solarTrickleOutput: number;       // kW produced each tick by a solar recharge station (its own panel)
  // Wind
  windBaseOutput: number;
  windCost: number;
  windMeanFactor: number;
  // Storm
  stormChancePerTick: number;
  stormDamageMin: number;
  stormDamageMax: number;
  stormTurbineHitChance: number;
  autoBuild?: AutoBuildPolicy;
}

export const DEFAULT_CONFIG: SimConfig = {
  brottSpeed: 0.15,
  brottEnergyDrainPerTick: 0.0006,
  brottRechargeRate: 0.01,
  cleanRate: 0.015,
  repairRate: 0.005,
  restartRate: 0.02,                // ~50 ticks per restart
  collectDuration: 40,
  foulingRatePerTick: 0.0008,
  batteryCapacity: 800,             // medium capacity, sized so a balanced fleet has ~30s of buffer at peak draw
  batteryRestartThreshold: 0.2,
  lowBatteryAlarmThreshold: 0.3,
  // Tidal: parasitic ~8% of base output. Net ~92 kW per healthy generator.
  tidalParasiticDraw: 8,
  rechargeStationIdleDraw: 0.5,
  rechargeStationActiveDraw: 1.5,   // recharging a Brott costs 1.5 kWh/tick on top of idle draw
  solarTrickleOutput: 2.0,          // enough to cover one Brott's recharge indefinitely (~2 vs 2)
  debrisSpawnChance: 0.012,
  lowEnergyThreshold: 0.25,
  highFoulingThreshold: 0.5,
  windBaseOutput: 320,
  windCost: 30,
  windMeanFactor: 0.7,
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
    rechargeStationRatio: 0.15,
  },
};
