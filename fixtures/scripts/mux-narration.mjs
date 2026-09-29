// Lay the rendered narration on the picture track and encode the demo video.
//
//   node fixtures/scripts/mux-narration.mjs <footageDir> <narrationDir> <out.mp4>
//
// <footageDir>/beats.json (from capture-footage.mjs) says when each line starts; <narrationDir>
// holds NN.wav per line (from render-narration.mjs). Each clip is placed at its beat's start on
// one 24 kHz mono track, silence between. Encoding needs ffmpeg: set FFMPEG to its path, or
// leave it and the imageio-ffmpeg binary is looked up through python3.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [footage, narration, target] = process.argv.slice(2);
if (!footage || !narration || !target) {
  console.error('usage: mux-narration.mjs <footageDir> <narrationDir> <out.mp4>');
  process.exit(1);
}
const RATE = 24_000;
const { fps, frames, beats } = JSON.parse(readFileSync(path.join(footage, 'beats.json'), 'utf8'));
const totalSeconds = frames / fps;
const track = Buffer.alloc(Math.ceil(totalSeconds * RATE) * 2);

// Room tone: a very quiet, soft-edged noise floor (about -50 dBFS) under the whole track, so the
// gaps between lines are not dead digital silence and the clips do not start and stop with a hard
// gate. Seeded, so a re-run gives the same file. No music.
{
  let seed = 20260929;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000 - 0.5; };
  let soft = 0;
  for (let i = 0; i < track.length; i += 2) {
    soft = soft * 0.985 + rand() * 0.015 * 2;
    track.writeInt16LE(Math.round(soft * 32768 * 0.064), i);
  }
}

for (const b of beats) {
  const file = path.join(narration, `${String(b.n).padStart(2, '0')}.wav`);
  if (!existsSync(file)) {
    console.warn(`line ${b.n}: no audio, left silent`);
    continue;
  }
  const wav = readFileSync(file);
  const data = wav.subarray(44);
  const at = Math.round(b.startSeconds * RATE) * 2;
  const room = track.length - at;
  const usable = Math.max(0, Math.min(data.length, room)) & ~1;
  for (let i = 0; i < usable; i += 2) {
    const mixed = track.readInt16LE(at + i) + data.readInt16LE(i);
    track.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), at + i);
  }
  if (data.length > room) console.warn(`line ${b.n}: audio runs ${((data.length - room) / 2 / RATE).toFixed(1)} s past the end`);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + track.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
header.writeUInt32LE(track.length, 40);
const audioPath = path.join(footage, 'narration-track.wav');
writeFileSync(audioPath, Buffer.concat([header, track]));

const ffmpeg = process.env.FFMPEG ?? execFileSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();
execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-framerate', String(fps), '-i', path.join(footage, 'frames', 'f%05d.png'),
  '-i', audioPath,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-preset', 'medium', '-crf', '20',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
  target,
], { stdio: 'inherit' });
console.log(`wrote ${target} (${totalSeconds.toFixed(0)} s)`);
