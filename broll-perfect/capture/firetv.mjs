import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { command, launch, output, work, sleep, json, port as hostPort } from './util.mjs';
import { dpadFocus, pinSelector } from './web.mjs';

export const serial = 'G072JM1352950DJM';
export const cloud = 'https://d12le9d1o14nhz.cloudfront.net';
export const adb = (...args) => command('adb', ['-s', serial, ...args]);
const keyCodes = { ArrowLeft: 'KEYCODE_DPAD_LEFT', ArrowRight: 'KEYCODE_DPAD_RIGHT', ArrowUp: 'KEYCODE_DPAD_UP', ArrowDown: 'KEYCODE_DPAD_DOWN', Enter: 'KEYCODE_DPAD_CENTER', Escape: 'KEYCODE_BACK' };
async function press(_page, key, delay = 220) { await adb('shell', 'input', 'keyevent', keyCodes[key]); await sleep(delay); }

export async function captureFireTv(selected, state, save) {
  await adb('get-state');
  const previous = await adb('reverse', '--list');
  const mappings = new Map(previous.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(p => p.length >= 3).map(p => [p[1], p[2]]));
  let browser, forwardPort;
  const restore = { serial, requested: cloud, restored: false };
  try {
    // The TV always talks to its own localhost:3000; that maps to whichever host port the capture server uses.
    await adb('reverse', 'tcp:3000', `tcp:${hostPort}`);
    await adb('reverse', 'tcp:3001', 'tcp:3001');
    const deviceId = (await adb('shell', 'settings', 'get', 'secure', 'android_id')).trim();
    const pid = (await adb('shell', 'settings', 'get', 'secure', 'cev_pid')).trim();
    const tvProfile = createHash('sha256').update(`${deviceId}:${pid}`).digest('hex').slice(0, 16);
    state.controller.socket.emit('jam:leave');
    await state.controller.ack('hello', { userId: state.profile.userId, token: state.profile.token, deviceId, tvProfile });
    await adb('shell', 'am', 'start', '-n', 'app.firejam.tv/.MainActivity', '--es', 'server', 'http://localhost:3000');
    await sleep(2500);
    const appPid = (await adb('shell', 'pidof', 'app.firejam.tv')).trim().split(/\s+/)[0];
    if (!appPid) throw new Error('FireJam app process not running on Fire TV');
    forwardPort = (await adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${appPid}`)).trim();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardPort}`);
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://localhost:3000'));
    if (!page) throw new Error('Fire TV local WebView not available over CDP');
    page.setDefaultTimeout(20000);
    await page.locator('.hero h1').filter({ hasText: 'Ma is watching' }).waitFor();
    await sleep(2000);
    async function record(id, duration, actions) {
      const remote = `/sdcard/firejam-broll-${Date.now()}-${id}.mp4`;
      const raw = path.join(work, `${id}.device.mp4`);
      const started = Date.now();
      const recording = launch('adb', ['-s', serial, 'shell', 'screenrecord', '--size', '1920x1080', '--bit-rate', '20000000', '--time-limit', String(duration), remote]);
      const events = [];
      try {
        await sleep(700);
        await actions?.(async (label, fn) => { await fn(); events.push({ t: Math.round((Date.now() - started) / 10) / 100, label }); });
        await recording.done;
        await adb('pull', remote, raw);
        await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-an', '-vf', 'fps=30,scale=1920:1080:flags=lanczos:out_range=tv,format=yuv420p,setsar=1', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', '30', '-fps_mode', 'cfr', '-movflags', '+faststart', path.join(output, `${id}.mp4`)]);
        await page.screenshot({ path: path.join(work, `${id}.png`) });
        await save(id, { source: 'firetv', beat: id === 'firetv-home' ? 'Real Fire TV: the hook' : id === 'firetv-map' ? 'Real Fire TV: world of jams' : 'Real Fire TV: shared film', notes: 'USB Fire TV Stick 4K Max, serial G072JM1352950DJM. Real adb D-pad input; native 20 Mbps screenrecord. Android screenrecord does not record the film audio.', events });
        console.log(`Recorded ${id}: real device`);
      } finally {
        // screenrecord self-terminates in <=10s; never leave a recording running.
        await recording.done.catch(() => {});
        await adb('shell', 'rm', '-f', remote).catch(() => {});
      }
    }
    if (selected.has('firetv-home')) await record('firetv-home', 6, async event => {
      await sleep(1600); await event('focus-next', () => press(page, 'ArrowRight'));
      await sleep(1500); await event('focus-return', () => press(page, 'ArrowLeft'));
    });
    await press(page, 'ArrowLeft');
    await dpadFocus(page, '.rail-item:nth-of-type(2)', press);
    await press(page, 'Enter');
    await page.locator('.map-screen').waitFor();
    if (selected.has('firetv-map')) await record('firetv-map', 10, async event => {
      await event('london-pin', async () => dpadFocus(page, await pinSelector(page, 'Leo'), press));
      await sleep(1000);
      await event('sao-paulo-public-jam', async () => dpadFocus(page, await pinSelector(page, 'Sofia'), press));
      await sleep(1000);
      await event('hyderabad-pin', async () => dpadFocus(page, await pinSelector(page, 'Ma'), press));
    });
    if (selected.has('firetv-player')) {
      await dpadFocus(page, await pinSelector(page, 'Ma'), press);
      await press(page, 'Enter');
      await page.getByRole('button', { name: 'Join Ma', exact: true }).waitFor();
      await press(page, 'Enter');
      await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && !v.paused; }, null, { timeout: 60000 });
      await record('firetv-player', 8, async event => {
        await event('player-controls', () => press(page, 'ArrowDown'));
        await sleep(2800); await event('player-focus-next', () => press(page, 'ArrowRight'));
      });
    }
  } finally {
    try {
      await adb('shell', 'am', 'start', '-n', 'app.firejam.tv/.MainActivity', '--es', 'server', cloud);
      await sleep(1800, false);
      const prefs = await adb('shell', 'run-as', 'app.firejam.tv', 'cat', 'shared_prefs/firejam.xml');
      restore.restored = /<string name="serverUrl">https:\/\/d12le9d1o14nhz\.cloudfront\.net<\/string>/.test(prefs);
      restore.verifiedAt = new Date().toISOString();
      if (!restore.restored) throw new Error('Fire TV server URL restoration could not be verified');
      console.log(`Fire TV restored: ${cloud}`);
    } finally {
      // Disconnect CDP without closing the native WebView or app.
      await browser?.close().catch(() => {});
      if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`).catch(() => {});
      for (const port of [3000, 3001]) {
        const local = `tcp:${port}`;
        if (mappings.has(local)) await adb('reverse', local, mappings.get(local));
        else await adb('reverse', '--remove', local).catch(() => {});
      }
      await json(path.join(work, 'firetv-restore.json'), restore);
    }
  }
}
