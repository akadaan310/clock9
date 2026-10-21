// Real Chromium check of web/index.html: symbolic core runs in-page with no network beyond
// same-origin static files; screenshots at phone and desktop widths.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end(); }
}).listen(8765);
const browser = await chromium.launch();
const out = {};
for (const [name, vp] of [['mobile', { width: 375, height: 812 }], ['desktop', { width: 1280, height: 900 }]]) {
  const page = await browser.newPage({ viewport: vp });
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8765/web/index.html');
  await page.waitForFunction(() => document.body.dataset.done && document.body.dataset.text, null, { timeout: 15000 });
  const status = await page.textContent('#status');
  const beats = await page.$$eval('#beats li', l => l.map(x => x.textContent));
  const code = await page.textContent('#code');
  const text = await page.textContent('#text');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  // refusal path
  await page.fill('#req', 'Return True if xs reads the same forwards and backwards.');
  await page.fill('#sig', 'def solve(xs: list[int]) -> bool:');
  await page.fill('#ex', '[[[1,2,1],true],[[1,2],false]]');
  await page.click('#go');
  await page.waitForTimeout(300);
  const refusal = await page.textContent('#status');
  await page.fill('#req', 'Given a list of integers xs, keep only the even numbers, then square each number, and return the sum.');
  await page.fill('#sig', 'def solve(xs: list[int]) -> int:');
  await page.fill('#ex', '[[[1,2,3,4],20],[[6,-2],40]]');
  await page.click('#go'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'results', 'browser', `${name}.png`), fullPage: true });
  out[name] = { status, beats, code, text: text.slice(0, 300), refusal, horizontalOverflow: overflow, errors, offOrigin: requests.filter(u => !u.startsWith('http://127.0.0.1:8765/')) , requests: requests.length };
}
await browser.close(); server.close();
await (await import('node:fs/promises')).writeFile(path.join(root, 'results', 'browser', 'browser-check.json'), JSON.stringify({ chromium: 'playwright 1.56.1 bundled chromium (/opt/pw-browsers)', ...out }, null, 1));
console.log(JSON.stringify(out, null, 1));
