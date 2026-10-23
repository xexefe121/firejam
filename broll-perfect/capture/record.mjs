import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { at, command, json, launch, output, work } from './util.mjs';

// CDP JPEGs retain their capture timestamps. Resampling below holds the most
// recent frame at each 1/30 s tick, so gaps never shorten a clip or shift events.
export class Screencast {
  constructor(page, id, width = 1920, height = 1080) {
    Object.assign(this, { page, id, width, height, frames: [], pending: [], audio: [] });
  }
  async arm() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Page.enable');
    this.onFrame = ({ data, metadata, sessionId }) => {
      this.frames.push({ t: (metadata.timestamp ?? Date.now() / 1000) * 1000, received: Date.now(), data: Buffer.from(data, 'base64'), width: metadata.deviceWidth, height: metadata.deviceHeight });
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    };
    this.cdp.on('Page.screencastFrame', this.onFrame);
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1 });
    const deadline = Date.now() + 10000;
    while (!this.frames.length && Date.now() < deadline) await at(Date.now() + 50);
    if (!this.frames.length) throw new Error(`${this.id}: CDP produced no frames`);
  }
  async stop(start, duration) {
    await this.cdp.send('Page.stopScreencast');
    this.cdp.off('Page.screencastFrame', this.onFrame);
    await this.cdp.detach();
    this.start = start; this.duration = duration;
  }
  async encode(audioPath) {
    const frames = this.frames.sort((a, b) => a.t - b.t);
    if (!frames.length) throw new Error(`${this.id}: empty screencast`);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'mjpeg', '-i', 'pipe:0'];
    if (audioPath) args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k');
    else args.push('-an');
    args.push('-vf', `scale=${this.width}:${this.height}:flags=lanczos:in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', '30', '-fps_mode', 'cfr', '-t', String(this.duration), '-frames:v', String(Math.round(this.duration * 30)), '-movflags', '+faststart', path.join(output, `${this.id}.mp4`));
    const ffmpeg = launch('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let index = 0;
    try {
      for (let frame = 0; frame < Math.round(this.duration * 30); frame++) {
        const time = this.start + frame * 1000 / 30;
        while (index + 1 < frames.length && frames[index + 1].t <= time) index++;
        if (!ffmpeg.stdin.write(frames[index].data)) await once(ffmpeg.stdin, 'drain');
      }
      ffmpeg.stdin.end();
      await ffmpeg.done;
    } catch (e) { ffmpeg.kill(); throw e; }
    await json(path.join(work, `${this.id}.timing.json`), {
      wallClockStart: new Date(this.start).toISOString(), duration: this.duration,
      format: 'CDP Page.startScreencast jpeg quality=96; timestamp sample-and-hold to 30 fps',
      frames: frames.map(({ t, received, width, height }) => ({ t: (t - this.start) / 1000, received: (received - this.start) / 1000, width, height })),
    });
    this.frames = [];
  }
}

// Capture the film's decoded audio through Web Audio. Destination keeps running
// through a shared pause, preserving silence and A/V alignment in the recording.
export async function prepareAudio(page) {
  if (!await page.locator('video').count()) return false;
  return page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video || !video.captureStream) return false;
    if (!window.__brollAudio) {
      if (video.crossOrigin !== 'anonymous') {
        video.crossOrigin = 'anonymous';
        video.load();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Audio source reload timed out')), 45000);
          video.addEventListener('canplay', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Film CORS/audio reload failed')); }, { once: true });
        });
      }
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createMediaElementSource(video);
      const destination = ctx.createMediaStreamDestination();
      source.connect(destination); source.connect(ctx.destination);
      window.__brollAudio = { ctx, destination };
    }
    return true;
  });
}
async function startAudio(page, epoch) {
  return page.evaluate(async epoch => {
    if (!window.__brollAudio) return false;
    await new Promise(r => setTimeout(r, Math.max(0, epoch - Date.now())));
    const a = window.__brollAudio;
    a.chunks = [];
    a.recorder = new MediaRecorder(a.destination.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    a.recorder.ondataavailable = e => a.chunks.push(e.data);
    a.started = Date.now(); a.recorder.start();
    return a.started;
  }, epoch);
}
async function stopAudio(page, id) {
  const result = await page.evaluate(async () => {
    const a = window.__brollAudio;
    if (!a?.recorder || a.recorder.state === 'inactive') return null;
    await new Promise(r => { a.recorder.onstop = r; a.recorder.stop(); });
    const bytes = new Uint8Array(await new Blob(a.chunks).arrayBuffer());
    let data = '';
    for (let i = 0; i < bytes.length; i += 8192) data += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { data: btoa(data), started: a.started };
  });
  if (!result) return null;
  const file = path.join(work, `${id}.audio.webm`);
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return file;
}

export async function recordGroup(specs, duration, actions = []) {
  const casts = specs.map(s => new Screencast(s.page, s.id, s.width, s.height));
  await Promise.all(casts.map(c => c.arm()));
  const start = Date.now() + 600;
  const audioStarts = specs.map(s => startAudio(s.page, start));
  const events = [];
  try {
    await Promise.all([
      ...actions.map(async action => {
        await at(start + action.t * 1000);
        await action.run();
        const t = Math.round((Date.now() - start) / 10) / 100;
        events.push({ t, label: action.label });
        if (action.check) {
          await action.check();
          events.push({ t: Math.round((Date.now() - start) / 10) / 100, label: action.observed ?? `${action.label}-visible` });
        }
      }),
      at(start + duration * 1000),
      ...audioStarts,
    ]);
  } finally {
    await Promise.all(casts.map(c => c.stop(start, duration)));
  }
  const audio = await Promise.all(specs.map(s => stopAudio(s.page, s.id)));
  for (let i = 0; i < casts.length; i++) {
    await casts[i].encode(audio[i]);
    console.log(`Recorded ${specs[i].id}: ${duration}s, ${casts[i].width}x${casts[i].height}${audio[i] ? ', film audio' : ''}`);
  }
  return { events: events.sort((a, b) => a.t - b.t), start };
}
