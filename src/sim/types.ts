// Core sim types. No DOM, no rendering concerns.
// Progression-ready: capabilities/tier/inventory exist on day 1 even if mostly unused.

export type Vec2 = { x: number; y: number };

export type Capability = 'clean' | 'recharge' | 'collect';

export type BrottTaskKind = 'idle' | 'walk' | 'clean' | 'recharge' | 'collect';

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
}

export type StructureKind = 'tidal_generator' | 'charger' | 'intake';

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

export interface World {
  tick: number;
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
}

export interface SimConfig {
  // tuning knobs the agent can sweep over
  brottSpeed: number;             // tiles/tick
  brottEnergyDrainPerTick: number;
  brottRechargeRate: number;      // energy/tick when on charger
  cleanRate: number;              // fouling reduced per tick when cleaning
  collectDuration: number;        // ticks to collect one debris
  foulingRatePerTick: number;     // fouling added per tick
  debrisSpawnChance: number;      // per tick, 0..1
  lowEnergyThreshold: number;     // brott returns to charge below this
  highFoulingThreshold: number;   // brott prioritizes cleaning above this
  batteryCapacity: number;        // max kWh stored locally; overflow goes to delivered
}

export const DEFAULT_CONFIG: SimConfig = {
  brottSpeed: 0.15,
  brottEnergyDrainPerTick: 0.0006,
  brottRechargeRate: 0.01,
  cleanRate: 0.015,
  collectDuration: 40,
  foulingRatePerTick: 0.0008,
  batteryCapacity: 500,
  debrisSpawnChance: 0.004,
  lowEnergyThreshold: 0.25,
  highFoulingThreshold: 0.5,
};
