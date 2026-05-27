// Dashboard DOM updater. Reads world state, mutates only the dashboard DOM and
// (via callbacks) world entity names. Keeps the sim DOM-free.

import { World, Brott, Structure, Job } from '../sim/types';
import { buildTidalGenerator, TIDAL_GENERATOR_COST, MAX_TIDAL_GENERATORS, buildBrott, BROTT_COST, MAX_BROTTS } from '../sim/world';
import { DEFAULT_CONFIG } from '../sim/types';

export interface DashboardCallbacks {
  onBuildGenerator?: (newId: string) => void;
  onBuildBrott?: (newId: string) => void;
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
  // Metric fields
  const elTick = document.getElementById('m-tick')!;
  const elPhase = document.getElementById('m-phase')!;
  const elPower = document.getElementById('m-power')!;
  const elDelivered = document.getElementById('m-delivered')!;
  const elSalvage = document.getElementById('m-salvage')!;
  const elFouling = document.getElementById('m-fouling')!;
  const elEnergy = document.getElementById('m-energy')!;
  const elTask = document.getElementById('m-task')!;

  const brottList = document.getElementById('brott-list') as HTMLUListElement;
  const structList = document.getElementById('struct-list') as HTMLUListElement;

  const buildBtn = document.getElementById('build-gen') as HTMLButtonElement;
  const buildHint = document.getElementById('build-hint')!;
  const buildBrottBtn = document.getElementById('build-brott') as HTMLButtonElement;
  const buildBrottHint = document.getElementById('build-brott-hint')!;
  const log = document.getElementById('event-log') as HTMLDivElement;

  let buildCount = 0;
  buildBtn.addEventListener('click', () => {
    const newId = buildTidalGenerator(world);
    if (newId) {
      buildCount += 1;
      const n = world.structures.filter(s => s.kind === 'tidal_generator').length;
      pushLog(log, `Built tidal generator #${n}`);
      callbacks.onBuildGenerator?.(newId);
    }
  });
  buildBrottBtn.addEventListener('click', () => {
    const newId = buildBrott(world);
    if (newId) {
      const b = world.brotts.find(x => x.id === newId);
      pushLog(log, `Built ${b?.name ?? newId}`);
      callbacks.onBuildBrott?.(newId);
    }
  });

  const brottRows = new Map<string, RowCache>();
  const structRows = new Map<string, StructRowCache>();

  function update(): void {
    // Metrics
    elTick.textContent = String(world.tick);
    elPhase.textContent = world.phase;
    const cap = DEFAULT_CONFIG.batteryCapacity;
    const stored = world.inventory.power ?? 0;
    elPower.textContent = `${stored.toFixed(0)} / ${cap} kWh`;
    elDelivered.textContent = `${world.metrics.totalPowerDelivered.toFixed(0)} kWh`;
    elSalvage.textContent = String(world.inventory.salvage ?? 0);

    const gens = world.structures.filter(s => s.kind === 'tidal_generator');
    const avgFouling = gens.length > 0
      ? gens.reduce((a, g) => a + g.fouling, 0) / gens.length
      : 0;
    elFouling.textContent = `${(avgFouling * 100).toFixed(0)}%`;

    const b0 = world.brotts[0];
    elEnergy.textContent = b0 ? `${(b0.energy * 100).toFixed(0)}%` : '—';
    elTask.textContent = b0 ? b0.task.kind : '—';

    // Brott rows
    syncBrottRows(brottList, world.brotts, brottRows);

    // Structure rows
    syncStructureRows(structList, world.structures, structRows);

    // Build button
    const recovery = world.phase === 'recovery';
    const gensCount = world.structures.filter(s => s.kind === 'tidal_generator').length;
    const slotsFull = gensCount >= MAX_TIDAL_GENERATORS;
    const canAfford = (world.inventory.salvage ?? 0) >= TIDAL_GENERATOR_COST;
    buildBtn.disabled = recovery || !canAfford || slotsFull;
    if (recovery) {
      buildHint.textContent = `Phase 1: complete recovery first.`;
    } else if (slotsFull) {
      buildHint.textContent = `All generator slots full (${MAX_TIDAL_GENERATORS})`;
    } else if (canAfford) {
      buildHint.textContent = `Ready to build (cost ${TIDAL_GENERATOR_COST} salvage)`;
    } else {
      const need = TIDAL_GENERATOR_COST - (world.inventory.salvage ?? 0);
      buildHint.textContent = `Need ${need} more salvage`;
    }

    // Build Brott button
    const brottsCount = world.brotts.length;
    const brottsFull = brottsCount >= MAX_BROTTS;
    const canAffordBrott = (world.inventory.salvage ?? 0) >= BROTT_COST;
    buildBrottBtn.disabled = recovery || !canAffordBrott || brottsFull;
    if (recovery) {
      buildBrottHint.textContent = `Phase 1: complete recovery first.`;
    } else if (brottsFull) {
      buildBrottHint.textContent = `All Brott slots full (${MAX_BROTTS})`;
    } else if (canAffordBrott) {
      buildBrottHint.textContent = `Ready to build (cost ${BROTT_COST} salvage)`;
    } else {
      const needB = BROTT_COST - (world.inventory.salvage ?? 0);
      buildBrottHint.textContent = `Need ${needB} more salvage`;
    }
  }

  return { update };
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
    // Update text only if not currently being edited
    if (!row.nameEl.classList.contains('editing')) {
      if (row.nameEl.textContent !== b.name) row.nameEl.textContent = b.name;
    }
    row.metaEl.textContent = `${(b.energy * 100).toFixed(0)}%  ${b.task.kind}`;
    if (row.jobEl.value !== b.job) row.jobEl.value = b.job;
  }
  // Remove rows for departed brotts
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

  // Active Jobs dropdown
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
    if (save && next.length > 0) {
      brott.name = next;
    }
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
    row.metaEl.textContent = `tier ${s.tier}`;
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
    case 'tidal_generator': return `Tidal Generator (${s.id})`;
    case 'charger': return `Charger (${s.id})`;
    case 'intake': return `Water Intake (${s.id})`;
  }
}

function statusFor(s: Structure): string {
  if (s.health < 0.8) return 'Broken';
  if (s.kind === 'tidal_generator') {
    if (s.fouling >= 0.5) return 'Fouled';
    return 'Active';
  }
  if (s.kind === 'charger') return 'Active';
  if (s.kind === 'intake') return 'Idle';
  return 'Idle';
}

function pushLog(log: HTMLDivElement, msg: string): void {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  log.appendChild(line);
  // Cap at 8 lines
  while (log.childNodes.length > 8) log.removeChild(log.firstChild!);
  log.scrollTop = log.scrollHeight;
}
