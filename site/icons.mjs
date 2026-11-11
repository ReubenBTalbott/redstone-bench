// usage: node icons.mjs   -> favicon-32.png, apple-touch-icon.png, icon-192.png from favicon.svg
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const svg = readFileSync(new URL('favicon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
for (const [name, n, pad] of [['favicon-32.png', 32, 0], ['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 0]]) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.setContent(`<body style="margin:0;background:${pad ? '#cfe8fb' : 'transparent'}">${svg.replace('<svg ', `<svg width="${n}" height="${n}" `)}</body>`);
  await p.screenshot({ path: new URL(name, import.meta.url).pathname, omitBackground: !pad });
  await p.close();
}
await b.close();
