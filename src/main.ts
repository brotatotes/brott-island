// Browser entry: wires sim + render at ~60fps with N sim ticks per frame.

import { createWorld, tick } from './sim/world';
import { render, hudText } from './render/scene';
import { initDashboard } from './render/dashboard';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

const seed = Math.floor(Math.random() * 1e9);
const { world, rng, config } = createWorld({ seed });
const dashboard = initDashboard(world);

const mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mouse.x = (e.clientX - rect.left) * scaleX;
  mouse.y = (e.clientY - rect.top) * scaleY;
  mouse.inside = true;
});
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });

const TICKS_PER_FRAME = 1;

function frame(): void {
  for (let i = 0; i < TICKS_PER_FRAME; i++) tick(world, config, rng);
  render(ctx, world, mouse);
  hud.textContent = hudText(world) + `\nseed    ${seed}`;
  dashboard.update();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
