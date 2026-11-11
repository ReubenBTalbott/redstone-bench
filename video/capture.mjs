// usage: node capture.mjs <clip> ...   -> film/public/footage/<clip>/0000.png ... (transparent PNG frames of real builds)
// Drives site/capture.html (the site's own 3D viewer) headless, one frame at a time, so the film is frame exact.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
const require = createRequire(new URL('../site/', import.meta.url));
const { chromium } = require('playwright');
const OUT = new URL('./film/public/footage/', import.meta.url).pathname;
const idx = JSON.parse(readFileSync(new URL('../site/data/index.json', import.meta.url)));
const run = (id) => idx.runs.find((r) => r.id === id);
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const lerp = (a, b, t) => a + (b - a) * t;

const DOOR = 'astra-ultra__door_3x3';
const WALL = ['sol-ultra__mech_extender3', 'sol-ultra__logic_adder2', 'astra-ultra__logic_full_adder', 'carbon-high__mech_extender2',
  'astra-max__logic_xor', 'carbon-high__time_pulse30', 'astra-high__mem_counter2', 'astra-high__door_2x2'];
const CLIPS = {
  // the door assembles block by block (131 f), then runs: lever on, closed, lever off, open (131 f); one slow camera move
  door: { w: 1500, h: 1080, n: 262, async frame(p, f, st) {
    const path = `${DOOR}/${run(DOOR).best}`; st.m ||= await p.evaluate((x) => load(x, 6), path);
    const yaw = lerp(1.25, 0.55, ease(f / 262)), pitch = lerp(0.42, 0.3, ease(f / 262));
    if (f < 131) return { path, i: 0, limit: Math.round(st.m.blocks * ease(f / 112) ** 1.15), yaw, pitch, zoom: 0.92 };
    return { path, i: Math.round((f - 131) * (st.m.n - 1) / 126), yaw, pitch, zoom: 0.92 };
  } },
  // the same run's working versions, biggest to smallest, on one fixed stage so the shrink is real scale
  shrink: { w: 1500, h: 1080, n: 131, async frame(p, f, st) {
    if (!st.v) { const r = run(DOOR); let best = Infinity; st.v = [];
      for (const [n, x] of Object.entries(r.versions).sort((a, b) => a[0] - b[0])) if (x.volume < best) { best = x.volume; st.v.push({ n, volume: x.volume }); }
      for (const x of st.v) { x.path = `${DOOR}/${x.n}`; x.m = await p.evaluate((y) => load(y), x.path); x.size = x.m.bounds[1].map((h, i) => h - x.m.bounds[0][i] + 1); }
      st.big = [0, 1, 2].map((i) => Math.max(...st.v.map((x) => x.size[i])));
      writeFileSync(OUT + 'shrink.json', JSON.stringify(st.v.map((x, k) => ({ volume: x.volume, at: Math.round(k * 112 / (st.v.length - 1)) }))));
    }
    const k = Math.min(st.v.length - 1, Math.floor(f / (112 / (st.v.length - 1)) + 0.0001)), x = st.v[k];
    const shift = [0, 1, 2].map((i) => (i === 1 ? 0 : Math.floor((st.big[i] - x.size[i]) / 2)) - x.m.bounds[0][i]);
    return { path: x.path, state: x.m.states.includes('closed') ? 'closed' : x.m.states[0], shift, bounds: [[0, 0, 0], st.big.map((b) => b - 1)], yaw: lerp(0.9, 0.5, f / 131), pitch: 0.38, zoom: 0.95 };
  } },
  ...Object.fromEntries(WALL.map((id, k) => [`wall${k}`, { w: 640, h: 540, n: 131, async frame(p, f, st) {
    const path = `${id}/${run(id).best}`; st.m ||= await p.evaluate((x) => load(x, 5), path);
    return { path, i: (f + k * 7) % st.m.n, yaw: 0.7 + 0.0025 * f + k * 0.4, pitch: 0.42, zoom: 0.76 };
  } }])),
  // the finished door, closed, for the first frame and the end card
  hero: { w: 1500, h: 1080, n: 1, async frame(p, f, st) { const path = `${DOOR}/${run(DOOR).best}`; await p.evaluate((x) => load(x, 6), path); return { path, state: 'closed', yaw: 0.55, pitch: 0.3, zoom: 0.92 }; } },
};

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const name of process.argv.slice(2)) {
  const c = CLIPS[name], st = {}, t0 = Date.now();
  mkdirSync(OUT + name, { recursive: true });
  const p = await b.newPage({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('page error:', e.message));
  await p.goto(`http://127.0.0.1:7461/capture.html?w=${c.w}&h=${c.h}`, { waitUntil: 'networkidle' });
  for (let f = 0; f < c.n; f++) {
    const o = await c.frame(p, f, st), url = await p.evaluate((x) => shot(x), o);
    writeFileSync(`${OUT}${name}/${String(f).padStart(4, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  await p.close();
  console.log(name, c.n, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await b.close();
