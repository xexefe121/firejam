import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { SERVICE_NAME } from '../../shared/playhead.ts';
import type { Ack, JamPrivacy, Media, Service } from '../../shared/protocol.ts';
import { BOT_IDS, FEATURED_BOTS, makeBotHooks, seedBots } from './bots.ts';
import { CATALOG, MEDIA_DIR, mediaById } from './catalog.ts';
import { Hub, type IO, type Sock, tokenMatches } from './hub.ts';
import { PLACES, placeById, placeForTz } from './places.ts';
import { pickForUs } from './pick.ts';
import { load, scheduleSave } from './store.ts';

// FIREJAM_PORT, not PORT: dev tooling sets PORT for the Vite server.
const PORT = Number(process.env.FIREJAM_PORT ?? 3000);
const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const PRIVACIES: JamPrivacy[] = ['public', 'friends', 'invite'];
const services = (v: unknown): Service[] => (Array.isArray(v) ? v.filter((x): x is Service => x in SERVICE_NAME) : []);
const needs = (m: Media) => `${m.title} plays in ${SERVICE_NAME[m.provider as Service]}. Turn it on in your profile if you have it.`;

// A failed side call (e.g. Bedrock or AWS config lookup) must never take the jam server down.
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));

const app = express();
const http = createServer(app);
const io: IO = new Server(http, { cors: { origin: true } });

const hub = new Hub(io);
seedBots(hub);
load(hub);
hub.bots = makeBotHooks(hub);
hub.onPersist = () => scheduleSave(hub);

// A Fire TV reports what it's playing outside FireJam (android/…/ActivityReporter.kt).
app.post('/api/activity', express.json({ limit: '4kb' }), (req, res) => {
  res.status(hub.reportActivity(req.body ?? {}) ? 204 : 403).end();
});

// The Fire TV app polls this while Prime Video is in front, when its web view can't keep a socket.
app.get('/api/tv/jam', (req, res) => {
  const u = hub.authed(req.query.userId, req.query.token);
  if (!u) return res.status(403).end();
  res.json(hub.tvPoll(u, Number(req.query.since) || 0));
});
// Polled by the Fire TV in the background so friends' "now watching" can pop up over any app.
app.get('/api/tv/inbox', (req, res) => {
  const u = hub.authed(req.query.userId, req.query.token);
  if (!u) return res.status(403).end();
  res.json(hub.tvInbox(u, Number(req.query.since) || 0));
});
app.post('/api/tv/control', express.json({ limit: '2kb' }), (req, res) => {
  const u = hub.authed(req.body?.userId, req.body?.token);
  if (!u) return res.status(403).end();
  const kind = String(req.body.kind);
  if (kind !== 'play' && kind !== 'pause' && kind !== 'seek') return res.status(400).end();
  hub.control(u.id, { kind, position: Number(req.body.position) || 0 });
  res.status(204).end();
});

app.get('/api/info', (_req, res) => {
  res.json({ lanIp: lanIp(), port: PORT, catalog: CATALOG.length });
});
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1d' }));
// "Get FireJam": install instructions for any TV, and the Android TV / Fire TV app itself.
app.get(['/get', '/install'], (_req, res) => res.redirect('/get.html'));
// Shareable jam invites: the QR on a host's TV points at /j/<code>, a page that works on any phone.
app.get('/api/jam/:code', (req, res) => {
  const jam = hub.jamByCode(String(req.params.code));
  const media = jam && mediaById(jam.mediaId);
  if (!jam || !media) return res.status(404).json({ error: 'No jam with that code' });
  res.json({
    code: jam.code,
    name: jam.name,
    host: hub.users.get(jam.hostId)?.name ?? null,
    title: media.title,
    service: media.provider === 'firejam' ? null : SERVICE_NAME[media.provider],
    watching: jam.members.length,
  });
});
app.get('/j/:code', (_req, res) => res.sendFile(path.join(WEB_DIST, 'join.html')));

if (existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      index: false,
      maxAge: '1h',
      // Vite fingerprints everything in assets/, so TVs keep those for good and start without re-checking.
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get(/^\/(?!api|media|socket\.io|firejam\.apk).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

io.on('connection', (sock: Sock) => {
  const me = () => (sock.data.userId ? hub.users.get(sock.data.userId) : undefined);
  const companion = () => !!sock.data.companion;
  const sendSession = () => {
    const u = me();
    if (u) sock.emit('session', { me: hub.meFor(u), world: hub.worldFor(u), catalog: CATALOG, places: PLACES });
  };

  sock.on('time', (ack) => typeof ack === 'function' && ack(Date.now()));

  sock.on('profile:list', (opts, ack) => {
    const deviceId = typeof opts?.deviceId === 'string' ? opts.deviceId : '';
    const real = [...hub.users.values()].filter((u) => !u.isBot).sort((a, b) => b.lastSeen - a.lastSeen);
    // A TV only offers the profiles bound to it; a browser only the ones it holds tokens for, plus demo people.
    const mine = Array.isArray(opts?.mine) ? opts.mine.slice(0, 20) : [];
    const list = deviceId
      ? real.filter((u) => u.devices.has(deviceId))
      : [
          ...real.filter((u) => mine.some((m) => m?.id === u.id && tokenMatches(u, m.token))),
          ...FEATURED_BOTS.map((id) => hub.users.get(id)!),
        ];
    ack({ ok: true, data: list.map((u) => hub.publicUser(u, u)) });
  });

  sock.on('profile:tv', (opts, ack) => {
    const deviceId = String(opts?.deviceId ?? '').slice(0, 64);
    const tvProfile = String(opts?.tvProfile ?? '').slice(0, 64);
    if (!deviceId || !tvProfile) return ack({ ok: true, data: { linked: null, claimed: [] } });
    ack({ ok: true, data: hub.tvProfileInfo(deviceId, tvProfile) });
  });

  sock.on('hello', (msg, ack) => {
    const user = msg?.userId ? hub.users.get(msg.userId) : undefined;
    if (!user) return ack({ ok: true, data: { needsProfile: true } });
    // Knowing someone's id (everyone on the map does) isn't enough to be them: it takes the profile's
    // secret token, or a TV the profile is bound to. Demo people are open to anyone, for laptop demos.
    const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId.slice(0, 64) : '';
    const boundTv = !msg.companion && !!deviceId && user.devices.has(deviceId);
    if (!user.isBot && !tokenMatches(user, msg.token) && !boundTv) return ack({ ok: true, data: { needsProfile: true } });
    if (msg.deviceId && !msg.companion && !user.devices.has(msg.deviceId)) {
      user.devices.add(String(msg.deviceId).slice(0, 64));
      scheduleSave(hub);
    }
    if (msg.deviceId && msg.tvProfile && !msg.companion && !user.isBot) {
      if (hub.linkTvProfile(user, String(msg.deviceId).slice(0, 64), String(msg.tvProfile).slice(0, 64))) scheduleSave(hub);
    }
    hub.attach(sock, user, !!msg.companion);
    sendSession();
    ack({ ok: true, data: { needsProfile: false } });
  });

  sock.on('profile:create', (msg, ack) => {
    const name = String(msg?.name ?? '').trim().slice(0, 20);
    if (!name) return ack({ ok: false, error: 'Pick a name' });
    const placeId = msg.placeId && PLACES.some((p) => p.id === msg.placeId) ? msg.placeId : placeForTz(msg.tz).id;
    const user = hub.createUser(name, placeId, {
      services: new Set(services(msg.services)),
      devices: new Set(msg.deviceId ? [String(msg.deviceId).slice(0, 64)] : []),
    });
    if (msg.deviceId && msg.tvProfile) hub.linkTvProfile(user, String(msg.deviceId).slice(0, 64), String(msg.tvProfile).slice(0, 64));
    hub.bots?.onProfileCreated(user);
    hub.attach(sock, user, false);
    scheduleSave(hub);
    sendSession();
    ack({ ok: true, data: { userId: user.id, token: user.token } });
  });

  // Everything below needs a signed-in screen.
  const guard =
    <A extends unknown[]>(fn: (userId: string, ...args: A) => void, allowCompanion = false) =>
    (...args: A) => {
      const u = me();
      if (u && (allowCompanion || !companion())) fn(u.id, ...args);
    };

  sock.on('ghost:set', guard((id, on: boolean) => hub.setGhost(id, !!on)));
  sock.on('profile:services', guard((id, list: Service[]) => hub.setServices(id, services(list))));
  sock.on('profile:share', guard((id, on: boolean) => hub.setShare(id, !!on)));
  sock.on('profile:name', guard((id, name: string, ack: Ack) => {
    const r = hub.rename(id, name);
    if (typeof ack === 'function') ack(r);
  }));
  sock.on('friend:request', guard((id, to: string) => hub.requestFriend(id, to)));
  sock.on('friend:respond', guard((id, from: string, accept: boolean) => hub.respondFriend(id, from, !!accept)));
  sock.on('friend:remove', guard((id, other: string) => hub.removeFriend(id, other)));

  sock.on('jam:create', (msg, ack) => {
    const u = me();
    if (!u || companion()) return ack({ ok: false, error: 'Not signed in' });
    const media = mediaById(msg?.mediaId);
    if (!media) return ack({ ok: false, error: 'Unknown title' });
    if (!hub.canWatch(u, media)) return ack({ ok: false, error: needs(media) });
    const privacy = PRIVACIES.includes(msg.privacy) ? msg.privacy : 'friends';
    // "Watch together" from a friend's activity starts where they are and invites them.
    const startAt = Math.max(0, Number(msg.startAt) || 0);
    const jam = hub.createJam(u.id, msg.mediaId, privacy, {
      ...(startAt ? { position: startAt } : {}),
      ...(msg.paused ? { playing: false } : {}),
    });
    if (msg.invite) hub.invite(u.id, String(msg.invite));
    ack({ ok: true, data: { jamId: jam.id } });
  });

  sock.on('jam:join', (jamId, ack) => {
    const u = me();
    if (!u || companion()) return ack({ ok: false, error: 'Not signed in' });
    const status = hub.join(u.id, String(jamId));
    if (status === 'missing') return ack({ ok: false, error: 'That jam has ended' });
    if (status === 'needs-service') return ack({ ok: false, error: needs(mediaById(hub.jams.get(String(jamId))!.mediaId)!) });
    ack({ ok: true, data: { status } });
  });

  sock.on('jam:join-code', (code, ack) => {
    const u = me();
    if (!u || companion()) return ack({ ok: false, error: 'Not signed in' });
    const res = hub.joinByCode(u.id, String(code ?? ''));
    if (!res || res.status === 'missing') return ack({ ok: false, error: 'No jam with that code' });
    if (res.status === 'needs-service') return ack({ ok: false, error: needs(mediaById(hub.jams.get(res.jamId)!.mediaId)!) });
    ack({ ok: true, data: { status: res.status, jamId: res.jamId } });
  });

  sock.on('jam:pick', async (ack) => {
    const u = me();
    if (!u) return ack({ ok: false, error: 'Not signed in' });
    const jam = hub.jamOf(u.id);
    const people = (jam ? jam.members : [u.id]).map((id) => hub.users.get(id)!).filter(Boolean);
    // Only titles everyone in the room can watch (a Prime title needs everyone on Prime).
    const options = CATALOG.filter((m) => people.every((p) => hub.canWatch(p, m)));
    const pick = await pickForUs(
      people.map((p) => ({ name: p.name, place: placeById(p.placeId), recent: p.history })),
      options,
      jam?.mediaId,
    );
    ack({ ok: true, data: pick });
  });

  sock.on('jam:leave', guard((id) => hub.leaveJam(id)));
  sock.on('jam:invite', guard((id, to: string) => hub.invite(id, to)));
  sock.on('jam:privacy', guard((id, p: JamPrivacy) => PRIVACIES.includes(p) && hub.setPrivacy(id, p)));
  sock.on('prompt:answer', guard((id, promptId: string, accept: boolean) => hub.answerPrompt(id, promptId, !!accept)));

  // Phones paired to a TV can drive playback, react and chat as that viewer.
  sock.on('jam:control', guard((id, msg) => hub.control(id, msg), true));
  const recent: number[] = [];
  sock.on(
    'jam:react',
    guard((id, emoji: string) => {
      const now = Date.now();
      while (recent.length && now - recent[0] > 2000) recent.shift();
      if (recent.length >= 8) return;
      recent.push(now);
      hub.react(id, emoji);
    }, true),
  );
  sock.on('jam:chat', guard((id, text: string) => hub.chat(id, text), true));

  sock.on('disconnect', () => hub.detach(sock));
});

http.listen(PORT, () => {
  console.log(`FireJam server on http://localhost:${PORT}  (LAN: http://${lanIp()}:${PORT})`);
  console.log(`  ${BOT_IDS.size} demo people, ${hub.jams.size} live jams, ${CATALOG.length} titles`);
});

function lanIp(): string {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
  return candidates.find((a) => a.startsWith('192.168.')) ?? candidates.find((a) => a.startsWith('10.')) ?? candidates[0] ?? 'localhost';
}
