// Canvas 2D rendering. Reads world state, never mutates it.

import { World } from '../sim/types';

const COLORS = {
  water: '#1a2228',
  shore: '#2a3a3f',
  brott: '#e8d97a',
  brottLow: '#c87a5a',
  charger: '#5aa37a',
  generator: '#7aa3c8',
  generatorDirty: '#a36e5a',
  intake: '#5a7a8a',
  debris: '#8a7a5a',
  text: '#cfd8d3',
};

const TILE = 16;

export function render(ctx: CanvasRenderingContext2D, world: World): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = COLORS.water;
  ctx.fillRect(0, 0, width, height);

  // Shore band (illustrative — represents the island edge)
  ctx.fillStyle = COLORS.shore;
  ctx.fillRect(0, 0, TILE * 26, height);

  // Structures
  for (const s of world.structures) {
    const px = s.pos.x * TILE;
    const py = s.pos.y * TILE;
    if (s.kind === 'charger') {
      ctx.fillStyle = COLORS.charger;
      ctx.fillRect(px - 8, py - 8, 16, 16);
    } else if (s.kind === 'tidal_generator') {
      const dirty = s.fouling;
      ctx.fillStyle = lerpColor(COLORS.generator, COLORS.generatorDirty, dirty);
      ctx.fillRect(px - 10, py - 10, 20, 20);
      // health/fouling bar
      ctx.fillStyle = '#0d1418';
      ctx.fillRect(px - 10, py + 12, 20, 3);
      ctx.fillStyle = COLORS.generator;
      ctx.fillRect(px - 10, py + 12, 20 * (1 - dirty), 3);
    } else if (s.kind === 'intake') {
      ctx.fillStyle = COLORS.intake;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
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
    ctx.fillStyle = b.energy < 0.25 ? COLORS.brottLow : COLORS.brott;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    // energy bar
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
