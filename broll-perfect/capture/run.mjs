import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { dirs, root, project, work, origin, port, command, launch, sleep, json, readJson, verify, abort } from './util.mjs';
import { mirrorFilm } from './media.mjs';
import { setupWeb, key, dpadFocus, pinSelector, toMap, joinMa, waitFilm, inviteSheet, diagnostics } from './web.mjs';
import { prepareAudio, recordGroup } from './record.mjs';
import { captureFireTv, adb } from './firetv.mjs';

const ids = ['tv-home-hero', 'tv-jam-map', 'tv-join-ma', 'tv-player-sync', 'laptop-player-sync', 'tv-invite-qr', 'web-phone-companion', 'tv-reactions', 'tv-leo-joined', 'firetv-home', 'firetv-map', 'firetv-player'];
const requested = process.argv.slice(2);
const selected = new Set(requested.length ? requested : ids);
for (const id of selected) if (!ids.includes(id)) throw new Error(`Unknown clip: ${id}. Valid ids: ${ids.join(', ')}`);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid FIREJAM_CAPTURE_PORT');
process.env.TEMP = 'Y:\\Temp';
process.env.TMP = 'Y:\\Temp';
let server, state;
let ending = false;
async function cleanup() {
  if (ending) return;
  ending = true;
  await state?.close().catch(() => {});
  if (server && server.exitCode === null) { server.kill(); await server.done.catch(() => {}); }
}
// An interrupt throws into the main try/finally, including Fire TV restoration.
const interrupt = () => abort.abort(new Error('Capture interrupted'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

async function portFree(number) {
  await new Promise((resolve, reject) => {
    const test = net.createServer();
    test.once('error', e => reject(new Error(`Port ${number} unavailable (${e.code}). Stop the existing listener before capture; runner never kills another server.`)));
    test.listen(number, '::', () => test.close(resolve));
  });
}
await dirs();
const manifestFile = path.join(project, 'manifest/broll.json');
const manifest = await readJson(manifestFile, { clips: [] });
async function save(id, details) {
  const phone = id === 'web-phone-companion';
  const format = await verify(id, phone ? 780 : 1920, phone ? 1688 : 1080);
  const clip = { id, file: `broll/${id}.mp4`, ...format, ...details };
  manifest.clips = [...manifest.clips.filter(c => c.id !== id), clip].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await json(manifestFile, manifest);
}
const filmNote = `Actual FireJam UI and controls. Sintel (Blender Foundation, CC-BY 3.0) ${process.env.FIREJAM_CAPTURE_MIRROR !== '0' ? 'mirrored to capture-local storage' : 'streamed from the app’s archive.org source'}; decoded film audio captured for established player takes. Join take has no audio track because its video mounts during the take.`;
async function take(id, duration, beat, actions = [], extra = {}) {
  const result = await recordGroup([{ id, page: state.tv }], duration, actions);
  await save(id, { source: 'web-tv', beat, notes: filmNote, events: result.events, ...extra });
  return result;
}
async function showControls(page) {
  if (await page.locator('.controls').count()) await key(page, 'Escape');
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await dpadFocus(page, '.controls-row button.round.big');
}
async function main() {
  await Promise.all([portFree(port), portFree(3001), command('ffmpeg', ['-version']), command('ffprobe', ['-version'])]);
  if ([...selected].some(id => id.startsWith('firetv-'))) await adb('get-state');
  if (!process.env.FIREJAM_CAPTURE_SKIP_BUILD) {
    console.log('Building web once');
    await command('cmd.exe', ['/d', '/s', '/c', 'npm run build']);
  }
  const media = process.env.FIREJAM_CAPTURE_MIRROR !== '0' ? await mirrorFilm() : null;
  const dataRoot = 'Y:\\Temp\\firejam-capture';
  await mkdir(dataRoot, { recursive: true });
  const data = await mkdtemp(path.join(dataRoot, 'run-'));
  const logFile = path.join(work, 'server.log');
  server = launch(process.execPath, ['--import', 'tsx', path.join(project, 'capture/server-bootstrap.mjs')], { cwd: path.join(root, 'server'), env: { ...process.env, FIREJAM_PORT: String(port), FIREJAM_DATA_DIR: data, ...(media ? { FIREJAM_CAPTURE_MEDIA: media } : {}) } });
  let serverLog = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', d => { serverLog = (serverLog + d).slice(-32000); });
  const deadline = Date.now() + 25000;
  while (!serverLog.includes('FireJam server')) {
    if (server.exitCode !== null) await server.done;
    if (Date.now() > deadline) throw new Error('Throwaway server did not start');
    await sleep(100);
  }
  await writeFile(logFile, serverLog);
  console.log(`Throwaway server: ${origin}; fresh data ${data}`);
  state = await setupWeb();
  const tv = state.tv;
  await json(path.join(work, 'web-diagnostics.json'), await diagnostics(tv, 'web-home'));
  if (selected.has('tv-home-hero')) await take('tv-home-hero', 6, 'Ma is watching: the living room is back', [
    { t: 1.8, label: 'hero-focus-next', run: () => key(tv, 'ArrowRight') },
    { t: 3.8, label: 'hero-focus-return', run: () => key(tv, 'ArrowLeft') },
  ]);
  if (selected.has('tv-jam-map')) {
    await take('tv-jam-map', 9, 'Discover friends and public jams around the world', [
      { t: 0.2, label: 'home-left-to-rail', run: () => key(tv, 'ArrowLeft') },
      { t: 0.7, label: 'open-jam-map', run: async () => { await key(tv, 'ArrowDown'); await key(tv, 'Enter'); await tv.locator('.map-screen').waitFor(); } },
      { t: 2.0, label: 'london-pin', run: async () => dpadFocus(tv, await pinSelector(tv, 'Leo')) },
      { t: 4.0, label: 'sao-paulo-public-jam-arcs', run: async () => dpadFocus(tv, await pinSelector(tv, 'Sofia')) },
      { t: 6.6, label: 'hyderabad-pin', run: async () => dpadFocus(tv, await pinSelector(tv, 'Ma')) },
    ]);
  }
  const playerIds = ids.slice(2, 9);
  if (playerIds.some(id => selected.has(id))) {
    await toMap(tv);
    await dpadFocus(tv, await pinSelector(tv, 'Ma'));
    if (selected.has('tv-join-ma')) await take('tv-join-ma', 5, 'Join Ma from Hyderabad in one click', [
      { t: 0.5, label: 'ma-pin-ok', run: () => key(tv, 'Enter'), check: () => tv.getByRole('button', { name: 'Join Ma', exact: true }).waitFor() },
      { t: 1.5, label: 'join-ma', run: () => key(tv, 'Enter'), check: () => tv.locator('video').waitFor(), observed: 'player-started' },
    ]);
    else await joinMa(tv);
    await waitFilm(tv);
    await prepareAudio(tv);
    await waitFilm(tv);
  }
  const syncIds = ['tv-player-sync', 'laptop-player-sync'].filter(id => selected.has(id));
  if (syncIds.length) {
    const laptop = await state.pageFor('laptop', `${origin}/?as=ammu`);
    await waitFilm(laptop);
    await prepareAudio(laptop);
    await Promise.all([waitFilm(tv), waitFilm(laptop)]);
    await Promise.all([showControls(tv), showControls(laptop)]);
    const result = await recordGroup(syncIds.map(id => ({ id, page: id.startsWith('laptop') ? laptop : tv })), 14, [
      { t: 3.0, label: 'ma-controls-hidden', run: () => key(laptop, 'Escape') },
      { t: 4.0, label: 'ma-pause', run: () => key(laptop, 'Enter'), check: () => tv.locator('.control-banner').filter({ hasText: 'Ma paused' }).waitFor(), observed: 'ma-paused-banner' },
      { t: 8.0, label: 'tv-resume', run: () => key(tv, 'Enter'), check: () => laptop.locator('.control-banner').filter({ hasText: 'Dhanu pressed play' }).waitFor(), observed: 'resume-on-laptop' },
      { t: 9.3, label: 'tv-controls-hidden', run: () => key(tv, 'Escape') },
      { t: 11.0, label: 'tv-skip-plus-10s', run: () => key(tv, 'ArrowRight'), check: () => tv.locator('.hud').filter({ hasText: '+10s' }).waitFor(), observed: 'skip-hud' },
    ]);
    for (const id of syncIds) await save(id, { source: id.startsWith('laptop') ? 'web-laptop' : 'web-tv', syncGroup: 'join-ma', beat: 'Same moment: Ma pauses, Dhanu resumes and skips', notes: `${filmNote} Shared wall-clock start ${new Date(result.start).toISOString()}. Player member chips naturally auto-hide after five seconds, return while paused.${syncIds.length === 1 ? ' Partial recapture: paired file retained; recapture both ids for a shared take.' : ''}`, events: result.events });
    await laptop.close();
  }
  if (selected.has('tv-invite-qr')) {
    await showControls(tv);
    await take('tv-invite-qr', 5, 'Invite friends, or pair a phone with the QR', [
      { t: 0.3, label: 'player-down', run: () => key(tv, 'ArrowDown') },
      { t: 0.7, label: 'invite-qr-visible', run: () => inviteSheet(tv) },
    ]);
  }
  const phoneIds = ['web-phone-companion', 'tv-reactions'].filter(id => selected.has(id));
  if (phoneIds.length) {
    await inviteSheet(tv);
    const pairing = tv.getByRole('button', { name: 'Pair my phone as a remote' });
    const sel = await pairing.evaluate(el => { el.dataset.captureTarget = 'pair'; return '[data-capture-target="pair"]'; });
    await dpadFocus(tv, sel); await key(tv, 'Enter');
    await tv.getByText('Paired as Dhanu', { exact: false }).waitFor().catch(() => {});
    const code = state.maJam().code;
    // Exact token-paired remote URL encoded by the app's Pair my phone QR.
    const phone = await state.pageFor('phone', `${origin}/m?code=${code}&as=${state.profile.userId}&t=${state.profile.token}`, true);
    await phone.locator('.c-reactions').waitFor();
    await key(tv, 'Escape');
    const result = await recordGroup(phoneIds.map(id => ({ id, page: id === 'web-phone-companion' ? phone : tv, ...(id === 'web-phone-companion' ? { width: 780, height: 1688 } : {}) })), 9, [
      { t: 1.2, label: 'phone-heart-tap', run: () => phone.getByRole('button', { name: '❤️', exact: true }).tap(), check: () => tv.locator('.reaction .emoji').filter({ hasText: '❤️' }).first().waitFor(), observed: 'tv-heart-reaction' },
      { t: 2.8, label: 'phone-laugh-tap', run: () => phone.getByRole('button', { name: '😂', exact: true }).tap(), check: () => tv.locator('.reaction .emoji').filter({ hasText: '😂' }).first().waitFor(), observed: 'tv-laugh-reaction' },
      { t: 4.0, label: 'phone-message-type', run: async () => { await phone.locator('.c-input input').tap(); await phone.locator('.c-input input').pressSequentially('Miss you Ma ❤️', { delay: 70 }); } },
      { t: 6.0, label: 'phone-message-send', run: () => phone.getByRole('button', { name: 'Send', exact: true }).tap(), check: () => tv.locator('.chat-feed').getByText('Miss you Ma ❤️', { exact: false }).waitFor(), observed: 'tv-miss-you-ma-message' },
    ]);
    for (const id of phoneIds) await save(id, { source: id === 'web-phone-companion' ? 'web-phone' : 'web-tv', syncGroup: 'phone', beat: 'Phone is the remote: reactions and Miss you Ma', notes: `${id === 'web-phone-companion' ? '390x844 viewport, device scale 2. Genuine token-paired companion page; touch input.' : filmNote} Shared wall-clock start ${new Date(result.start).toISOString()}.${phoneIds.length === 1 ? ' Partial recapture: paired file retained; recapture both ids for a shared take.' : ''}`, events: result.events });
    await phone.close();
  }
  if (selected.has('tv-leo-joined')) {
    await inviteSheet(tv);
    const row = tv.locator('.invite-row').filter({ has: tv.locator('b', { hasText: /^Leo$/ }) });
    const sel = await row.getByRole('button', { name: 'Invite', exact: true }).evaluate(el => { el.dataset.captureTarget = 'leo'; return '[data-capture-target="leo"]'; });
    await dpadFocus(tv, sel);
    await take('tv-leo-joined', 5, 'Bring Leo in from London', [
      { t: 0.15, label: 'invite-leo', run: () => key(tv, 'Enter'), check: () => tv.locator('.toast').filter({ hasText: 'Leo joined from London' }).waitFor(), observed: 'leo-joined-from-london-toast' },
    ]);
  }
  await json(path.join(work, 'web-diagnostics-final.json'), await diagnostics(tv, 'web-final'));
  if ([...selected].some(id => id.startsWith('firetv-'))) {
    // Native device gets its own fresh Home, with Ma still hosting the seed jam.
    await captureFireTv(selected, state, save);
  }
  for (const id of selected) {
    const clip = manifest.clips.find(c => c.id === id);
    if (!clip) throw new Error(`Missing manifest entry: ${id}`);
    await verify(id, clip.width, clip.height);
  }
  console.log(`PASS: ${selected.size} clips verified; manifest/broll.json; work/sheets/<id>.jpg`);
}
try {
  // Race only the top-level work; native helper owns its own restoration finally.
  await main();
} catch (error) {
  if (state?.tv && !state.tv.isClosed()) await state.tv.screenshot({ path: path.join(work, 'capture-failure.png') }).catch(() => {});
  console.error(`CAPTURE FAILED: ${error.message}`);
  process.exitCode = 1;
} finally { await cleanup(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
