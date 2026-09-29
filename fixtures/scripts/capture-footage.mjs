// Picture track for the demo video: deck slides and a stepped run of the real console, one beat
// per line of docs/submission/narration.md, with the line shown as a caption.
//
//   PLAYWRIGHT_CORE=<path> node fixtures/scripts/capture-footage.mjs <outDir> [baseUrl] [narrationDir]
//
// Each beat is held for the length of its narration audio when <narrationDir>/index.json exists
// (written by render-narration.mjs), otherwise for an estimate from the word count. Writes
// numbered PNG frames at 2 frames per second into <outDir>/frames and <outDir>/beats.json with
// each beat's start and length, which mux-narration.mjs uses to lay the audio. Scripted Rep, no
// network, no microphone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const out = process.argv[2] ?? 'docs/assets/footage';
const base = process.argv[3] ?? 'http://localhost:3000';
const narrationDir = process.argv[4] ?? 'docs/assets/narration';
const FPS = 2;
mkdirSync(path.join(out, 'frames'), { recursive: true });

const lines = readFileSync('docs/submission/narration.md', 'utf8')
  .split('\n')
  .map((l) => /^(\d+)\.\s+(.*)$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
const indexPath = path.join(narrationDir, 'index.json');
const rendered = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
const secondsFor = (n) => {
  const r = rendered.find((x) => x.n === n);
  if (r) return r.seconds + 0.6;
  const words = lines.find((x) => x.n === n)?.text.split(/\s+/).length ?? 10;
  return Math.max(2.5, words / 2.6);
};
const textFor = (n) => lines.find((x) => x.n === n)?.text ?? '';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

let n = 0;
const beats = [];
async function hold(seconds) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < frames; i += 1) {
    await page.screenshot({ path: path.join(out, 'frames', `f${String(n).padStart(5, '0')}.png`), scale: 'css' });
    n += 1;
    await page.waitForTimeout(1000 / FPS);
  }
}
/** One narration line: caption it, hold for its audio, record where it started. */
async function beat(lineNo) {
  const start = n / FPS;
  const seconds = secondsFor(lineNo);
  await caption(textFor(lineNo));
  await hold(seconds);
  beats.push({ n: lineNo, startSeconds: Number(start.toFixed(2)), seconds: Number((n / FPS - start).toFixed(2)) });
}

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('narration');
    if (!el) {
      el = document.createElement('div');
      el.id = 'narration';
      Object.assign(el.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999',
        padding: '20px 48px', background: 'rgba(11,13,15,0.92)', color: '#e7e4dc',
        font: '600 28px/1.35 "Segoe UI", system-ui, sans-serif', borderTop: '2px solid #6fb1ff',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.display = t ? 'block' : 'none';
  }, text);
}

async function scrollTo(selector, offset = -16) {
  await page.evaluate(({ s, o }) => {
    const el = document.querySelector(s);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + o });
  }, { s: selector, o: offset });
  await page.waitForTimeout(250);
}

async function showSlide(index) {
  await page.goto(pathToFileURL(path.resolve('docs/submission/deck.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate((i) => {
    document.querySelectorAll('section').forEach((s, k) => { s.style.display = k === i - 1 ? 'block' : 'none'; });
    // The caption bar covers the bottom of the frame; lift the slide's source line and page number above it.
    document.querySelectorAll('section .src, section .n').forEach((el) => { el.style.bottom = '176px'; });
    document.querySelectorAll('section .src').forEach((el) => { el.style.right = '300px'; });
    window.scrollTo(0, 0);
  }, index);
}

const theme = (t) => page.evaluate((v) => document.documentElement.setAttribute('data-theme', v), t);

// 1 to 2: who is speaking, and the problem.
await showSlide(1);
await beat(1);
await showSlide(2);
await beat(2);

// 3: the console before the call.
await page.goto(base, { waitUntil: 'networkidle' });
await theme('dark');
await scrollTo('.w-flaglane');
await beat(3);

// 4 to 25: the call, one Step per line, the flag lane kept at the top of the frame.
await page.getByRole('button', { name: 'Start call' }).click();
await page.getByRole('button', { name: 'Pause' }).click();
for (let lineNo = 4; lineNo <= 25; lineNo += 1) {
  await page.getByRole('button', { name: 'Step' }).click().catch(() => undefined);
  await page.waitForTimeout(300);
  await scrollTo('.w-flaglane');
  await beat(lineNo);
}
await page.getByRole('button', { name: 'Resume' }).click().catch(() => undefined);
await page.locator('.w-update').waitFor({ timeout: 60_000 }).catch(() => undefined);
await page.waitForTimeout(500);

// 26 to 27: the lower panels and the update sheet.
await scrollTo('.w-lower');
await beat(26);
await scrollTo('.w-update');
await beat(27);

// 28 to 30: Whisper mode on the same claim, the biller speaks and the Witness whispers.
await page.goto(base, { waitUntil: 'networkidle' });
await theme('dark');
await page.getByRole('button', { name: 'Whisper: I speak' }).click();
await page.getByRole('button', { name: 'Start call' }).click();
await page.getByRole('button', { name: 'Pause' }).click();
const whispers = () => page.locator('.w-line.whisper').count();
const stepUntil = async (pred, max) => {
  for (let k = 0; k < max && !(await pred()); k += 1) {
    await page.getByRole('button', { name: 'Step' }).click().catch(() => undefined);
    await page.waitForTimeout(250);
  }
};
await stepUntil(async () => (await page.locator('.w-line.agent').count()) >= 1, 6);
await scrollTo('.w-flaglane');
await beat(28);
await stepUntil(async () => (await whispers()) >= 1, 40);
await scrollTo('.w-flaglane');
await beat(29);
await stepUntil(async () => (await page.locator('.w-line.closeout').count()) >= 1, 80);
await scrollTo('.w-flaglane');
await beat(30);

// 31 to 32: the packet.
await page.goto(`${base}/packet`, { waitUntil: 'networkidle' });
await theme('light');
await beat(31);
await page.getByRole('button', { name: 'Verify integrity' }).click();
await beat(32);
await caption('');

// 33 to 40: the deck.
for (const [slideNo, lineNo] of [[5, 33], [6, 34], [7, 35], [9, 36], [10, 37], [11, 38], [12, 39], [8, 40]]) {
  await showSlide(slideNo);
  await beat(lineNo);
}
await showSlide(13);
await hold(4);

writeFileSync(path.join(out, 'beats.json'), JSON.stringify({ fps: FPS, frames: n, beats }, null, 2));
await browser.close();
console.log(`wrote ${n} frames (${(n / FPS).toFixed(0)} s) to ${out}`);
