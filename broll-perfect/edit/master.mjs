// Masters the Remotion render for upload: one measured linear gain to -14 LUFS (YouTube/Devpost
// playback level) and a limiter that only catches peaks, video stream copied untouched. Plain gain,
// not loudnorm: loudnorm drops to dynamic mode when peaks would exceed its ceiling, which pumps the voice.
// Run: node edit/master.mjs [in] [out]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(project, process.argv[2] ?? 'out/render.mp4');
const output = path.resolve(project, process.argv[3] ?? 'out/firejam-demo-1min.mp4');
const TARGET = -14;

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-2000));
  return r.stderr;
};

const loudness = (file) => {
  const log = run(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return { I: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]), peak: summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1] };
};
const before = loudness(input);
const gain = TARGET - before.I;
run(['-y', '-i', input, '-c:v', 'copy', '-af',
  `volume=${gain.toFixed(2)}dB,alimiter=limit=0.85:attack=2:release=60:level=disabled,aresample=48000`,
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output]);
const after = loudness(output);
console.log(`${path.relative(project, output)}: ${after.I} LUFS integrated, true peak ${after.peak} dBFS (was ${before.I} LUFS, gain ${gain.toFixed(2)} dB)`);
