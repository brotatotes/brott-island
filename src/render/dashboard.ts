// Dashboard DOM updater. Reads world state, mutates only the dashboard DOM.
// Phase D: HUD layout (no sidebar). Popover replaces roster/structure lists.

import { World, Structure, Job, DEFAULT_CONFIG } from '../sim/types';
import {
  buildTidalGenerator, TIDAL_GENERATOR_COST, MAX_TIDAL_GENERATORS,
  buildBrott, BROTT_COST, brottCap,
  buildWindTurbine, WIND_TURBINE_COST, MAX_WIND_TURBINES,
  buildRechargeStation, RECHARGE_STATION_COST, MAX_RECHARGE_STATIONS,
} from '../sim/world';
import { hitTest, HoverTarget } from './scene';

export interface DashboardCallbacks {
  onBuildGenerator?: (newId: string) => void;
  onBuildBrott?: (newId: string) => void;
  onBuildWindTurbine?: (newId: string) => void;
  onBuildStation?: (newId: string) => void;
  onAlarm?: () => void;
}

type PopoverState =
  | { kind: 'brott'; id: string }
  | { kind: 'structure'; id: string }
  | null;

export function initDashboard(world: World, callbacks: DashboardCallbacks = {}): {
  update: () => void;
  openPopoverAt: (canvasX: number, canvasY: number, clientX: number, clientY: number) => void;
  closePopover: () => void;
} {
  // Top HUD
  const portraitRow = document.getElementById('brott-portraits') as HTMLDivElement;
  const batteryFill = document.getElementById('battery-fill') as HTMLDivElement;
  const batteryLabel = document.getElementById('battery-label') as HTMLDivElement;
  const batteryRate = document.getElementById('battery-rate') as HTMLDivElement;
  const batteryShell = document.getElementById('battery-shell') as HTMLDivElement;
  const survivalEl = document.getElementById('m-survived') as HTMLSpanElement;
  const phaseEl = document.getElementById('m-phase') as HTMLSpanElement;
  const salvageEl = document.getElementById('m-salvage') as HTMLSpanElement;

  // Build bar
  const buildBtn = document.getElementById('build-gen') as HTMLButtonElement;
  const buildBrottBtn = document.getElementById('build-brott') as HTMLButtonElement;
  const buildWindBtn = document.getElementById('build-wind') as HTMLButtonElement;
  const buildStationBtn = document.getElementById('build-station') as HTMLButtonElement;

  // Floating
  const log = document.getElementById('event-log') as HTMLDivElement;
  const popover = document.getElementById('popover') as HTMLDivElement;

  let lastSeenStormTick = -1;
  let lastSeenBlackoutTick = -1;
  let lastSeenRestartTick = -1;
  let lastSeenDeathTick = -1;
  let alarmFired = false;
  let prevGenerated = 0;
  let prevConsumed = 0;
  let netRateSmoothed = 0;
  const NET_RATE_ALPHA = 0.1;

  let popState: PopoverState = null;

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

  // Close popover on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  function openPopoverAt(canvasX: number, canvasY: number, clientX: number, clientY: number): void {
    const hit = hitTest(world, canvasX, canvasY);
    if (!hit) { closePopover(); return; }
    if (hit.kind === 'brott') popState = { kind: 'brott', id: hit.ref.id };
    else if (hit.kind === 'structure') popState = { kind: 'structure', id: hit.ref.id };
    else { closePopover(); return; }
    renderPopover(popover, world, popState);
    positionPopover(popover, clientX, clientY);
    popover.classList.remove('hidden');
  }

  function closePopover(): void {
    popState = null;
    popover.classList.add('hidden');
    popover.replaceChildren();
  }

  function update(): void {
    const cfg = DEFAULT_CONFIG;
    const cap = cfg.batteryCapacity;
    const stored = world.inventory.power ?? 0;
    const batteryFrac = Math.max(0, Math.min(1, stored / cap));

    // Battery (horizontal pill)
    batteryFill.style.width = `${(batteryFrac * 100).toFixed(1)}%`;
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

    // Stats
    survivalEl.textContent = `${world.metrics.ticksSurvived}${world.gameOver ? ' — GAME OVER' : ''}`;
    phaseEl.textContent = world.phase;
    salvageEl.textContent = String(world.inventory.salvage ?? 0);

    // Portraits
    syncPortraits(portraitRow, world);

    // Build button state (hints moved into title tooltips)
    const recovery = world.phase === 'recovery';
    const salvage = world.inventory.salvage ?? 0;

    const gensCount = world.structures.filter(s => s.kind === 'tidal_generator').length;
    const gensFull = gensCount >= MAX_TIDAL_GENERATORS;
    const canAffordGen = salvage >= TIDAL_GENERATOR_COST;
    buildBtn.disabled = recovery || !canAffordGen || gensFull;
    buildBtn.title = recovery ? 'Phase 1: complete recovery first.'
      : gensFull ? `All generator slots full (${MAX_TIDAL_GENERATORS})`
      : canAffordGen ? `Ready (cost ${TIDAL_GENERATOR_COST}) — ⚡ parasitic, needs battery`
      : `Need ${TIDAL_GENERATOR_COST - salvage} more salvage`;

    const windCount = world.structures.filter(s => s.kind === 'wind_turbine').length;
    const windFull = windCount >= MAX_WIND_TURBINES;
    const canAffordWind = salvage >= WIND_TURBINE_COST;
    buildWindBtn.disabled = recovery || !canAffordWind || windFull;
    buildWindBtn.title = recovery ? 'Phase 1: complete recovery first.'
      : windFull ? `All wind slots full (${MAX_WIND_TURBINES})`
      : canAffordWind ? `Ready (cost ${WIND_TURBINE_COST}) — 🔄 self-sustaining`
      : `Need ${WIND_TURBINE_COST - salvage} more salvage`;

    const stationCount = world.structures.filter(s => s.kind === 'recharge_station').length;
    const stationsFull = stationCount >= MAX_RECHARGE_STATIONS;
    const canAffordStation = salvage >= RECHARGE_STATION_COST;
    buildStationBtn.disabled = recovery || !canAffordStation || stationsFull;
    buildStationBtn.title = recovery ? 'Phase 1: complete recovery first.'
      : stationsFull ? `All station sites full (${MAX_RECHARGE_STATIONS})`
      : canAffordStation ? `Ready (cost ${RECHARGE_STATION_COST}) — +1 Brott slot`
      : `Need ${RECHARGE_STATION_COST - salvage} more salvage`;

    const brottsCount = world.brotts.length;
    const capN = brottCap(world);
    const slotsOpen = brottsCount < capN;
    const canAffordBrott = salvage >= BROTT_COST;
    buildBrottBtn.disabled = recovery || !canAffordBrott || !slotsOpen;
    buildBrottBtn.title = recovery ? 'Phase 1: complete recovery first.'
      : !slotsOpen ? 'No empty Brott slot — build a recharge station first'
      : canAffordBrott ? `Ready (cost ${BROTT_COST})`
      : `Need ${BROTT_COST - salvage} more salvage`;

    // Events → log
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

    // Refresh popover contents if open (state-dependent fields)
    if (popState) {
      // Confirm target still exists; if not, close
      if (popState.kind === 'brott' && !world.brotts.find(b => b.id === popState!.id)) closePopover();
      else if (popState.kind === 'structure' && !world.structures.find(s => s.id === popState!.id)) closePopover();
      else refreshPopoverDynamic(popover, world, popState);
    }
  }

  return { update, openPopoverAt, closePopover };
}

// ---------------- Popover render ----------------

function renderPopover(pop: HTMLDivElement, world: World, state: PopoverState): void {
  if (!state) return;
  pop.replaceChildren();
  const title = document.createElement('div');
  title.className = 'pop-title';
  const titleText = document.createElement('span');
  titleText.dataset.role = 'pop-title-text';
  title.appendChild(titleText);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pop-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    pop.classList.add('hidden');
    pop.replaceChildren();
  });
  title.appendChild(closeBtn);
  pop.appendChild(title);

  if (state.kind === 'brott') {
    const b = world.brotts.find(x => x.id === state.id);
    if (!b) return;
    titleText.textContent = b.name;

    // Rename
    const renameRow = document.createElement('div');
    renameRow.className = 'pop-row';
    const renameInput = document.createElement('input');
    renameInput.className = 'rename-input';
    renameInput.type = 'text';
    renameInput.maxLength = 32;
    renameInput.value = b.name;
    renameInput.dataset.role = 'rename';
    const commit = () => {
      const next = renameInput.value.trim();
      if (next.length > 0 && next !== b.name) {
        b.name = next;
        titleText.textContent = b.name;
      } else {
        renameInput.value = b.name;
      }
    };
    renameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); renameInput.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); renameInput.value = b.name; renameInput.blur(); }
    });
    renameInput.addEventListener('blur', commit);
    renameRow.appendChild(renameInput);
    pop.appendChild(renameRow);

    // Job
    const jobRow = document.createElement('div');
    jobRow.className = 'pop-row';
    const jobLabel = document.createElement('span');
    jobLabel.className = 'pop-meta';
    jobLabel.textContent = 'job';
    const jobSel = document.createElement('select');
    jobSel.className = 'job-select';
    jobSel.dataset.role = 'job';
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
    jobSel.value = b.job;
    jobSel.addEventListener('change', () => { b.job = jobSel.value as Job; });
    jobRow.appendChild(jobLabel);
    jobRow.appendChild(jobSel);
    pop.appendChild(jobRow);

    // Dynamic stats
    const meta = document.createElement('div');
    meta.className = 'pop-meta';
    meta.dataset.role = 'meta';
    pop.appendChild(meta);

  } else if (state.kind === 'structure') {
    const s = world.structures.find(x => x.id === state.id);
    if (!s) return;
    titleText.textContent = structLabel(s);

    const statusRow = document.createElement('div');
    statusRow.className = 'pop-row';
    const statusBadge = document.createElement('span');
    statusBadge.className = 'pop-status';
    statusBadge.dataset.role = 'status';
    statusRow.appendChild(statusBadge);
    pop.appendChild(statusRow);

    const meta = document.createElement('div');
    meta.className = 'pop-meta';
    meta.dataset.role = 'meta';
    pop.appendChild(meta);

    // Note: restart is performed by Brotts autonomously (no manual restart action in sim API).
    // We surface the OFFLINE status visually so the player knows a Brott will get to it.
  }

  refreshPopoverDynamic(pop, world, state);
}

function refreshPopoverDynamic(pop: HTMLDivElement, world: World, state: PopoverState): void {
  if (!state) return;
  const meta = pop.querySelector('[data-role="meta"]') as HTMLDivElement | null;
  if (state.kind === 'brott') {
    const b = world.brotts.find(x => x.id === state.id);
    if (!b || !meta) return;
    meta.textContent = `energy ${(b.energy * 100).toFixed(0)}%  •  task ${b.task.kind}`;
    const jobSel = pop.querySelector('[data-role="job"]') as HTMLSelectElement | null;
    if (jobSel && document.activeElement !== jobSel && jobSel.value !== b.job) jobSel.value = b.job;
    const renameInput = pop.querySelector('[data-role="rename"]') as HTMLInputElement | null;
    if (renameInput && document.activeElement !== renameInput && renameInput.value !== b.name) {
      renameInput.value = b.name;
    }
  } else if (state.kind === 'structure') {
    const s = world.structures.find(x => x.id === state.id);
    if (!s || !meta) return;
    const status = statusFor(s);
    const badge = pop.querySelector('[data-role="status"]') as HTMLSpanElement | null;
    if (badge) {
      badge.textContent = status;
      badge.dataset.status = status.toLowerCase();
    }
    meta.textContent = metaFor(s);
  }
}

function positionPopover(pop: HTMLDivElement, clientX: number, clientY: number): void {
  // Position relative to viewport, clamp inside
  const PAD = 8;
  pop.style.left = '0px';
  pop.style.top = '0px';
  pop.classList.remove('hidden');
  const rect = pop.getBoundingClientRect();
  // The popover is positioned inside #stage-wrap (its parent), so subtract its bounds
  const wrap = pop.parentElement as HTMLElement;
  const wrapRect = wrap.getBoundingClientRect();
  let x = clientX - wrapRect.left + 12;
  let y = clientY - wrapRect.top + 12;
  if (x + rect.width > wrapRect.width - PAD) x = wrapRect.width - rect.width - PAD;
  if (y + rect.height > wrapRect.height - PAD) y = wrapRect.height - rect.height - PAD;
  if (x < PAD) x = PAD;
  if (y < PAD) y = PAD;
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
}

// ---------------- Portraits ----------------

function syncPortraits(row: HTMLDivElement, world: World): void {
  const stations = world.structures.filter(s => s.kind === 'recharge_station');
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
  }
}

// ---------------- Status helpers ----------------

function structLabel(s: Structure): string {
  switch (s.kind) {
    case 'tidal_generator': return `⚡ Tidal Generator (${s.id})`;
    case 'wind_turbine': return `🔄 Wind Turbine (${s.id})`;
    case 'recharge_station': return s.solar ? `☀️ Recharge Station (${s.id})` : `Recharge Station (${s.id})`;
    case 'intake': return `Water Intake (${s.id})`;
  }
}

function metaFor(s: Structure): string {
  if (s.kind === 'tidal_generator' || s.kind === 'wind_turbine') {
    return `health ${(s.health * 100).toFixed(0)}%  •  fouling ${(s.fouling * 100).toFixed(0)}%`;
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

// Re-export for callers
export type { HoverTarget };
