// Dashboard DOM updater. Reads world state, mutates only the dashboard DOM.

import { World, Brott, Structure, Job, DEFAULT_CONFIG } from '../sim/types';
import {
  buildTidalGenerator, TIDAL_GENERATOR_COST, MAX_TIDAL_GENERATORS,
  buildBrott, BROTT_COST, brottCap,
  buildWindTurbine, WIND_TURBINE_COST, MAX_WIND_TURBINES,
  buildRechargeStation, RECHARGE_STATION_COST, MAX_RECHARGE_STATIONS,
} from '../sim/world';

export interface DashboardCallbacks {
  onBuildGenerator?: (newId: string) => void;
  onBuildBrott?: (newId: string) => void;
  onBuildWindTurbine?: (newId: string) => void;
  onBuildStation?: (newId: string) => void;
  onAlarm?: () => void;
}

type RowCache = {
  el: HTMLLIElement;
  nameEl: HTMLSpanElement;
  metaEl: HTMLSpanElement;
  jobEl: HTMLSelectElement;
  brottId: string;
};

type StructRowCache = {
  el: HTMLLIElement;
  nameEl: HTMLSpanElement;
  metaEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  id: string;
};

export function initDashboard(world: World, callbacks: DashboardCallbacks = {}): {
  update: () => void;
} {
  // Brott portrait row
  const portraitRow = document.getElementById('brott-portraits') as HTMLDivElement;
  // Battery icon
  const batteryFill = document.getElementById('battery-fill') as HTMLDivElement;
  const batteryLabel = document.getElementById('battery-label') as HTMLDivElement;
  const batteryRate = document.getElementById('battery-rate') as HTMLDivElement;
  const batteryShell = document.getElementById('battery-shell') as HTMLDivElement;
  // Survival
  const survivalEl = document.getElementById('m-survived') as HTMLSpanElement;
  const phaseEl = document.getElementById('m-phase') as HTMLSpanElement;
  const salvageEl = document.getElementById('m-salvage') as HTMLSpanElement;

  const brottList = document.getElementById('brott-list') as HTMLUListElement;
  const structList = document.getElementById('struct-list') as HTMLUListElement;

  const buildBtn = document.getElementById('build-gen') as HTMLButtonElement;
  const buildHint = document.getElementById('build-hint')!;
  const buildBrottBtn = document.getElementById('build-brott') as HTMLButtonElement;
  const buildBrottHint = document.getElementById('build-brott-hint')!;
  const buildWindBtn = document.getElementById('build-wind') as HTMLButtonElement;
  const buildWindHint = document.getElementById('build-wind-hint')!;
  const buildStationBtn = document.getElementById('build-station') as HTMLButtonElement;
  const buildStationHint = document.getElementById('build-station-hint')!;
  const log = document.getElementById('event-log') as HTMLDivElement;

  let lastSeenStormTick = -1;
  let lastSeenBlackoutTick = -1;
  let lastSeenRestartTick = -1;
  let lastSeenDeathTick = -1;
  let alarmFired = false;
  // For inflow/outflow tracking — sample deltas over a short window.
  let prevGenerated = 0;
  let prevConsumed = 0;
  let netRateSmoothed = 0;
  const NET_RATE_ALPHA = 0.1;

  buildBtn.addEventListener('click', () => {
    const newId = buildTidalGenerator(world);
    if (newId) { pushLog(log, `Built tidal generator`); callbacks.onBuildGenerator?.(newId); }
  });
  buildBrottBtn.addEventListener('click', () => {
    const newId = buildBrott(world);
    if (newId) {
      const b = world.brotts.find(x => x.id === newId);
      pushLog(log, `Built ${b?.name ?? newId}`);
      callbacks.onBuildBrott?.(newId);
    }
  });
  buildWindBtn.addEventListener('click', () => {
    const newId = buildWindTurbine(world);
    if (newId) { pushLog(log, `Built wind turbine`); callbacks.onBuildWindTurbine?.(newId); }
  });
  buildStationBtn.addEventListener('click', () => {
    const newId = buildRechargeStation(world);
    if (newId) {
      pushLog(log, `Built recharge station — Brott cap +1`);
      callbacks.onBuildStation?.(newId);
    }
  });

  const brottRows = new Map<string, RowCache>();
  const structRows = new Map<string, StructRowCache>();

  function update(): void {
    const cfg = DEFAULT_CONFIG;
    const cap = cfg.batteryCapacity;
    const stored = world.inventory.power ?? 0;
    const batteryFrac = Math.max(0, Math.min(1, stored / cap));

    // --- Battery icon ---
    batteryFill.style.height = `${(batteryFrac * 100).toFixed(1)}%`;
    let zone: 'green' | 'yellow' | 'red';
    if (batteryFrac > 0.5) zone = 'green';
    else if (batteryFrac > 0.2) zone = 'yellow';
    else zone = 'red';
    batteryFill.dataset.zone = zone;
    batteryShell.dataset.zone = zone;
    batteryLabel.textContent = `${(batteryFrac * 100).toFixed(0)}%`;

    // Net rate
    const genDelta = world.metrics.totalPowerGenerated - prevGenerated;
    const consDelta = world.metrics.totalPowerConsumed - prevConsumed;
    prevGenerated = world.metrics.totalPowerGenerated;
    prevConsumed = world.metrics.totalPowerConsumed;
    const instNet = genDelta - consDelta;
    netRateSmoothed = netRateSmoothed * (1 - NET_RATE_ALPHA) + instNet * NET_RATE_ALPHA;
    const arrow = netRateSmoothed >= 0 ? '▲' : '▼';
    const color = netRateSmoothed >= 0 ? '#5aa37a' : '#c85a5a';
    batteryRate.innerHTML = `<span style="color:${color}">${arrow} ${Math.abs(netRateSmoothed).toFixed(1)} kW</span>`;

    // First-time low-battery alarm
    if (!alarmFired && batteryFrac < cfg.lowBatteryAlarmThreshold && world.phase === 'operations') {
      alarmFired = true;
      pushLog(log, `⚠️ BLEEP — battery low. Self-sustaining wind turbines will carry the load.`);
      batteryShell.classList.add('shake');
      setTimeout(() => batteryShell.classList.remove('shake'), 800);
      callbacks.onAlarm?.();
    }

    // --- Status row ---
    survivalEl.textContent = `${world.metrics.ticksSurvived}${world.gameOver ? ' — GAME OVER' : ''}`;
    phaseEl.textContent = world.phase;
    salvageEl.textContent = String(world.inventory.salvage ?? 0);

    // --- Brott portrait row ---
    syncPortraits(portraitRow, world);

    // --- Brott rows ---
    syncBrottRows(brottList, world.brotts, brottRows);

    // --- Structure rows ---
    syncStructureRows(structList, world.structures, structRows);

    // --- Build buttons ---
    const recovery = world.phase === 'recovery';
    const salvage = world.inventory.salvage ?? 0;

    const gensCount = world.structures.filter(s => s.kind === 'tidal_generator').length;
    const gensFull = gensCount >= MAX_TIDAL_GENERATORS;
    const canAffordGen = salvage >= TIDAL_GENERATOR_COST;
    buildBtn.disabled = recovery || !canAffordGen || gensFull;
    buildBtn.title = '⚡ parasitic powerhouse — needs battery to run';
    if (recovery) buildHint.textContent = `Phase 1: complete recovery first.`;
    else if (gensFull) buildHint.textContent = `All generator slots full (${MAX_TIDAL_GENERATORS})`;
    else if (canAffordGen) buildHint.textContent = `Ready (cost ${TIDAL_GENERATOR_COST}) — ⚡ parasitic`;
    else buildHint.textContent = `Need ${TIDAL_GENERATOR_COST - salvage} more salvage`;

    const windCount = world.structures.filter(s => s.kind === 'wind_turbine').length;
    const windFull = windCount >= MAX_WIND_TURBINES;
    const canAffordWind = salvage >= WIND_TURBINE_COST;
    buildWindBtn.disabled = recovery || !canAffordWind || windFull;
    buildWindBtn.title = '🔄 basic, self-sustaining';
    if (recovery) buildWindHint.textContent = `Phase 1: complete recovery first.`;
    else if (windFull) buildWindHint.textContent = `All wind slots full (${MAX_WIND_TURBINES})`;
    else if (canAffordWind) buildWindHint.textContent = `Ready (cost ${WIND_TURBINE_COST}) — 🔄 self-sustaining`;
    else buildWindHint.textContent = `Need ${WIND_TURBINE_COST - salvage} more salvage`;

    const stationCount = world.structures.filter(s => s.kind === 'recharge_station').length;
    const stationsFull = stationCount >= MAX_RECHARGE_STATIONS;
    const canAffordStation = salvage >= RECHARGE_STATION_COST;
    buildStationBtn.disabled = recovery || !canAffordStation || stationsFull;
    buildStationBtn.title = 'Adds +1 Brott slot';
    if (recovery) buildStationHint.textContent = `Phase 1: complete recovery first.`;
    else if (stationsFull) buildStationHint.textContent = `All station sites full (${MAX_RECHARGE_STATIONS})`;
    else if (canAffordStation) buildStationHint.textContent = `Ready (cost ${RECHARGE_STATION_COST}) — +1 Brott slot`;
    else buildStationHint.textContent = `Need ${RECHARGE_STATION_COST - salvage} more salvage`;

    // Brott button needs an open slot
    const brottsCount = world.brotts.length;
    const capN = brottCap(world);
    const slotsOpen = brottsCount < capN;
    const canAffordBrott = salvage >= BROTT_COST;
    buildBrottBtn.disabled = recovery || !canAffordBrott || !slotsOpen;
    if (recovery) buildBrottHint.textContent = `Phase 1: complete recovery first.`;
    else if (!slotsOpen) {
      buildBrottHint.textContent = `No empty Brott slot — build a recharge station first`;
    }
    else if (canAffordBrott) buildBrottHint.textContent = `Ready (cost ${BROTT_COST})`;
    else buildBrottHint.textContent = `Need ${BROTT_COST - salvage} more salvage`;

    // Surface events
    for (const e of world.events) {
      if (e.kind === 'storm' && e.tick > lastSeenStormTick) {
        if (e.targetId === '') pushLog(log, `⚡ Storm passed (no turbines hit)`);
        else pushLog(log, `⚡ Storm damaged ${e.targetId} (-${(e.magnitude * 100).toFixed(0)}% health)`);
      } else if (e.kind === 'blackout' && e.tick > lastSeenBlackoutTick) {
        pushLog(log, `⏻ BLACKOUT — ${e.targetId} went offline`);
      } else if (e.kind === 'restart' && e.tick > lastSeenRestartTick) {
        pushLog(log, `▶ Restarted ${e.targetId}`);
      } else if (e.kind === 'brott_died' && e.tick > lastSeenDeathTick) {
        pushLog(log, `☠ A Brott has died (${e.targetId})`);
      } else if (e.kind === 'game_over') {
        pushLog(log, `— GAME OVER (${e.targetId}) —`);
      }
    }
    for (const e of world.events) {
      if (e.kind === 'storm') lastSeenStormTick = Math.max(lastSeenStormTick, e.tick);
      if (e.kind === 'blackout') lastSeenBlackoutTick = Math.max(lastSeenBlackoutTick, e.tick);
      if (e.kind === 'restart') lastSeenRestartTick = Math.max(lastSeenRestartTick, e.tick);
      if (e.kind === 'brott_died') lastSeenDeathTick = Math.max(lastSeenDeathTick, e.tick);
    }
  }

  return { update };
}

function syncPortraits(row: HTMLDivElement, world: World): void {
  const stations = world.structures.filter(s => s.kind === 'recharge_station');
  // Map brotts to their station (or first available)
  // Pre-cache children
  const desired = stations.length;
  while (row.children.length < desired) {
    const slot = document.createElement('div');
    slot.className = 'portrait-slot';
    const bar = document.createElement('div');
    bar.className = 'portrait-bar';
    slot.appendChild(bar);
    row.appendChild(slot);
  }
  while (row.children.length > desired) {
    row.removeChild(row.lastChild!);
  }
  for (let i = 0; i < desired; i++) {
    const slotEl = row.children[i] as HTMLDivElement;
    const station = stations[i];
    const brott = world.brotts.find(b => b.stationId === station.id)
      ?? (i < world.brotts.length && !world.brotts.some(b => b.stationId === stations[i].id) ? world.brotts[i] : undefined);
    const bar = slotEl.querySelector('.portrait-bar') as HTMLDivElement;

    if (!station.online) {
      slotEl.dataset.state = 'station-off';
      slotEl.textContent = '⏻';
      slotEl.appendChild(bar);
      bar.style.width = '0%';
    } else if (!brott) {
      slotEl.dataset.state = 'empty';
      slotEl.textContent = '+';
      slotEl.appendChild(bar);
      slotEl.title = 'Empty slot — build a Brott to fill';
      bar.style.width = '0%';
    } else {
      slotEl.dataset.state = 'filled';
      slotEl.textContent = brott.name.replace(/^Brott-?0*/, 'B') || 'B';
      slotEl.appendChild(bar);
      bar.style.width = `${(brott.energy * 100).toFixed(0)}%`;
      slotEl.title = `${brott.name} — energy ${(brott.energy * 100).toFixed(0)}% — task ${brott.task.kind}`;
    }
    // tombstone if brott died this session and slot is empty? (we don't track death-per-slot;
    // empty slot is sufficient visual)
  }
}

function syncBrottRows(
  list: HTMLUListElement,
  brotts: Brott[],
  cache: Map<string, RowCache>,
): void {
  const seen = new Set<string>();
  for (const b of brotts) {
    seen.add(b.id);
    let row = cache.get(b.id);
    if (!row) {
      row = createBrottRow(b);
      cache.set(b.id, row);
      list.appendChild(row.el);
    }
    if (!row.nameEl.classList.contains('editing')) {
      if (row.nameEl.textContent !== b.name) row.nameEl.textContent = b.name;
    }
    row.metaEl.textContent = `${(b.energy * 100).toFixed(0)}%  ${b.task.kind}`;
    if (row.jobEl.value !== b.job) row.jobEl.value = b.job;
  }
  for (const [id, row] of cache) {
    if (!seen.has(id)) {
      row.el.remove();
      cache.delete(id);
    }
  }
}

function createBrottRow(brott: Brott): RowCache {
  const li = document.createElement('li');
  li.className = 'roster-row';

  const left = document.createElement('div');
  left.className = 'roster-left';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'roster-name';
  nameSpan.textContent = brott.name;
  nameSpan.title = 'Click to rename';
  nameSpan.addEventListener('click', () => startEdit(nameSpan, brott));
  left.appendChild(nameSpan);

  const meta = document.createElement('span');
  meta.className = 'roster-meta';
  left.appendChild(meta);

  li.appendChild(left);

  const jobSel = document.createElement('select');
  jobSel.className = 'job-select';
  const jobOptions: { value: Job; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'clean', label: 'Clean only' },
    { value: 'collect', label: 'Collect only' },
    { value: 'recharge_only', label: 'Recharge only' },
  ];
  for (const o of jobOptions) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    jobSel.appendChild(opt);
  }
  jobSel.value = brott.job;
  jobSel.addEventListener('change', () => {
    const next = jobSel.value as Job;
    if (brott.job !== next) brott.job = next;
  });
  li.appendChild(jobSel);

  return { el: li, nameEl: nameSpan, metaEl: meta, jobEl: jobSel, brottId: brott.id };
}

function startEdit(nameSpan: HTMLSpanElement, brott: Brott): void {
  if (nameSpan.classList.contains('editing')) return;
  nameSpan.classList.add('editing');
  const original = brott.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = original;
  input.maxLength = 32;

  const commit = (save: boolean) => {
    const next = save ? input.value.trim() : original;
    if (save && next.length > 0) brott.name = next;
    nameSpan.textContent = brott.name;
    nameSpan.classList.remove('editing');
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));

  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.focus();
  input.select();
}

function syncStructureRows(
  list: HTMLUListElement,
  structures: Structure[],
  cache: Map<string, StructRowCache>,
): void {
  const seen = new Set<string>();
  for (const s of structures) {
    seen.add(s.id);
    let row = cache.get(s.id);
    if (!row) {
      row = createStructRow(s);
      cache.set(s.id, row);
      list.appendChild(row.el);
    }
    row.metaEl.textContent = metaFor(s);
    const status = statusFor(s);
    row.statusEl.textContent = status;
    row.statusEl.dataset.status = status.toLowerCase();
  }
  for (const [id, row] of cache) {
    if (!seen.has(id)) {
      row.el.remove();
      cache.delete(id);
    }
  }
}

function createStructRow(s: Structure): StructRowCache {
  const li = document.createElement('li');
  li.className = 'struct-row';

  const left = document.createElement('div');
  left.className = 'struct-left';

  const name = document.createElement('span');
  name.className = 'struct-name';
  name.textContent = labelFor(s);
  left.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'struct-meta';
  left.appendChild(meta);

  li.appendChild(left);

  const status = document.createElement('span');
  status.className = 'struct-status';
  li.appendChild(status);

  return { el: li, nameEl: name, metaEl: meta, statusEl: status, id: s.id };
}

function labelFor(s: Structure): string {
  switch (s.kind) {
    case 'tidal_generator': return `⚡ Tidal (${s.id})`;
    case 'wind_turbine': return `🔄 Wind (${s.id})`;
    case 'recharge_station': return s.solar ? `☀️ Station (${s.id})` : `Station (${s.id})`;
    case 'intake': return `Intake (${s.id})`;
  }
}

function metaFor(s: Structure): string {
  if (s.kind === 'tidal_generator' || s.kind === 'wind_turbine') {
    return `health ${(s.health * 100).toFixed(0)}%  fouling ${(s.fouling * 100).toFixed(0)}%`;
  }
  return `health ${(s.health * 100).toFixed(0)}%`;
}

function statusFor(s: Structure): string {
  if (s.health < 0.8) return 'Broken';
  if (!s.online) return 'Offline';
  if (s.kind === 'tidal_generator' || s.kind === 'wind_turbine') {
    if (s.fouling >= 0.5) return 'Fouled';
    return 'Active';
  }
  if (s.kind === 'recharge_station') return 'Active';
  if (s.kind === 'intake') return 'Active';
  return 'Idle';
}

function pushLog(log: HTMLDivElement, msg: string): void {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  log.appendChild(line);
  while (log.childNodes.length > 10) log.removeChild(log.firstChild!);
  log.scrollTop = log.scrollHeight;
}
