import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  UV_CACHE_DIR: 'H:\\firejam-tools\\uv-cache',
  HF_HOME: 'H:\\firejam-tools\\hf-cache',
  TEMP: 'Y:\\Temp', TMP: 'Y:\\Temp',
  PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
  HF_HUB_DISABLE_PROGRESS_BARS: '1',
  HF_HUB_DISABLE_XET: '1', HF_HUB_DOWNLOAD_TIMEOUT: '60',
};
for (const p of [env.UV_CACHE_DIR, env.HF_HOME, env.TEMP]) mkdirSync(p, {recursive: true});
const base = ['run', '--python', '3.12', '--with', 'faster-whisper==1.2.1',
  '--with', 'fal-client==0.13.1', '--with', 'scipy==1.17.0'];
const gpu = env.INSPECT_DEVICE === 'cpu' ? [] : ['--with', 'nvidia-cublas-cu12==12.9.2.10', '--with', 'nvidia-cudnn-cu12==9.27.0.42'];
const result = spawnSync('uv', [...base, ...gpu, 'python', path.join(root, 'inspect', 'pipeline.py'), ...process.argv.slice(2)],
  {cwd: root, env, stdio: 'inherit', windowsHide: true});
if (result.error) console.error(`inspect: ${result.error.message}`);
process.exit(result.status ?? 1);
