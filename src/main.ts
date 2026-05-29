// Browser entry: wires sim + render at ~60fps with N sim ticks per frame.

import { createWorld, tick } from './sim/world';
import { render } from './render/scene';
import { initDashboard } from './render/dashboard';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
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

// Click → popover inspector
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  dashboard.openPopoverAt(cx, cy, e.clientX, e.clientY);
});

// Click outside canvas / popover closes
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (!t) return;
  if (t === canvas) return;
  if (t.closest('#popover')) return;
  dashboard.closePopover();
});

const TICKS_PER_FRAME = 1;

function frame(): void {
  for (let i = 0; i < TICKS_PER_FRAME; i++) tick(world, config, rng);
  render(ctx, world, mouse, config);
  dashboard.update();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
