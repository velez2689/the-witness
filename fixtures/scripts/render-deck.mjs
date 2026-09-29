// Print docs/submission/deck.html to docs/submission/deck.pdf, one 1920x1080 page per slide.
//   PLAYWRIGHT_CORE=<path to playwright-core> node fixtures/scripts/render-deck.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const html = path.resolve('docs/submission/deck.html');
const pdf = path.resolve('docs/submission/deck.pdf');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`wrote ${pdf}`);
