// usage: node shoot.mjs <url> <out.png> [width] [height] [fullPage]
import { chromium } from 'playwright';
const [url, out, w = 900, h = 700, full] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
p.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
p.on('pageerror', e => console.log('page error:', e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForSelector('canvas[data-ready="1"]', { timeout: 20000 }).catch(() => console.log('no ready canvas'));
await p.waitForTimeout(600);
await p.screenshot({ path: out, fullPage: !!full });
await b.close();
