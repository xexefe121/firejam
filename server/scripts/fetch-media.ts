// Mirrors the demo films into server/media/ so a LAN demo never waits on the internet.
// Usage: npm run media:fetch -w server
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ENTRIES, MEDIA_DIR } from '../src/catalog.ts';

mkdirSync(MEDIA_DIR, { recursive: true });

for (const { id, title, mirror } of ENTRIES) {
  if (!mirror) continue;
  const file = path.join(MEDIA_DIR, `${id}.mp4`);
  if (existsSync(file)) {
    console.log(`✓ ${title} already downloaded`);
    continue;
  }
  const res = await fetch(mirror.url);
  if (!res.ok || !res.body) throw new Error(`${title}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    done += chunk.length;
    if (Date.now() - last > 1000) {
      last = Date.now();
      process.stdout.write(`\r↓ ${title}: ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
    }
  });
  await pipeline(body, createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
  console.log(`\r✓ ${title}: ${(done / 1e6).toFixed(0)} MB${' '.repeat(20)}`);
}
console.log('Done. Restart the server to stream from server/media/.');
