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
  data.copy(track, at, 0, Math.max(0, Math.min(data.length, room)));
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
