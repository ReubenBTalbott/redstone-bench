// Drives the explorer in a headless browser and saves screenshots. usage: node test_explorer.mjs <task> <outdir>
import { chromium } from 'playwright';
const [task = 'door_2x2', out = '.'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:7461/index.html#${task}`, { waitUntil: 'networkidle' });
await p.waitForSelector('#dv[data-ready="1"]');
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/x1-open.png` });
const seg = p.locator('#seg button');
if (await seg.count()) {
  await seg.first().click();
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${out}/x2-moving.png` });
  await p.waitForFunction(() => document.getElementById('play').textContent !== 'Pause', null, { timeout: 30000 });
  await p.screenshot({ path: `${out}/x3-closed.png` });
  console.log('tick label after move:', await p.locator('#tick').textContent());
} else {
  await p.locator('#play').click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/x2-moving.png` });
}
await p.locator('#xmode button[data-m="tries"]').click();
const pts = p.locator('#chart circle[style*="pointer"]');
console.log('chart points:', await pts.count(), 'runs listed:', await p.locator('#runs li').count());
if (await pts.count()) { await pts.first().click({ force: true }); await p.waitForTimeout(600); console.log('caption:', await p.locator('#cap').textContent()); }
await p.screenshot({ path: `${out}/x4-tries.png` });
await p.setViewportSize({ width: 390, height: 800 });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/x5-phone.png` });
console.log('errors:', errs);
await b.close();
