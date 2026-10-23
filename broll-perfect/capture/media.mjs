import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm, appendFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { work, abort, sleep } from './util.mjs';

const size = 282690045;
const source = 'https://dn601208.us.archive.org/0/items/Sintel/sintel-2048-stereo.mp4';

export async function mirrorFilm() {
  const directory = path.join(work, 'media');
  const chunks = path.join(directory, 'chunks');
  await mkdir(chunks, { recursive: true });
  const file = path.join(directory, 'sintel.mp4');
  if ((await stat(file).catch(() => null))?.size === size) return directory;
  const prefix = `${file}.part`;
  const prefixSize = Math.min(size, (await stat(prefix).catch(() => null))?.size ?? 0);
  const ranges = [];
  for (let start = prefixSize; start < size; start += 2 * 1024 * 1024) ranges.push({ start, end: Math.min(size - 1, start + 2 * 1024 * 1024 - 1) });
  let cursor = 0, done = prefixSize;
  console.log(`Mirroring original Sintel (${Math.round(prefixSize / 1e6)} / 283 MB cached; eight bounded range requests)`);
  const timer = setInterval(() => console.log(`Film mirror: ${(done / 1e6).toFixed(0)} / 283 MB`), 30000);
  try {
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (cursor < ranges.length) {
        const { start, end } = ranges[cursor++];
        const target = path.join(chunks, `${start}-${end}.bin`);
        const expected = end - start + 1;
        if ((await stat(target).catch(() => null))?.size === expected) { done += expected; continue; }
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await fetch(`${source}?capture-range=${start}`, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]) });
            if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${start}-${end}/`)) throw new Error(`Film range ${start}: HTTP ${response.status}, ${response.headers.get('content-range')}`);
            await pipeline(Readable.fromWeb(response.body), createWriteStream(`${target}.part`));
            if ((await stat(`${target}.part`)).size !== expected) throw new Error(`Truncated film range ${start}`);
            await rename(`${target}.part`, target);
            done += expected; break;
          } catch (e) { await rm(`${target}.part`, { force: true }); if (attempt >= 2 || abort.signal.aborted) throw e; await sleep(500); }
        }
      }
    }));
    const assembled = `${file}.assembling`;
    if (prefixSize) await pipeline(createReadStream(prefix), createWriteStream(assembled));
    else await appendFile(assembled, Buffer.alloc(0));
    for (const { start, end } of ranges) await pipeline(createReadStream(path.join(chunks, `${start}-${end}.bin`)), createWriteStream(assembled, { flags: 'a' }));
    if ((await stat(assembled)).size !== size) throw new Error('Assembled film mirror has wrong size');
    await rename(assembled, file);
    console.log('Film mirror ready');
  } catch (e) { abort.abort(e); throw e; }
  finally { clearInterval(timer); }
  return directory;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await mirrorFilm();
