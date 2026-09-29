// Screenshots of the console for the README, the cover image and the deck, taken from a running
// build with the scripted Rep (no microphone, no network, no AssemblyAI session).
//
//   node fixtures/scripts/capture-console.mjs <outDir> [baseUrl]
//
// Needs playwright-core resolvable from this file or from PLAYWRIGHT_CORE, and a Chromium binary
// at CHROMIUM (defaults to the Playwright-installed one). Writes:
//   console-idle-dark.png, console-idle-light.png   the holding screen, both themes
//   console-flag-dark.png                            the scripted call paused on the first flag
//   cover-crop.png                                   bands 2 to 4 at that moment, for the cover
//   packet.png                                       the appeal packet
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const out = process.argv[2] ?? 'docs/assets/shots';
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

const theme = (t) => page.evaluate((v) => document.documentElement.setAttribute('data-theme', v), t);

await page.goto(base, { waitUntil: 'networkidle' });
await theme('dark');
await page.screenshot({ path: path.join(out, 'console-idle-dark.png'), fullPage: true });
await theme('light');
await page.screenshot({ path: path.join(out, 'console-idle-light.png'), fullPage: true });
await theme('dark');

// Scripted Mode A at 4x until the first flag lands, then pause on it.
await page.getByRole('button', { name: '4x' }).click();
await page.getByRole('button', { name: 'Start call' }).click();
await page.locator('.w-banner[role="alert"]').waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: 'Pause' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'console-flag-dark.png'), fullPage: true });

// The cover crop: from the top of the flag lane to the bottom of the live-call stage.
const top = await page.locator('.w-flaglane').boundingBox();
const bottom = await page.locator('.w-stage').boundingBox();
if (top && bottom) {
  await page.screenshot({
    path: path.join(out, 'cover-crop.png'),
    fullPage: true,
    clip: { x: 0, y: top.y, width: 1600, height: bottom.y + bottom.height - top.y },
  });
}

// Frames for the README animation: the whole scripted call at 4x, one frame every 700 ms.
await page.getByRole('button', { name: 'Reset' }).click();
await page.getByRole('button', { name: 'Start call' }).click();
const frames = path.join(out, 'frames');
mkdirSync(frames, { recursive: true });
for (let i = 0; i < 40; i += 1) {
  await page.screenshot({ path: path.join(frames, `f${String(i).padStart(2, '0')}.png`), fullPage: true, scale: 'css' });
  await page.waitForTimeout(700);
}

await page.goto(`${base}/packet`, { waitUntil: 'networkidle' });
await theme('light');
await page.screenshot({ path: path.join(out, 'packet.png'), fullPage: true });

await browser.close();
console.log(`wrote screenshots to ${out}`);
