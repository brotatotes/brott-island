// Canvas 2D rendering. Reads world state, never mutates it.

import { World, Brott, Structure, Debris, Vec2 } from '../sim/types';

const COLORS = {
  water: '#1a3a4a',
  waterDeep: '#0e2230',
  sand: '#c9b687',
  grass: '#5a7d4a',
  grassDark: '#43603a',
  shoreLine: '#8a7e5e',
  brott: '#e8d97a',
  brottLow: '#c87a5a',
  charger: '#5aa37a',
  generator: '#7aa3c8',
  generatorDirty: '#a36e5a',
  windTurbine: '#cfd8d3',
  windTurbineBlade: '#e8d97a',
  windTurbineDirty: '#a36e5a',
  intake: '#5a7a8a',
  debris: '#8a7a5a',
};

const TILE = 16;
const SHORE_TILE_X = 24;

// Hit target for hover detection. Records what's at a screen position.
export type HoverTarget =
  | { kind: 'brott'; ref: Brott }
  | { kind: 'structure'; ref: Structure }
  | { kind: 'debris'; ref: Debris };

export function hitTest(world: World, px: number, py: number): HoverTarget | null {
  // Brotts first (drawn on top, most expected hover target)
  for (const b of world.brotts) {
    if (within(b.pos, px, py, 7)) return { kind: 'brott', ref: b };
  }
  for (const s of world.structures) {
    const r = s.kind === 'intake' ? 8 : s.kind === 'charger' ? 10 : s.kind === 'wind_turbine' ? 10 : 12;
    if (within(s.pos, px, py, r)) return { kind: 'structure', ref: s };
  }
  for (const d of world.debris) {
    if (within(d.pos, px, py, 5)) return { kind: 'debris', ref: d };
  }
  return null;
}

function within(tilePos: Vec2, px: number, py: number, radiusPx: number): boolean {
  const cx = tilePos.x * TILE;
  const cy = tilePos.y * TILE;
  return Math.hypot(cx - px, cy - py) <= radiusPx;
}

export function tooltipFor(target: HoverTarget, world: World): string[] {
  switch (target.kind) {
    case 'brott': {
      const b = target.ref;
      return [
        b.name,
        `energy   ${(b.energy * 100).toFixed(0)}%`,
        `task     ${b.task.kind}`,
        `can do   ${b.capabilities.join(', ')}`,
      ];
    }
    case 'structure': {
      const s = target.ref;
      if (s.kind === 'tidal_generator') {
        const out = s.outputBase * (1 - s.fouling) * s.health;
        return [
          `Tidal Generator (${s.id})`,
          `output   ${out.toFixed(0)} / ${s.outputBase} kW`,
          `fouling  ${(s.fouling * 100).toFixed(0)}%`,
          `health   ${(s.health * 100).toFixed(0)}%`,
          `tier     ${s.tier}`,
        ];
      }
      if (s.kind === 'wind_turbine') {
        // Read live wind from world.tick (purely cosmetic; sim is authoritative).
        const TWO_PI = Math.PI * 2;
        const slow = Math.sin((world.tick / 700) * TWO_PI);
        const fast = Math.sin((world.tick / 137) * TWO_PI + 1.3);
        let wind = 0.5 + 0.3 * slow + 0.2 * fast;
        if (wind < 0.1) wind = 0.1; if (wind > 1) wind = 1;
        const out = s.outputBase * (1 - s.fouling) * s.health * wind;
        return [
          `Wind Turbine (${s.id})`,
          `output   ${out.toFixed(0)} / ${s.outputBase} kW`,
          `wind     ${(wind * 100).toFixed(0)}%`,
          `fouling  ${(s.fouling * 100).toFixed(0)}%`,
          `health   ${(s.health * 100).toFixed(0)}%`,
          `tier     ${s.tier}`,
        ];
      }
      if (s.kind === 'charger') {
        return [
          `Charger (${s.id})`,
          `Brotts return here to refill energy.`,
        ];
      }
      if (s.kind === 'intake') {
        const debrisCount = world.debris.length;
        return [
          `Water Intake (${s.id})`,
          `Debris washes up here.`,
          `current   ${debrisCount} piece${debrisCount === 1 ? '' : 's'}`,
        ];
      }
      return [s.kind];
    }
    case 'debris': {
      return [
        `Debris`,
        `Driftwood and kelp.`,
        `yields    +1 salvage when collected`,
      ];
    }
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  mouse: { x: number; y: number; inside: boolean } | null,
): void {
  const { width, height } = ctx.canvas;
  const shorePx = SHORE_TILE_X * TILE;

  // Water
  const waterGrad = ctx.createLinearGradient(shorePx, 0, width, 0);
  waterGrad.addColorStop(0, COLORS.water);
  waterGrad.addColorStop(1, COLORS.waterDeep);
  ctx.fillStyle = waterGrad;
  ctx.fillRect(shorePx, 0, width - shorePx, height);

  ctx.strokeStyle = 'rgba(122, 166, 181, 0.18)';
  ctx.lineWidth = 1;
  const t = world.tick * 0.04;
  for (let row = 0; row < height; row += 18) {
    ctx.beginPath();
    const phase0 = Math.sin(t + row * 0.07) * 6;
    ctx.moveTo(shorePx + 12, row + phase0);
    for (let x = shorePx + 12; x < width; x += 8) {
      const y = row + Math.sin(t + x * 0.05 + row * 0.07) * 3;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Land
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, shorePx, height);
  ctx.fillStyle = COLORS.grassDark;
  for (let i = 0; i < 60; i++) {
    const gx = (i * 73) % shorePx;
    const gy = (i * 131) % height;
    ctx.fillRect(gx, gy, 2, 2);
  }

  // Sand strip
  ctx.fillStyle = COLORS.sand;
  ctx.fillRect(shorePx - 14, 0, 14, height);

  // Shoreline
  ctx.fillStyle = COLORS.shoreLine;
  for (let y = 0; y < height; y += 2) {
    const wobble = Math.sin(y * 0.12) * 2 + Math.sin(y * 0.31 + 1.2) * 1.5;
    ctx.fillRect(shorePx + wobble - 1, y, 2, 2);
  }

  // Foam
  for (let y = 0; y < height; y += 1) {
    const wobble = Math.sin(y * 0.12) * 2 + Math.sin(y * 0.31 + 1.2) * 1.5;
    const foamPhase = Math.sin(t * 0.7 + y * 0.18);
    const alpha = 0.20 + foamPhase * 0.10;
    ctx.fillStyle = `rgba(180, 210, 220, ${alpha.toFixed(2)})`;
    ctx.fillRect(shorePx + wobble + 1, y, 3, 1);
  }

  // Structures
  for (const s of world.structures) {
    const px = s.pos.x * TILE;
    const py = s.pos.y * TILE;
    const broken = s.health < 0.8;
    if (broken) ctx.globalAlpha = 0.45;
    if (s.kind === 'charger') {
      ctx.fillStyle = COLORS.charger;
      ctx.fillRect(px - 8, py - 8, 16, 16);
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 4, py - 4, 8, 2);
    } else if (s.kind === 'tidal_generator') {
      const dirty = s.fouling;
      ctx.fillStyle = '#2a363d';
      ctx.fillRect(px - 12, py - 12, 24, 24);
      ctx.fillStyle = lerpColor(COLORS.generator, COLORS.generatorDirty, dirty);
      ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 10, py + 12, 20, 3);
      ctx.fillStyle = COLORS.generator;
      ctx.fillRect(px - 10, py + 12, 20 * (1 - dirty), 3);
    } else if (s.kind === 'wind_turbine') {
      // Tower
      ctx.fillStyle = '#3a4651';
      ctx.fillRect(px - 2, py - 4, 4, 16);
      // Hub
      const dirty = s.fouling;
      ctx.fillStyle = lerpColor(COLORS.windTurbine, COLORS.windTurbineDirty, dirty);
      ctx.beginPath();
      ctx.arc(px, py - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      // Blades — spin speed driven by current wind factor
      const TWO_PI = Math.PI * 2;
      const slow = Math.sin((world.tick / 700) * TWO_PI);
      const fast = Math.sin((world.tick / 137) * TWO_PI + 1.3);
      let wind = 0.5 + 0.3 * slow + 0.2 * fast;
      if (wind < 0.1) wind = 0.1; if (wind > 1) wind = 1;
      const ang = world.tick * 0.25 * wind;
      ctx.strokeStyle = lerpColor(COLORS.windTurbineBlade, COLORS.windTurbineDirty, dirty);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = ang + (i * TWO_PI) / 3;
        ctx.beginPath();
        ctx.moveTo(px, py - 4);
        ctx.lineTo(px + Math.cos(a) * 9, py - 4 + Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      // Output bar at base
      const eff = (1 - dirty) * s.health * wind;
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 10, py + 12, 20, 3);
      ctx.fillStyle = COLORS.windTurbineBlade;
      ctx.fillRect(px - 10, py + 12, 20 * eff, 3);
    } else if (s.kind === 'intake') {
      ctx.fillStyle = COLORS.intake;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 210, 220, 0.35)';
      ctx.beginPath();
      ctx.arc(px, py, 10 + Math.sin(t * 1.5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (broken) {
      ctx.globalAlpha = 1;
      // Small red broken indicator (X)
      ctx.strokeStyle = '#c85a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 6, py - 14); ctx.lineTo(px + 12, py - 8);
      ctx.moveTo(px + 12, py - 14); ctx.lineTo(px + 6, py - 8);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // Debris
  ctx.fillStyle = COLORS.debris;
  for (const d of world.debris) {
    const px = d.pos.x * TILE;
    const py = d.pos.y * TILE;
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }

  // Brotts
  for (const b of world.brotts) {
    const px = b.pos.x * TILE;
    const py = b.pos.y * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px, py + 6, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.energy < 0.25 ? COLORS.brottLow : COLORS.brott;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d1418';
    ctx.fillRect(px - 8, py - 12, 16, 3);
    ctx.fillStyle = COLORS.brott;
    ctx.fillRect(px - 8, py - 12, 16 * b.energy, 3);
  }

  // --- Hover ring + tooltip ---
  if (mouse && mouse.inside) {
    const hit = hitTest(world, mouse.x, mouse.y);
    if (hit) {
      const pos =
        hit.kind === 'brott' ? hit.ref.pos :
        hit.kind === 'structure' ? hit.ref.pos :
        hit.ref.pos;
      const cx = pos.x * TILE;
      const cy = pos.y * TILE;
      // Highlight ring
      ctx.strokeStyle = 'rgba(232, 217, 122, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();
      // Tooltip
      drawTooltip(ctx, mouse.x + 12, mouse.y + 12, tooltipFor(hit, world), width, height);
    }
  }
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lines: string[],
  canvasW: number,
  canvasH: number,
): void {
  ctx.font = '11px ui-monospace, monospace';
  const padX = 8;
  const padY = 6;
  const lineH = 14;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
  const h = lines.length * lineH + padY * 2;
  // Keep on screen
  if (x + w > canvasW - 4) x = canvasW - w - 4;
  if (y + h > canvasH - 4) y = canvasH - h - 4;
  if (x < 4) x = 4;
  if (y < 4) y = 4;

  ctx.fillStyle = 'rgba(13, 20, 24, 0.92)';
  ctx.strokeStyle = 'rgba(138, 163, 155, 0.6)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.fillStyle = '#cfd8d3';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    // Title (first line) in a brighter color
    ctx.fillStyle = i === 0 ? '#e8d97a' : '#cfd8d3';
    ctx.fillText(lines[i], x + padX, y + padY + i * lineH);
  }
}

export function hudText(world: World): string {
  const gen = world.structures.find(s => s.kind === 'tidal_generator');
  const brott = world.brotts[0];
  const lines = [
    `tick    ${world.tick}`,
    `power   ${world.inventory.power.toFixed(0)} kWh`,
    `salvage ${world.inventory.salvage ?? 0}`,
    `debris  ${world.debris.length} on intake`,
    gen ? `tidal-1 fouling ${(gen.fouling * 100).toFixed(0)}%  out ${(gen.outputBase * (1 - gen.fouling) * gen.health).toFixed(0)} kW` : '',
    brott ? `${brott.name}  energy ${(brott.energy * 100).toFixed(0)}%  task ${brott.task.kind}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}
