// usage: node shoot_el.mjs <url> <selector> <out.png> [width] [click selector]
import { chromium } from 'playwright';
const [url, sel, out, w = 1280, click] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: 900 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('page error:', e.message));
await p.goto(url, { waitUntil: 'networkidle' });
if (click) await p.click(click);
await p.waitForTimeout(500);
await p.locator(sel).screenshot({ path: out });
await b.close();
