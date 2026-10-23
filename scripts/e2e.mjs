// End-to-end check of the realtime protocol: boots a throwaway server, connects
// two viewers, and walks through friends, an invite-only knock, and shared playback.
// Run: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const PORT = 3199;
const dataDir = mkdtempSync(path.join(tmpdir(), 'firejam-e2e-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '../server'),
  env: { ...process.env, FIREJAM_PORT: String(PORT), FIREJAM_DATA_DIR: dataDir },
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('FireJam server') && resolve());
  server.on('exit', (code) => reject(new Error(`server exited (${code})`)));
});

function client(name, placeId, services = []) {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const c = { s, world: null, me: null, events: [] };
  s.on('world', (w) => (c.world = w));
  s.on('me', (m) => (c.me = m));
  s.on('session', (x) => ((c.world = x.world), (c.me = x.me)));
  for (const ev of ['toast', 'prompt', 'jam:entered', 'jam:left', 'reaction', 'chat']) s.on(ev, (p) => c.events.push([ev, p]));
  c.ack = (ev, ...args) => new Promise((r) => s.emit(ev, ...args, r));
  c.ready = (async () => {
    await new Promise((r) => s.on('connect', r));
    await c.ack('hello', {});
    const res = await c.ack('profile:create', { name, placeId, services, deviceId: `tv-${name}` });
    c.id = res.data.userId;
  })();
  return c;
}

const until = async (what, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const step = (name) => console.log(`✓ ${name}`);
const myJam = (c) => c.world.jams.find((j) => j.members.includes(c.id));

let failed = false;
try {
  const a = client('Rafi', 'sydney');
  const b = client('Ma', 'dhaka');
  await Promise.all([a.ready, b.ready]);
  step('two profiles created and connected');

  assert.ok(a.me.friends.includes('ammu'), 'new profiles start with the demo friends');
  const onTv = await a.ack('profile:list', { deviceId: 'tv-Rafi' });
  assert.deepEqual(onTv.data.map((u) => u.name), ['Rafi'], 'a TV only offers the profiles made on it');
  const auto = client('Dhanusha', undefined, ['prime']);
  await auto.ready;
  assert.equal(auto.me.user.place.city, 'Sydney');
  const tz = await new Promise((r) => auto.s.emit('profile:create', { name: 'Ana', tz: 'Asia/Dhaka', services: [] }, r));
  assert.ok(tz.ok);
  auto.s.close();
  step('profiles are tied to their TV; city comes from the TV time zone');

  // Fire TV profiles: each one signs in as the FireJam profile last used with it.
  const tvSock = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => tvSock.on('connect', r));
  const tvAck = (ev, ...args) => new Promise((r) => tvSock.emit(ev, ...args, r));
  const dev = { deviceId: 'tv-Rafi' };
  await tvAck('hello', { userId: a.id, ...dev, tvProfile: 'fire-1' });
  assert.deepEqual((await tvAck('profile:tv', { ...dev, tvProfile: 'fire-1' })).data, { linked: a.id, claimed: [a.id] });
  assert.equal((await tvAck('profile:tv', { ...dev, tvProfile: 'fire-2' })).data.linked, null, 'a new Fire TV profile is not linked');
  const sammo = (await tvAck('profile:create', { name: 'Sammo', tz: 'Australia/Sydney', services: [], ...dev, tvProfile: 'fire-2' })).data.userId;
  let tv2 = (await tvAck('profile:tv', { ...dev, tvProfile: 'fire-2' })).data;
  assert.equal(tv2.linked, sammo, 'a profile made on a Fire TV profile belongs to it');
  assert.deepEqual(tv2.claimed.sort(), [a.id, sammo].sort());
  await tvAck('hello', { userId: a.id, ...dev, tvProfile: 'fire-2' });
  tv2 = (await tvAck('profile:tv', { ...dev, tvProfile: 'fire-2' })).data;
  assert.equal(tv2.linked, a.id, 'picking someone else on a Fire TV profile moves the link');
  assert.equal((await tvAck('profile:tv', { ...dev, tvProfile: 'fire-1' })).data.linked, a.id, 'one person can use two Fire TV profiles');
  tvSock.close();
  step('Fire TV profiles each remember their FireJam profile');

  // Signing in as someone takes their token or a TV they're bound to; knowing their id isn't enough.
  const spy = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => spy.on('connect', r));
  const spyAck = (ev, ...args) => new Promise((r) => spy.emit(ev, ...args, r));
  let spySession = false;
  spy.on('session', () => (spySession = true));
  const refused = async (msg, why) => assert.equal((await spyAck('hello', msg)).data.needsProfile, true, why);
  await refused({ userId: a.id }, 'an id alone is refused');
  await refused({ userId: a.id, token: 'not-the-token' }, 'a wrong token is refused');
  await refused({ userId: a.id, deviceId: 'tv-Mallory' }, 'an unknown TV is refused');
  await refused({ userId: a.id, deviceId: 'tv-Rafi', companion: true }, "a phone can't borrow a TV's binding");
  assert.equal(spySession, false, 'no session sent to a refused screen');
  assert.deepEqual((await spyAck('profile:list', { deviceId: 'tv-Mallory' })).data, [], 'a refused TV was not bound');
  const browserList = (await spyAck('profile:list', {})).data.map((u) => u.id);
  assert.ok(!browserList.includes(a.id) && browserList.includes('ammu'), 'browsers only see demo people');
  const withToken = (await spyAck('profile:list', { mine: [{ id: a.id, token: a.me.token }] })).data.map((u) => u.id);
  assert.ok(withToken.includes(a.id), "a browser sees profiles it holds the token for");
  assert.equal((await spyAck('hello', { userId: a.id, token: a.me.token })).data.needsProfile, false, 'the right token signs in');
  await until('spy session', () => spySession);
  spy.close();
  const demo = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => demo.on('connect', r));
  assert.equal((await new Promise((r) => demo.emit('hello', { userId: 'ammu' }, r))).data.needsProfile, false, 'demo people stay open');
  demo.close();
  const made = await new Promise((r) => {
    const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    s.on('connect', () => s.emit('profile:create', { name: 'Tok', tz: 'Australia/Sydney', services: [] }, (res) => (s.close(), r(res))));
  });
  assert.ok(made.ok && typeof made.data.token === 'string' && made.data.token.length >= 16, 'new profiles get their token');
  step('signing in needs the profile token or a bound TV');

  const renamed = await a.ack('profile:name', '  Ela  ');
  assert.ok(renamed.ok);
  await until('friends see the new name', () => b.world.users.find((u) => u.id === a.id)?.name === 'Ela');
  assert.equal((await a.ack('profile:name', '   ')).ok, false, 'an empty name is refused');
  await a.ack('profile:name', 'Rafi');
  step('renaming a profile reaches friends');

  // Starting a jam to share first: it waits at 0 until the host plays, and its code has a join page.
  await a.ack('jam:create', { mediaId: 'sintel', privacy: 'public', paused: true });
  const shared = await until('shared jam', () => myJam(a));
  assert.equal(shared.playing, false, 'a jam started to share waits for the host');
  const info = await (await fetch(`http://localhost:${PORT}/api/jam/${shared.code.toLowerCase()}`)).json();
  assert.equal(info.title, 'Sintel');
  assert.equal(info.name, shared.name);
  assert.equal((await fetch(`http://localhost:${PORT}/api/jam/ZZZZ`)).status, 404);
  a.s.emit('jam:leave');
  step('a new jam can wait while the invite is shared, and its code has a join page');

  assert.ok(a.world.jams.some((j) => j.privacy === 'public'), 'seeded public jams are visible');
  step('starter friends and seeded jams present');

  a.s.emit('friend:request', b.id);
  await until('friend request toast', () => b.events.find(([e, p]) => e === 'toast' && p.kind === 'friend-request' && p.from === a.id));
  b.s.emit('friend:respond', a.id, true);
  await until('friendship', () => a.me.friends.includes(b.id) && b.me.friends.includes(a.id));
  step('friend request sent, toasted, accepted');

  const created = await b.ack('jam:create', { mediaId: 'sintel', privacy: 'invite' });
  assert.ok(created.ok);
  const jamId = created.data.jamId;
  await until('jam visible to friend', () => a.world.jams.find((j) => j.id === jamId));
  const joined = await a.ack('jam:join', jamId);
  assert.equal(joined.data.status, 'requested', 'invite-only jams make friends knock');
  const [, prompt] = await until('join prompt for host', () => b.events.find(([e, p]) => e === 'prompt' && p.kind === 'join-request'));
  b.s.emit('prompt:answer', prompt.id, true);
  await until('requester enters', () => a.events.find(([e, id]) => e === 'jam:entered' && id === jamId));
  await until('both members', () => myJam(a)?.members.length === 2);
  step('invite-only knock, host prompt, accepted');

  a.s.emit('jam:control', { kind: 'pause' });
  await until('pause seen by host', () => myJam(b)?.playing === false && myJam(b).lastAction?.by === a.id);
  b.s.emit('jam:control', { kind: 'seek', position: 120 });
  await until('seek seen by guest', () => myJam(a)?.position === 120);
  b.s.emit('jam:control', { kind: 'play' });
  await until('play seen by guest', () => myJam(a)?.playing === true);
  await until('control toast names who did it', () =>
    a.events.find(([e, p]) => e === 'toast' && p.kind === 'jam-control' && p.by === b.id && p.control === 'seek'),
  );
  step('pause / seek / play shared, attributed to the right person');

  const clock = await new Promise((r) => a.s.emit('time', r));
  assert.ok(Math.abs(clock - Date.now()) < 1000, 'server clock reachable');
  a.s.emit('jam:react', '❤️');
  a.s.emit('jam:chat', 'Have you eaten yet?');
  await until('reaction', () => b.events.find(([e, p]) => e === 'reaction' && p.emoji === '❤️'));
  await until('chat', () => b.events.find(([e, p]) => e === 'chat' && p.text === 'Have you eaten yet?'));
  a.s.emit('jam:react', '<script>');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!b.events.some(([e, p]) => e === 'reaction' && p.emoji === '<script>'), 'only whitelisted reactions');
  step('reactions and chat reach the room; unknown reactions dropped');

  b.s.emit('jam:leave');
  await until('host handed over', () => myJam(a)?.hostId === a.id && myJam(a).members.length === 1);
  step('host leaves, jam continues with a new host');

  // Prime Video: a Prime title is only open to jams where everyone has Prime.
  const p = client('Mum', 'dhaka', ['prime']);
  const q = client('Sam', 'london', ['prime']);
  await Promise.all([p.ready, q.ready]);
  for (const [x, y] of [[p, a], [p, q]]) {
    x.s.emit('friend:request', y.id);
    await until('request', () => y.me?.incoming.includes(x.id));
    y.s.emit('friend:respond', x.id, true);
    await until('friends', () => x.me.friends.includes(y.id));
  }
  const noPrime = await a.ack('jam:create', { mediaId: 'prime-reacher', privacy: 'friends' });
  assert.equal(noPrime.ok, false, 'no Prime, no Prime jam');
  const primeJam = await p.ack('jam:create', { mediaId: 'prime-reacher', privacy: 'friends' });
  assert.ok(primeJam.ok, 'Prime member starts a Prime jam');
  await until('prime jam visible', () => a.world.jams.find((j) => j.id === primeJam.data.jamId));
  const blocked = await a.ack('jam:join', primeJam.data.jamId);
  assert.equal(blocked.ok, false, 'friend without Prime is turned away');
  assert.match(blocked.error, /Prime Video/);
  const both = await q.ack('jam:join', primeJam.data.jamId);
  assert.equal(both.data.status, 'joined', 'friend with Prime walks in');
  p.s.emit('jam:invite', a.id);
  await until('inviter told why', () => p.events.find(([e, t]) => e === 'toast' && t.kind === 'info' && /doesn't have Prime Video/.test(t.text)));
  assert.ok(!a.events.some(([e, x]) => e === 'prompt' && x.kind === 'invite' && x.jamId === primeJam.data.jamId), 'no invite reaches them');
  step('Prime jams: only people with Prime can start, join or be invited');

  q.s.emit('jam:control', { kind: 'seek', position: 4000 });
  await until('no clamp past estimated runtime', () => myJam(p)?.position === 4000);
  step('Prime playhead is never clamped to an estimated runtime');

  // Switching a jam to a Prime title needs everyone in it to have Prime.
  const mixed = await a.ack('jam:create', { mediaId: 'sintel', privacy: 'friends' });
  await a.ack('jam:join', mixed.data.jamId);
  await p.ack('jam:join', mixed.data.jamId);
  await until('mixed jam', () => myJam(a)?.members.length === 2);
  p.s.emit('jam:control', { kind: 'media', mediaId: 'prime-fallout' });
  await until('switch refused with reason', () => p.events.find(([e, t]) => e === 'toast' && /can't switch to Fallout/.test(t.text ?? '')));
  assert.equal(myJam(a).mediaId, 'sintel');
  a.s.emit('profile:services', ['prime']);
  await until('Rafi now has Prime', () => a.me.user.services.includes('prime'));
  p.s.emit('jam:control', { kind: 'media', mediaId: 'prime-fallout' });
  await until('switch allowed once everyone has Prime', () => myJam(a)?.mediaId === 'prime-fallout');
  a.s.emit('profile:services', []);
  await until('dropping Prime leaves the Prime jam', () => !myJam(a));
  step('switching to Prime needs everyone on Prime; dropping Prime leaves the jam');

  // Friend activity: anyone (Prime or not) sees what friends watch and watched.
  const post = (body) =>
    fetch(`http://localhost:${PORT}/api/activity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ userId: q.id, token: 'wrong', title: 'Reacher' })).status, 403, 'activity needs the TV token');
  q.s.emit('jam:leave');
  await until('Sam out of jam', () => !myJam(q));
  assert.equal(
    (await post({ userId: q.id, token: q.me.token, package: 'com.amazon.amazonvideo.livingroom', app: 'Prime Video', title: 'Reacher', playing: true, position: 600 })).status,
    204,
  );
  const seen = await until('friend sees what Sam watches on Prime', () => p.world.users.find((u) => u.id === q.id)?.nowPlaying);
  assert.equal(seen.app, 'Prime Video');
  assert.equal(seen.mediaId, 'prime-reacher', 'matched to the catalogue so friends can watch together');
  assert.equal(a.world.users.find((u) => u.id === q.id)?.nowPlaying ?? null, null, 'strangers see nothing');
  await post({ userId: q.id, token: q.me.token, package: 'com.google.android.youtube.tv', app: 'YouTube', title: 'Lo-fi Beats', playing: true, position: 30 });
  await until('non-Prime apps show too', () => p.world.users.find((u) => u.id === q.id)?.nowPlaying?.app === 'YouTube');
  assert.equal(p.world.users.find((u) => u.id === q.id).nowPlaying.mediaId, null, 'but only service titles can be jammed');
  await post({ userId: q.id, token: q.me.token, package: 'com.amazon.firebat', app: 'Prime Video', title: '', playing: true, position: 0 });
  await until('untitled Prime still shows as watching Prime Video', () => {
    const np = p.world.users.find((u) => u.id === q.id)?.nowPlaying;
    return np && np.app === 'Prime Video' && np.title === '' && np.mediaId === null;
  });
  step('Fire TV activity reports: token checked, friends only, any app shown, Prime titles matched');

  const together = await p.ack('jam:create', { mediaId: 'prime-reacher', privacy: 'friends', startAt: 600, invite: q.id });
  assert.ok(together.ok);
  await until('watch together starts at their spot', () => myJam(p)?.position === 600);
  await until('and invites them', () => q.events.find(([e, x]) => e === 'prompt' && x.kind === 'invite' && x.jamId === together.data.jamId));
  step('watch together starts a Prime jam at the friend\'s position and invites them');

  // The Fire TV app behind Prime Video: polls over HTTP, drives the jam, stays present.
  const tv = (path, init) => fetch(`http://localhost:${PORT}${path}`, init);
  assert.equal((await tv(`/api/tv/jam?userId=${p.id}&token=nope`)).status, 403, 'TV link needs the token');
  const first = await (await tv(`/api/tv/jam?userId=${p.id}&token=${p.me.token}&since=0`)).json();
  assert.equal(first.jam.id, together.data.jamId);
  assert.equal(first.media.provider, 'prime');
  q.s.emit('jam:join', together.data.jamId, () => {});
  await until('Sam back in', () => myJam(p)?.members.includes(q.id));
  q.s.emit('jam:react', '🔥');
  q.s.emit('jam:control', { kind: 'pause' });
  await until('pause seen', () => myJam(p)?.playing === false);
  const next = await (await tv(`/api/tv/jam?userId=${p.id}&token=${p.me.token}&since=${first.cursor}`)).json();
  assert.ok(next.feed.some((f) => f.kind === 'reaction' && f.emoji === '🔥' && f.from === q.id), 'feed carries reactions for bubbles');
  assert.ok(next.feed.some((f) => f.kind === 'control' && f.control === 'pause'), 'and who paused');
  assert.equal(next.people[q.id].name, 'Sam');
  const res = await tv('/api/tv/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: p.id, token: p.me.token, kind: 'play', position: 0 }),
  });
  assert.equal(res.status, 204);
  await until('remote press on the TV drives the jam', () => myJam(q)?.playing === true && myJam(q).lastAction.by === p.id);
  step('TV link: token checked, jam + server clock + feed polled, remote presses drive the jam');

  // Friend alerts: starting something pops up for friends (toast + TV inbox).
  const before = await (await tv(`/api/tv/inbox?userId=${a.id}&token=${a.me.token}&since=0`)).json();
  const started = await p.ack('jam:create', { mediaId: 'bbb', privacy: 'friends' });
  assert.ok(started.ok);
  await until('friend toast', () => a.events.find(([e, t]) => e === 'toast' && t.kind === 'friend-watching' && t.from === p.id && t.title === 'Big Buck Bunny'));
  const inbox = await (await tv(`/api/tv/inbox?userId=${a.id}&token=${a.me.token}&since=${before.cursor}`)).json();
  assert.ok(inbox.items.some((i) => i.name === 'Mum' && i.title === 'Big Buck Bunny' && i.jamId === started.data.jamId), 'TV inbox has the alert');
  step('friend starts watching: toast on open screens, alert in the TV inbox');

  // Pick for us (Amazon Bedrock, or the time-of-day fallback when Bedrock isn't reachable).
  const pick = await p.ack('jam:pick');
  assert.ok(pick.ok && pick.data.mediaId && pick.data.reason, 'pick returns a title and a reason');
  assert.ok(['bedrock', 'fallback'].includes(pick.data.by));
  step(`pick for us answers (${pick.data.by}): ${pick.data.reason}`);

  q.s.emit('profile:share', false);
  await until('sharing off hides activity', () => {
    const u = p.world.users.find((x) => x.id === q.id);
    return u && u.nowPlaying === null && u.recent.length === 0;
  });
  step('turning sharing off hides now-playing and history from friends');
  for (const c of [p, q]) c.s.close();

  a.s.close();
  b.s.close();
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
