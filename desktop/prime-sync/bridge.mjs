// FireJam desktop bridge: puts the Prime Video app on a Windows PC into a jam,
// the same way the Fire TV app does (see android/…/PrimeSync.kt).
//
//   node desktop/prime-sync/bridge.mjs --link "<the phone link from FireJam's Invite screen>"
//   node desktop/prime-sync/bridge.mjs --server https://<id>.cloudfront.net --as <userId> --token <token>
//
// It signs in to FireJam as that person, follows their jam, and once a second keeps
// the PC's Prime Video on the jam's playhead through Windows' media controls
// (smtc.ps1). Play, pause and skips made in Prime Video on the PC go to the jam.
// Same rules as the TV: everyone waits while this PC plays an ad, nothing seeks
// until Prime reports a position, and no automatic jump is bigger than 5 minutes.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
// The phone link on the Invite screen (…/m?code=K7QF&as=<id>&t=<token>) has everything needed.
const link = arg('link') ? new URL(arg('link')) : null;
const SERVER = arg('server', link?.origin ?? 'https://d12le9d1o14nhz.cloudfront.net');
const USER = arg('as', link?.searchParams.get('as'));
const TOKEN = arg('token', link?.searchParams.get('t'));
if (!USER || !TOKEN) {
  console.error('usage: node bridge.mjs --link "<phone link from the Invite screen>"   (or --server <url> --as <userId> --token <token>)');
  process.exit(1);
}

const MAX_DRIFT = 2; // seconds; Prime can't change speed, so small drift is left alone
const MAX_AUTO_SEEK = 300;
const COMMAND_GRACE = 2500;
const LOCAL_SEEK = 5;

// ---------- Windows media controls ----------
const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(fileURLToPath(import.meta.url)), 'smtc.ps1')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const replies = [];
createInterface({ input: ps.stdout }).on('line', (l) => replies.shift()?.(JSON.parse(l)));
const smtc = (cmd) => new Promise((resolve) => (replies.push(resolve), ps.stdin.write(cmd + '\n')));

// ---------- FireJam ----------
const s = io(SERVER, { transports: ['websocket'] });
let me = null;
let world = { users: [], jams: [] };
let offset = 0; // server clock - local clock
s.on('connect', () => {
  s.emit('hello', { userId: USER, token: TOKEN }, (r) => r.data?.needsProfile && (console.error('unknown user or wrong token', USER), process.exit(1)));
  const t0 = Date.now();
  s.emit('time', (ts) => (offset = ts - (t0 + Date.now()) / 2));
});
s.on('session', (x) => ((me = x.me), (world = x.world), console.log(`signed in as ${x.me.user.name}`)));
s.on('me', (m) => (me = m));
s.on('world', (w) => (world = w));
s.on('chat', (c) => console.log(`💬 ${world.users.find((u) => u.id === c.from)?.name}: ${c.text}`));
s.on('reaction', (r) => console.log(`${world.users.find((u) => u.id === r.from)?.name} ${r.emoji}`));

const myJam = () => world.jams.find((j) => j.members.includes(USER));
const expected = (j) => (j.playing ? j.position + (Date.now() + offset - j.updatedAt) / 1000 : j.position);
const control = (kind, position) => s.emit('jam:control', kind === 'seek' ? { kind, position } : { kind });

let seen = null;
let lastCommandAt = 0;
let lastSeekAt = 0;
let trusted = false;
let adHold = false;
let holdUntil = 0;
let lastLine = '';
const command = async (cmd) => {
  lastCommandAt = Date.now();
  await smtc(cmd);
};
const say = (line) => line !== lastLine && console.log((lastLine = line));

async function tick() {
  const j = myJam();
  const p = await smtc('state');
  if (!j) return say('not in a jam: join one on FireJam (TV, phone or browser)');
  if (!p.found) return say('waiting: start the title in the Prime Video app on this PC');
  const now = Date.now();
  const playing = p.status === 'Playing';
  const settled = playing || p.status === 'Paused';
  if (p.position > 0) trusted = true;
  const exp = expected(j);

  // Ad hold: the jam waits for this PC's ad, then carries on from here.
  const inAd = playing && p.position === 0;
  if (inAd && j.playing && !adHold && now - lastCommandAt > COMMAND_GRACE) {
    adHold = true;
    control('pause');
    return say('📺 ad on this PC: the jam waits');
  }
  if (adHold) {
    if (inAd || !playing) return;
    adHold = false;
    control('seek', p.position);
    control('play');
    return say(`▶ back to ${p.title}: jam carries on from ${clock(p.position)}`);
  }

  // Someone used Prime Video on this PC: the jam follows.
  const prev = seen;
  seen = { playing, position: p.position, at: now };
  if (prev && settled && now - lastCommandAt > COMMAND_GRACE) {
    if (prev.playing !== playing && playing !== j.playing) {
      holdUntil = now + 3000;
      control(playing ? 'play' : 'pause', p.position);
      return say(`${playing ? '▶' : '⏸'} from this PC`);
    }
    const predicted = prev.position + (prev.playing ? (now - prev.at) / 1000 : 0);
    if (trusted && Math.abs(p.position - predicted) > LOCAL_SEEK && Math.abs(p.position - exp) > LOCAL_SEEK) {
      holdUntil = now + 3000;
      control('seek', p.position);
      return say(`⏩ skip from this PC to ${clock(p.position)}`);
    }
  }
  if (now < holdUntil) return;

  // Otherwise Prime Video follows the jam.
  if (j.playing && !playing && settled) await command('play');
  if (!j.playing && playing) await command('pause');
  const drift = p.position - exp;
  if (!trusted) return say(`play/pause linked (Prime hasn't shared a position yet) · jam at ${clock(exp)}`);
  if (Math.abs(drift) > MAX_AUTO_SEEK) return say(`jam is at ${clock(exp)}, Prime here at ${clock(p.position)}: skip there to line up`);
  if (Math.abs(drift) > MAX_DRIFT && now - lastSeekAt > 6000 && settled) {
    lastSeekAt = now;
    await command(`seek ${Math.max(0, exp + (j.playing ? 1.5 : 0)).toFixed(2)}`);
    return say(`lining up: ${drift > 0 ? 'ahead' : 'behind'} by ${Math.abs(drift).toFixed(1)}s`);
  }
  say(`${j.playing ? 'in sync' : 'paused'} · ${p.title} · ${clock(p.position)} (drift ${drift.toFixed(1)}s)`);
}

function clock(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

let busy = false;
setInterval(async () => {
  if (busy || !me) return;
  busy = true;
  try {
    await tick();
  } catch (e) {
    say(`error: ${e.message}`);
  } finally {
    busy = false;
  }
}, 1000);
