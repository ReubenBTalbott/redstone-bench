// Draw the best build of every run, and every seed and baseline, to renders/<id>.png (transparent background).
// usage: node render_all.mjs   (needs the site served on :7461)
import { chromium } from 'playwright';
import fs from 'fs';
const idx = JSON.parse(fs.readFileSync('data/index.json'));
const ORDER = ['closed', 'extended', 'rest', 'open', 'retracted'];
fs.mkdirSync('renders', { recursive: true });
const jobs = [...idx.runs.filter(r => r.best).map(r => [r.id, `${r.id}/${r.best}`]), ...idx.others.map(o => [o.id, o.id])];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('page error:', e.message));
await p.goto('http://localhost:7461/render.html', { waitUntil: 'networkidle' });
let n = 0;
for (const [id, path] of jobs) {
  const src = `data/builds/${path}.json`, out = `renders/${id}.png`;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) continue;
  const data = JSON.parse(fs.readFileSync(src));
  const state = ORDER.find(s => data.states[s]);
  await p.evaluate((bl) => window.show(bl), data.states[state]);
  await p.waitForTimeout(100);
  await p.locator('#c').screenshot({ path: out, omitBackground: true });
  n++;
}
console.log('rendered', n, 'of', jobs.length);
await b.close();
