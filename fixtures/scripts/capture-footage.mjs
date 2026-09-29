// Picture track for the demo video: deck slides and a stepped run of the real console with the
// narration as on-screen captions, cut to the beat map in docs/submission/RUNBOOK.md (B5).
//
//   PLAYWRIGHT_CORE=<path> node fixtures/scripts/capture-footage.mjs <outDir> [baseUrl]
//
// Writes numbered PNG frames at 2 frames per second into <outDir>/frames and a caption log.
// Encode with ffmpeg afterwards (see the runbook). Scripted Rep, no network, no microphone.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const out = process.argv[2] ?? 'docs/assets/footage';
const base = process.argv[3] ?? 'http://localhost:3000';
const FPS = 2;
mkdirSync(path.join(out, 'frames'), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

let n = 0;
const log = [];
async function hold(seconds, note) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < frames; i += 1) {
    await page.screenshot({ path: path.join(out, 'frames', `f${String(n).padStart(5, '0')}.png`), scale: 'css' });
    n += 1;
    await page.waitForTimeout(1000 / FPS);
  }
  log.push({ frame: n, seconds: n / FPS, note });
}

/** A caption bar at the bottom of the console, carrying the narration text. */
async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('narration');
    if (!el) {
      el = document.createElement('div');
      el.id = 'narration';
      Object.assign(el.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999',
        padding: '22px 48px', background: 'rgba(11,13,15,0.92)', color: '#e7e4dc',
        font: '600 30px/1.35 "Segoe UI", system-ui, sans-serif', borderTop: '2px solid #6fb1ff',
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

async function slide(index, seconds) {
  await page.goto(pathToFileURL(path.resolve('docs/submission/deck.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate((i) => {
    document.querySelectorAll('section').forEach((s, k) => { s.style.display = k === i - 1 ? 'block' : 'none'; });
    window.scrollTo(0, 0);
  }, index);
  await hold(seconds, `slide ${index}`);
}

const theme = (t) => page.evaluate((v) => document.documentElement.setAttribute('data-theme', v), t);

// 0:00 The problem.
await slide(1, 5);
await slide(2, 11);

// The console before the call.
await page.goto(base, { waitUntil: 'networkidle' });
await theme('dark');
await scrollTo('.w-flaglane');
await caption('Six calls on one claim. One contradiction is already on record between two of them, in grey. Nothing here was typed in: every row is what a payer representative said, with a date, a name and a badge.');
await hold(10, 'idle console');

// Step through the scripted call at our own pace, so each beat can be read.
await page.getByRole('button', { name: 'Start call' }).click();
await page.getByRole('button', { name: 'Pause' }).click();
await scrollTo('.w-flaglane');

const beats = [
  ['The Witness opens by saying it is an AI assistant and that the call is recorded. That line is spoken verbatim; the model never composes it.', 5],
  ['The representative gives a name and a badge number. They become a row.', 3],
  ['The Witness reads the claim back and says up front that earlier calls are on file.', 4],
  ['After four minutes on hold: "That claim denied. Timely filing."', 4],
  ['Same representative, badge 2210, said "no prior authorization" 49 days ago. The link is drawn, and the Witness challenges it on the recorded line, quoting the earlier call.', 8],
  ['"I\'m showing timely filing today."', 3],
  ['The Witness asks about the August 5 call, citing the payer\'s own reference number.', 4],
  ['"I don\'t have a record of a call on August fifth." The ledger does: reference 8K2J-702.', 6],
  ['"I\'d have to look into that."', 3],
  ['What does the remit say?', 3],
  ['"There\'s also a diagnosis issue on it."', 3],
  ['Which diagnosis code?', 3],
  ['"It doesn\'t specify on my screen." A category with no value. That is a refusal, and it is recorded as a row, not left as a blank.', 6],
  ['Remark code?', 3],
  ['"I\'d have to refer you to the denial letter." Second refusal on record.', 4],
  ['Reference number for this call?', 3],
  ['Read fast, over hold music. The reference number lands unconfirmed, so the Witness does not guess.', 5],
  ['It reads the number back: "Eight K two J, nine eight eight. Did I get that right?"', 5],
  ['"That\'s correct." The field turns confirmed. A new row, the original untouched.', 4],
  ['The recap is assembled from the rows: representative, denial reason, the conflict, the refusals, the reference.', 6],
  ['"You\'re welcome. Goodbye."', 3],
  ['The sign-off. The call ends only once the gate is clear.', 4],
];
for (const [text, seconds] of beats) {
  await caption(text);
  await page.getByRole('button', { name: 'Step' }).click().catch(() => undefined);
  await page.waitForTimeout(300);
  await hold(seconds, text.slice(0, 40));
}
// Let the runner finish any remaining items.
await page.getByRole('button', { name: 'Resume' }).click().catch(() => undefined);
await page.waitForTimeout(4000);

await caption('The inspector holds both quotes, the capture sheet fills a CMS-1500, and the hang-up gate is an exit condition: every required field captured or refused.');
await scrollTo('.w-lower');
await hold(9, 'lower panels');

await caption('The claim update sheet: every line traces to a statement. Paste the note into the billing system.');
await scrollTo('.w-update');
await hold(7, 'update sheet');

// The packet.
await page.goto(`${base}/packet`, { waitUntil: 'networkidle' });
await theme('light');
await caption('The appeal packet quotes the record: representative, badge, reference number, date, offset. The conflicting statements come first.');
await hold(8, 'packet');
await page.getByRole('button', { name: 'Verify integrity' }).click();
await caption('The ledger is hash-chained. Verify integrity recomputes the chain from the log on the page.');
await hold(6, 'verify');
await caption('');

// How it works, the evidence model, AssemblyAI.
await slide(5, 9);
await slide(6, 9);
await slide(7, 9);
// Business.
await slide(9, 12);
await slide(10, 10);
await slide(11, 14);
// Roadmap, honesty, close.
await slide(12, 9);
await slide(8, 8);
await slide(13, 7);

writeFileSync(path.join(out, 'captions.json'), JSON.stringify(log, null, 2));
await browser.close();
console.log(`wrote ${n} frames (${(n / FPS).toFixed(0)} s) to ${out}`);
