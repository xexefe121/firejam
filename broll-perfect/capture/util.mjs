import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const root = path.resolve(project, '..');
export const work = path.join(project, 'work');
export const output = path.join(project, 'public/broll');
export const port = Number(process.env.FIREJAM_CAPTURE_PORT ?? 3000);
export const origin = `http://localhost:${port}`;
export const abort = new AbortController();
export const sleep = (ms, interruptible = true) => new Promise((resolve, reject) => {
  if (interruptible && abort.signal.aborted) return reject(abort.signal.reason);
  const onAbort = () => { clearTimeout(timer); reject(abort.signal.reason); };
  const timer = setTimeout(() => { abort.signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  if (interruptible) abort.signal.addEventListener('abort', onAbort, { once: true });
});
export const at = async epoch => sleep(Math.max(0, epoch - Date.now()));
export async function dirs() {
  for (const dir of [work, output, path.join(work, 'sheets'), path.join(project, 'manifest')]) await mkdir(dir, { recursive: true });
}
export function launch(exe, args, options = {}) {
  const child = spawn(exe, args, { cwd: root, windowsHide: true, ...options });
  let tail = '';
  child.stdout?.on('data', d => { tail = (tail + d).slice(-16000); });
  child.stderr?.on('data', d => { tail = (tail + d).slice(-16000); });
  child.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve(tail) : reject(new Error(`${exe} exited ${code ?? signal}: ${tail.slice(-2200)}`)));
  });
  // A process may finish before its owner awaits it.
  child.done.catch(() => {});
  return child;
}
export const command = (exe, args, options) => launch(exe, args, options).done;
export async function json(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
export async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export async function verify(id, width, height) {
  const file = path.join(output, `${id}.mp4`);
  const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const v = probe.streams.find(s => s.codec_type === 'video');
  if (!v || v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || v.width !== width || v.height !== height || v.r_frame_rate !== '30/1' || v.avg_frame_rate !== '30/1') throw new Error(`${id}: wrong output format ${JSON.stringify(v)}`);
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', 'fps=1,scale=480:-1,tile=6x2', '-frames:v', '1', '-q:v', '2', path.join(work, 'sheets', `${id}.jpg`)]);
  return { duration: Number(probe.format.duration), width: v.width, height: v.height, fps: 30 };
}
