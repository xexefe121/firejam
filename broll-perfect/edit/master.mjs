// Masters the Remotion render for upload: two-pass loudness normalisation to -14 LUFS
// (YouTube/Devpost playback level, -1 dBTP), video stream copied untouched.
// Run: node edit/master.mjs [in] [out]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(project, process.argv[2] ?? 'out/render.mp4');
const output = path.resolve(project, process.argv[3] ?? 'out/firejam-demo-1min.mp4');
const target = 'I=-14:TP=-1:LRA=11';

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-2000));
  return r.stderr;
};

const log = run(['-nostats', '-i', input, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
run(['-y', '-i', input, '-c:v', 'copy', '-af',
  `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output]);
const check = run(['-nostats', '-i', output, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const summary = check.slice(check.lastIndexOf('Summary:'));
const I = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
console.log(`${path.relative(project, output)}: ${I} LUFS integrated, true peak ${peak} dBFS (was ${m.input_i} LUFS)`);
