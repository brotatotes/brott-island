// Browser entry: wires sim + render at ~60fps with N sim ticks per frame.

import { createWorld, tick } from './sim/world';
import { render, hudText } from './render/scene';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

const seed = Math.floor(Math.random() * 1e9);
const { world, rng, config } = createWorld({ seed });

const TICKS_PER_FRAME = 1;

function frame(): void {
  for (let i = 0; i < TICKS_PER_FRAME; i++) tick(world, config, rng);
  render(ctx, world);
  hud.textContent = hudText(world) + `\nseed    ${seed}`;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
