// Canvas 2D rendering. Reads world state, never mutates it.

import { World } from '../sim/types';

const COLORS = {
  water: '#1a3a4a',
  waterDeep: '#0e2230',
  waveFoam: '#7aa6b5',
  sand: '#c9b687',
  grass: '#5a7d4a',
  grassDark: '#43603a',
  shoreLine: '#8a7e5e',
  brott: '#e8d97a',
  brottLow: '#c87a5a',
  charger: '#5aa37a',
  generator: '#7aa3c8',
  generatorDirty: '#a36e5a',
  intake: '#5a7a8a',
  debris: '#8a7a5a',
};

const TILE = 16;
// Shoreline x in tile-coords. Land is left of this; water is right.
const SHORE_TILE_X = 24;

export function render(ctx: CanvasRenderingContext2D, world: World): void {
  const { width, height } = ctx.canvas;
  const shorePx = SHORE_TILE_X * TILE;

  // --- Water (right side) ---
  // Deep -> shallow gradient (deeper offshore, lighter near shore)
  const waterGrad = ctx.createLinearGradient(shorePx, 0, width, 0);
  waterGrad.addColorStop(0, COLORS.water);
  waterGrad.addColorStop(1, COLORS.waterDeep);
  ctx.fillStyle = waterGrad;
  ctx.fillRect(shorePx, 0, width - shorePx, height);

  // Wave bands offshore (animated by tick)
  ctx.strokeStyle = 'rgba(122, 166, 181, 0.18)';
  ctx.lineWidth = 1;
  const t = world.tick * 0.04;
  for (let row = 0; row < height; row += 18) {
    const phase = Math.sin(t + row * 0.07) * 6;
    ctx.beginPath();
    ctx.moveTo(shorePx + 12, row + phase);
    for (let x = shorePx + 12; x < width; x += 8) {
      const y = row + Math.sin(t + x * 0.05 + row * 0.07) * 3;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // --- Land (left side) ---
  // Base grass
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, shorePx, height);
  // Subtle darker grass tufts for texture
  ctx.fillStyle = COLORS.grassDark;
  for (let i = 0; i < 60; i++) {
    // Stable pseudo-random positions seeded by index (not RNG, just visual texture)
    const gx = (i * 73) % shorePx;
    const gy = (i * 131) % height;
    ctx.fillRect(gx, gy, 2, 2);
  }

  // Sand strip along shore
  ctx.fillStyle = COLORS.sand;
  ctx.fillRect(shorePx - 14, 0, 14, height);

  // Shoreline edge — uneven, slightly wavy
  ctx.fillStyle = COLORS.shoreLine;
  for (let y = 0; y < height; y += 2) {
    const wobble = Math.sin(y * 0.12) * 2 + Math.sin(y * 0.31 + 1.2) * 1.5;
    ctx.fillRect(shorePx + wobble - 1, y, 2, 2);
  }

  // Foam: thin lighter band hugging the shore, with slight tick animation
  for (let y = 0; y < height; y += 1) {
    const wobble = Math.sin(y * 0.12) * 2 + Math.sin(y * 0.31 + 1.2) * 1.5;
    const foamPhase = Math.sin(t * 0.7 + y * 0.18);
    const alpha = 0.20 + foamPhase * 0.10;
    ctx.fillStyle = `rgba(180, 210, 220, ${alpha.toFixed(2)})`;
    ctx.fillRect(shorePx + wobble + 1, y, 3, 1);
  }

  // --- Structures ---
  for (const s of world.structures) {
    const px = s.pos.x * TILE;
    const py = s.pos.y * TILE;
    if (s.kind === 'charger') {
      ctx.fillStyle = COLORS.charger;
      ctx.fillRect(px - 8, py - 8, 16, 16);
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 4, py - 4, 8, 2);
    } else if (s.kind === 'tidal_generator') {
      // Sits at the waterline — straddle the shore with a darker base
      const dirty = s.fouling;
      ctx.fillStyle = '#2a363d';
      ctx.fillRect(px - 12, py - 12, 24, 24);
      ctx.fillStyle = lerpColor(COLORS.generator, COLORS.generatorDirty, dirty);
      ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 10, py + 12, 20, 3);
      ctx.fillStyle = COLORS.generator;
      ctx.fillRect(px - 10, py + 12, 20 * (1 - dirty), 3);
    } else if (s.kind === 'intake') {
      ctx.fillStyle = COLORS.intake;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      // Ripple around intake
      ctx.strokeStyle = 'rgba(180, 210, 220, 0.35)';
      ctx.beginPath();
      ctx.arc(px, py, 10 + Math.sin(t * 1.5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Debris (only renders in water) ---
  ctx.fillStyle = COLORS.debris;
  for (const d of world.debris) {
    const px = d.pos.x * TILE;
    const py = d.pos.y * TILE;
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }

  // --- Brotts ---
  for (const b of world.brotts) {
    const px = b.pos.x * TILE;
    const py = b.pos.y * TILE;
    // Tiny shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px, py + 6, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.fillStyle = b.energy < 0.25 ? COLORS.brottLow : COLORS.brott;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    // Energy bar
    ctx.fillStyle = '#0d1418';
    ctx.fillRect(px - 8, py - 12, 16, 3);
    ctx.fillStyle = COLORS.brott;
    ctx.fillRect(px - 8, py - 12, 16 * b.energy, 3);
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
