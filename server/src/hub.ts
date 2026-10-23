import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServer,
  ControlMsg,
  Jam,
  JamId,
  JamPrivacy,
  MeState,
  ActivityReport,
  HistoryEntry,
  Media,
  NowPlaying,
  PublicUser,
  Prompt,
  ServerToClient,
  Service,
  Toast,
  UserId,
  WorldSnapshot,
} from '../../shared/protocol.ts';
import { canWatch, positionAt, SERVICE_NAME } from '../../shared/playhead.ts';
import { CATALOG, mediaById, serviceTitle } from './catalog.ts';
import { placeById, PLACES } from './places.ts';

export interface SocketData {
  userId?: UserId;
  companion?: boolean;
}
export type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;
export type IO = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

export interface UserRec {
  id: UserId;
  name: string;
  color: string;
  placeId: string;
  isBot: boolean;
  ghost: boolean;
  friends: Set<UserId>;
  incoming: Set<UserId>;
  outgoing: Set<UserId>;
  lastSeen: number;
  createdAt: number;
  /** Bots are "online" on their own; real users are online while a TV/browser is connected. */
  botOnline: boolean;
  pendingJoin: JamId | null;
  /** Services this person says they have (e.g. Prime Video). Gates which jams they can be in. */
  services: Set<Service>;
  shareActivity: boolean;
  /** Secret the person's Fire TV uses to report what it's playing outside FireJam. */
  token: string;
  /** What their TV is playing outside FireJam, if anything. */
  nowPlaying: NowPlaying | null;
  /** Most recent first. */
  history: HistoryEntry[];
  /** Fire TVs this profile has been used on. */
  devices: Set<string>;
  /** Fire TV profiles that sign in as this person, as `<deviceId>:<tvProfile>`. */
  tvProfiles: Set<string>;
  /** Last time this person's Fire TV app checked in natively (while Prime Video is in front). */
  nativeSeenAt: number;
}

/** What happened in a jam, for screens that poll instead of holding a socket (the Fire TV app behind Prime Video). */
export type FeedItem =
  | { id: number; at: number; kind: 'reaction'; from: UserId; emoji: string }
  | { id: number; at: number; kind: 'chat'; from: UserId; text: string }
  | { id: number; at: number; kind: 'control'; from: UserId; control: string }
  | { id: number; at: number; kind: 'member'; from: UserId; joined: boolean };

export interface Alert {
  id: number;
  at: number;
  from: UserId;
  title: string;
  app: string;
  jamId: JamId | null;
}

/** An open stretch of someone watching one title in one jam; becomes a HistoryEntry when it ends. */
interface Watching {
  jamId: JamId;
  mediaId: string;
  since: number;
  with: Set<UserId>;
}

/** Hooks the demo bots use to react to what real people do. */
export interface BotHooks {
  onFriendRequest(bot: UserRec, from: UserRec): void;
  onJoinRequest(host: UserRec, prompt: Prompt): void;
  onInvite(bot: UserRec, prompt: Prompt): void;
  onJamEntered(jam: Jam, who: UserRec): void;
  onProfileCreated(user: UserRec): void;
}

export const REACTIONS = ['😂', '❤️', '😮', '👏', '🔥', '😢', '🍿', '👋'];
const COLORS = ['#ff6b35', '#ff3d7f', '#ffb547', '#7c5cff', '#2ec4b6', '#4cc9f0', '#f72585', '#90be6d', '#f9c74f', '#43aa8b'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OFFLINE_GRACE_MS = 45_000;
/** Shorter than this doesn't count as having watched something. */
const MIN_HISTORY_S = 60;
const HISTORY_KEEP = 20;
/** A Fire TV reports at least this often while something plays; silence after that means it stopped. */
const NOW_PLAYING_STALE_MS = 3 * 60_000;
/** The Fire TV app polls about once a second while Prime Video is in front. */
const NATIVE_ONLINE_MS = 15_000;
const FEED_KEEP = 40;

export const newId = (n = 6) => randomBytes(n).toString('base64url');

/** Constant-time check of a profile's secret token. */
export function tokenMatches(u: { token: string }, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== u.token.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(u.token));
}

export class Hub {
  users = new Map<UserId, UserRec>();
  jams = new Map<JamId, Jam>();
  /** TV/browser sockets per user. These define presence. */
  viewers = new Map<UserId, Set<Sock>>();
  /** Phone companion sockets per user. They act as the user but don't define presence. */
  companions = new Map<UserId, Set<Sock>>();
  prompts = new Map<string, { prompt: Prompt; to: UserId }>();
  watching = new Map<UserId, Watching>();
  feeds = new Map<JamId, FeedItem[]>();
  private feedSeq = 0;
  /** "Ma is watching Sintel" alerts per person, for their TV to pop up even when FireJam is closed. */
  inbox = new Map<UserId, Alert[]>();
  private alertSeq = 0;
  private lastAlert = new Map<string, number>();
  /** True while demo jams are being seeded at boot, so nobody gets alerts for those. */
  seeding = false;
  bots: BotHooks | null = null;
  onPersist: () => void = () => {};
  private flushQueued = false;

  constructor(public io: IO) {
    setInterval(() => this.settleEndedJams(), 1000);
    setInterval(() => this.expireNowPlaying(), 30_000);
  }

  // ---------- users & presence ----------

  createUser(name: string, placeId: string, opts: Partial<UserRec> = {}): UserRec {
    const user: UserRec = {
      id: newId(),
      name,
      color: COLORS[this.users.size % COLORS.length],
      placeId: PLACES.some((p) => p.id === placeId) ? placeId : PLACES[0].id,
      isBot: false,
      ghost: false,
      friends: new Set(),
      incoming: new Set(),
      outgoing: new Set(),
      lastSeen: Date.now(),
      createdAt: Date.now(),
      botOnline: false,
      pendingJoin: null,
      services: new Set(),
      shareActivity: true,
      token: newId(12),
      nowPlaying: null,
      history: [],
      devices: new Set(),
      tvProfiles: new Set(),
      nativeSeenAt: 0,
      ...opts,
    };
    this.users.set(user.id, user);
    return user;
  }

  isOnline(u: UserRec): boolean {
    return (
      (this.viewers.get(u.id)?.size ?? 0) > 0 ||
      (u.isBot && u.botOnline) ||
      Date.now() - u.nativeSeenAt < NATIVE_ONLINE_MS
    );
  }

  /** True for a demo bot nobody has picked up; once a real person signs in as it, it stops acting on its own. */
  botActs(u: UserRec): boolean {
    return u.isBot && (this.viewers.get(u.id)?.size ?? 0) === 0 && (this.companions.get(u.id)?.size ?? 0) === 0;
  }

  attach(sock: Sock, user: UserRec, companion: boolean) {
    sock.data.userId = user.id;
    sock.data.companion = companion;
    const map = companion ? this.companions : this.viewers;
    if (!map.has(user.id)) map.set(user.id, new Set());
    map.get(user.id)!.add(sock);
    user.lastSeen = Date.now();
    const jam = this.jamOf(user.id);
    if (jam) sock.join(room(jam.id));
    this.flush();
  }

  detach(sock: Sock) {
    const id = sock.data.userId;
    if (!id) return;
    const map = sock.data.companion ? this.companions : this.viewers;
    map.get(id)?.delete(sock);
    if (map.get(id)?.size === 0) map.delete(id);
    const user = this.users.get(id);
    if (!user || sock.data.companion) return;
    user.lastSeen = Date.now();
    if (!this.isOnline(user)) {
      // Give flaky Wi-Fi a moment before pulling someone out of their jam.
      setTimeout(() => {
        if (!this.isOnline(user) && !user.isBot) this.leaveJam(user.id);
      }, OFFLINE_GRACE_MS);
    }
    this.flush();
    this.onPersist();
  }

  rename(userId: UserId, name: unknown): { ok: true } | { ok: false; error: string } {
    const u = this.users.get(userId);
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!u || !clean) return { ok: false, error: 'Type a name first' };
    u.name = clean;
    this.flush();
    this.onPersist();
    return { ok: true };
  }

  setGhost(userId: UserId, on: boolean) {
    const u = this.users.get(userId);
    if (!u) return;
    u.ghost = on;
    this.flush();
    this.onPersist();
  }

  setServices(userId: UserId, services: Service[]) {
    const u = this.users.get(userId);
    if (!u) return;
    u.services = new Set(services.filter((s) => s in SERVICE_NAME));
    // Dropping a service takes you out of a jam that needs it.
    const jam = this.jamOf(userId);
    const media = jam && mediaById(jam.mediaId);
    if (media && !this.canWatch(u, media)) this.leaveJam(userId);
    this.flush();
    this.onPersist();
  }

  canWatch(u: UserRec, media: Pick<Media, 'provider'>): boolean {
    return canWatch([...u.services], media);
  }

  /** Members who couldn't watch a title: a Prime title needs everyone in the jam on Prime. */
  missingAccess(jam: Jam, media: Pick<Media, 'provider'>): UserRec[] {
    return jam.members.map((m) => this.users.get(m)).filter((u): u is UserRec => !!u && !this.canWatch(u, media));
  }

  // ---------- friends ----------

  requestFriend(fromId: UserId, toId: UserId) {
    const from = this.users.get(fromId);
    const to = this.users.get(toId);
    if (!from || !to || from === to || from.friends.has(toId)) return;
    if (from.incoming.has(toId)) return this.respondFriend(fromId, toId, true);
    from.outgoing.add(toId);
    to.incoming.add(fromId);
    this.toast(toId, { kind: 'friend-request', from: fromId });
    if (to.isBot && this.botActs(to)) this.bots?.onFriendRequest(to, from);
    this.flush();
    this.onPersist();
  }

  respondFriend(meId: UserId, fromId: UserId, accept: boolean) {
    const me = this.users.get(meId);
    const from = this.users.get(fromId);
    if (!me || !from || !me.incoming.has(fromId)) return;
    me.incoming.delete(fromId);
    from.outgoing.delete(meId);
    if (accept) {
      me.friends.add(fromId);
      from.friends.add(meId);
      this.toast(fromId, { kind: 'friend-accepted', by: meId });
    }
    this.flush();
    this.onPersist();
  }

  removeFriend(meId: UserId, otherId: UserId) {
    this.users.get(meId)?.friends.delete(otherId);
    this.users.get(otherId)?.friends.delete(meId);
    this.flush();
    this.onPersist();
  }

  makeFriends(a: UserRec, b: UserRec) {
    a.friends.add(b.id);
    b.friends.add(a.id);
  }

  // ---------- jams ----------

  jamOf(userId: UserId): Jam | undefined {
    for (const jam of this.jams.values()) if (jam.members.includes(userId)) return jam;
    return undefined;
  }

  createJam(hostId: UserId, mediaId: string, privacy: JamPrivacy, opts: Partial<Jam> = {}): Jam {
    const host = this.users.get(hostId)!;
    const media = mediaById(mediaId) ?? CATALOG[0];
    this.leaveJam(hostId);
    const jam: Jam = {
      id: newId(),
      code: this.newCode(),
      name: `${host.name}'s Jam`,
      hostId,
      privacy,
      members: [hostId],
      mediaId: media.id,
      playing: true,
      position: 0,
      updatedAt: Date.now(),
      loop: false,
      lastAction: null,
      ...opts,
    };
    this.jams.set(jam.id, jam);
    this.endNowPlaying(host);
    this.startWatching(hostId, jam);
    this.alertFriends(host, media.title, media.provider === 'firejam' ? 'FireJam' : SERVICE_NAME[media.provider], jam.id);
    this.joinRoom(hostId, jam.id);
    this.emitTo(hostId, 'jam:entered', jam.id);
    this.flush();
    return jam;
  }

  /** Walk in if the jam allows it, otherwise knock on the host's door. */
  join(userId: UserId, jamId: JamId): 'joined' | 'requested' | 'missing' | 'needs-service' {
    const jam = this.jams.get(jamId);
    const user = this.users.get(userId);
    if (!jam || !user) return 'missing';
    if (!this.canWatch(user, mediaById(jam.mediaId)!)) return 'needs-service';
    if (jam.members.includes(userId)) {
      this.emitTo(userId, 'jam:entered', jam.id);
      return 'joined';
    }
    const host = this.users.get(jam.hostId)!;
    const walkIn = jam.privacy === 'public' || (jam.privacy === 'friends' && host.friends.has(userId));
    if (walkIn) {
      this.enterJam(userId, jam);
      return 'joined';
    }
    if (user.pendingJoin === jam.id) return 'requested';
    user.pendingJoin = jam.id;
    const prompt: Prompt = { id: newId(), kind: 'join-request', jamId: jam.id, from: userId };
    this.prompts.set(prompt.id, { prompt, to: host.id });
    this.emitTo(host.id, 'prompt', prompt);
    if (this.botActs(host)) this.bots?.onJoinRequest(host, prompt);
    this.flush();
    return 'requested';
  }

  jamByCode(code: string): Jam | undefined {
    return [...this.jams.values()].find((j) => j.code === code.trim().toUpperCase());
  }

  joinByCode(userId: UserId, code: string) {
    const jam = this.jamByCode(code);
    return jam ? { status: this.join(userId, jam.id), jamId: jam.id } : null;
  }

  invite(fromId: UserId, toId: UserId) {
    const jam = this.jamOf(fromId);
    const to = this.users.get(toId);
    if (!jam || !to || jam.members.includes(toId)) return;
    const media = mediaById(jam.mediaId)!;
    if (!this.canWatch(to, media)) {
      const service = SERVICE_NAME[media.provider as Service];
      this.toast(fromId, { kind: 'info', text: `${to.name} doesn't have ${service}, so they can't join this one`, userId: toId });
      return;
    }
    const prompt: Prompt = { id: newId(), kind: 'invite', jamId: jam.id, from: fromId };
    this.prompts.set(prompt.id, { prompt, to: toId });
    this.emitTo(toId, 'prompt', prompt);
    if (this.botActs(to)) this.bots?.onInvite(to, prompt);
  }

  answerPrompt(byId: UserId, promptId: string, accept: boolean) {
    const entry = this.prompts.get(promptId);
    if (!entry || entry.to !== byId) return;
    this.prompts.delete(promptId);
    const { prompt } = entry;
    this.emitTo(byId, 'prompt:cancel', prompt.id);
    const jam = this.jams.get(prompt.jamId);
    const by = this.users.get(byId)!;
    if (prompt.kind === 'join-request') {
      const requester = this.users.get(prompt.from);
      if (!requester) return;
      requester.pendingJoin = null;
      if (accept && jam && this.canWatch(requester, mediaById(jam.mediaId)!)) this.enterJam(requester.id, jam);
      else this.toast(requester.id, { kind: 'info', text: `${by.name} can't let you in right now`, userId: byId });
    } else if (accept && jam && this.canWatch(by, mediaById(jam.mediaId)!)) {
      this.enterJam(byId, jam);
    } else {
      this.toast(prompt.from, { kind: 'info', text: `${by.name} can't join right now`, userId: byId });
    }
    this.flush();
  }

  enterJam(userId: UserId, jam: Jam) {
    const user = this.users.get(userId);
    if (!user) return;
    if (this.jamOf(userId)?.id !== jam.id) this.leaveJam(userId);
    if (!jam.members.includes(userId)) jam.members.push(userId);
    const media = mediaById(jam.mediaId)!;
    if (jam.loop && media.provider !== 'firejam' && !this.botActs(user)) {
      // Demo jams loop on an estimated runtime; a real person's episode must never jump back.
      jam.position = positionAt(jam, media, Date.now());
      jam.updatedAt = Date.now();
      jam.loop = false;
    }
    user.pendingJoin = null;
    this.endNowPlaying(user); // a jam replaces whatever they were watching on their own
    this.startWatching(userId, jam);
    this.alertFriends(user, media.title, media.provider === 'firejam' ? 'FireJam' : SERVICE_NAME[media.provider], jam.id);
    this.joinRoom(userId, jam.id);
    this.io.to(room(jam.id)).emit('toast', { kind: 'jam-member', userId, joined: true, jamId: jam.id });
    this.feed(jam.id, { kind: 'member', from: userId, joined: true });
    this.emitTo(userId, 'jam:entered', jam.id);
    this.bots?.onJamEntered(jam, user);
    this.flush();
  }

  leaveJam(userId: UserId) {
    const jam = this.jamOf(userId);
    if (!jam) return;
    this.stopWatching(userId);
    jam.members = jam.members.filter((m) => m !== userId);
    for (const s of this.socketsOf(userId)) s.leave(room(jam.id));
    this.emitTo(userId, 'jam:left', jam.id);
    const humansLeft = jam.members.some((m) => { const u = this.users.get(m); return !!u && !this.botActs(u); });
    if (jam.members.length === 0 || (!jam.loop && !humansLeft)) {
      this.jams.delete(jam.id);
    } else {
      if (jam.hostId === userId) jam.hostId = jam.members[0];
      this.io.to(room(jam.id)).emit('toast', { kind: 'jam-member', userId, joined: false, jamId: jam.id });
      this.feed(jam.id, { kind: 'member', from: userId, joined: false });
    }
    this.flush();
  }

  setPrivacy(userId: UserId, privacy: JamPrivacy) {
    const jam = this.jamOf(userId);
    if (!jam || jam.hostId !== userId) return;
    jam.privacy = privacy;
    this.flush();
  }

  /** Any member can drive playback, like a Spotify Jam. Everyone sees who did it. */
  control(userId: UserId, msg: ControlMsg) {
    const jam = this.jamOf(userId);
    if (!jam) return;
    const media = mediaById(jam.mediaId)!;
    const now = Date.now();
    const pos = positionAt(jam, media, now);
    switch (msg.kind) {
      case 'play':
        jam.position = media.provider === 'firejam' && pos >= media.runtime - 0.5 ? 0 : pos;
        jam.playing = true;
        break;
      case 'pause':
        jam.position = pos;
        jam.playing = false;
        break;
      case 'seek':
        jam.position = Math.max(0, Number(msg.position) || 0);
        if (media.provider === 'firejam') jam.position = Math.min(jam.position, media.runtime);
        break;
      case 'media': {
        const next = mediaById(msg.mediaId ?? '');
        if (!next) return;
        const missing = this.missingAccess(jam, next);
        if (missing.length) {
          const names = missing.map((u) => u.name).join(', ');
          const service = SERVICE_NAME[next.provider as Service];
          const verb = missing.length > 1 ? "don't" : "doesn't";
          this.toast(userId, { kind: 'info', text: `${names} ${verb} have ${service}, so the jam can't switch to ${next.title}` });
          return;
        }
        for (const m of jam.members) this.stopWatching(m);
        jam.mediaId = next.id;
        jam.position = Math.max(0, Number(msg.position) || 0);
        jam.playing = true;
        for (const m of jam.members) this.startWatching(m, jam);
        break;
      }
      default:
        return;
    }
    jam.updatedAt = now;
    jam.lastAction = { by: userId, kind: msg.kind, at: now };
    this.io.to(room(jam.id)).emit('toast', { kind: 'jam-control', by: userId, control: msg.kind, jamId: jam.id });
    this.feed(jam.id, { kind: 'control', from: userId, control: msg.kind });
    this.flush();
  }

  react(userId: UserId, emoji: string) {
    const jam = this.jamOf(userId);
    if (!jam || !REACTIONS.includes(emoji)) return;
    this.io.to(room(jam.id)).emit('reaction', { id: newId(4), jamId: jam.id, from: userId, emoji, at: Date.now() });
    this.feed(jam.id, { kind: 'reaction', from: userId, emoji });
  }

  chat(userId: UserId, text: string) {
    const jam = this.jamOf(userId);
    const clean = String(text ?? '').trim().slice(0, 160);
    if (!jam || !clean) return;
    this.io.to(room(jam.id)).emit('chat', { id: newId(4), jamId: jam.id, from: userId, text: clean, at: Date.now() });
    this.feed(jam.id, { kind: 'chat', from: userId, text: clean });
  }

  private settleEndedJams() {
    const now = Date.now();
    for (const jam of this.jams.values()) {
      const media = mediaById(jam.mediaId)!;
      if (!jam.playing || jam.loop || media.provider !== 'firejam') continue;
      if (positionAt(jam, media, now) >= media.runtime) {
        jam.playing = false;
        jam.position = media.runtime;
        jam.updatedAt = now;
        this.flush();
      }
    }
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from(randomBytes(4), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (![...this.jams.values()].some((j) => j.code === code)) return code;
    }
  }

  // ---------- Fire TV app behind Prime Video ----------

  private feed(jamId: JamId, item: DistributiveOmit<FeedItem, 'id' | 'at'>) {
    const list = this.feeds.get(jamId) ?? [];
    list.push({ ...item, id: ++this.feedSeq, at: Date.now() } as FeedItem);
    if (list.length > FEED_KEEP) list.splice(0, list.length - FEED_KEEP);
    this.feeds.set(jamId, list);
  }

  /** Whoever uses this Fire TV profile now signs in as `user` (each Fire TV profile is one person). */
  linkTvProfile(user: UserRec, deviceId: string, tvProfile: string) {
    const key = `${deviceId}:${tvProfile}`;
    if (user.tvProfiles.has(key)) return false;
    for (const u of this.users.values()) u.tvProfiles.delete(key);
    user.tvProfiles.add(key);
    return true;
  }

  tvProfileInfo(deviceId: string, tvProfile: string) {
    const key = `${deviceId}:${tvProfile}`;
    let linked: string | null = null;
    const claimed: string[] = [];
    for (const u of this.users.values()) {
      if (u.tvProfiles.has(key)) linked = u.id;
      if ([...u.tvProfiles].some((k) => k.startsWith(`${deviceId}:`))) claimed.push(u.id);
    }
    return { linked, claimed };
  }

  /** The user behind a TV's token, if it matches. */
  authed(userId: unknown, token: unknown): UserRec | undefined {
    const u = this.users.get(String(userId));
    return u && tokenMatches(u, token) ? u : undefined;
  }

  /**
   * One poll from the Fire TV app while Prime Video is in front (the web app's
   * timers are frozen there): keeps the person present and returns their jam,
   * the server clock, and what happened since `since` for on-screen bubbles.
   */
  tvPoll(user: UserRec, since: number) {
    const wasOnline = this.isOnline(user);
    user.nativeSeenAt = Date.now();
    user.lastSeen = Date.now();
    if (!wasOnline) this.flush();
    const jam = this.jamOf(user.id) ?? null;
    const media = jam ? mediaById(jam.mediaId) ?? null : null;
    const feed = jam ? (this.feeds.get(jam.id) ?? []).filter((f) => f.id > since) : [];
    const people: Record<string, { name: string; city: string }> = {};
    for (const id of new Set([...(jam?.members ?? []), ...feed.map((f) => f.from)])) {
      const u = this.users.get(id);
      if (u) people[id] = { name: u.name, city: placeById(u.placeId).city };
    }
    return {
      serverNow: Date.now(),
      cursor: this.feedSeq,
      jam: jam && { id: jam.id, playing: jam.playing, position: jam.position, updatedAt: jam.updatedAt, loop: jam.loop },
      media: media && { id: media.id, title: media.title, runtime: media.runtime, provider: media.provider },
      feed,
      people,
    };
  }

  /**
   * Tell someone's friends they started watching: a toast on screens that are open, and an
   * inbox item their Fire TV polls so it can pop up over whatever's on (FriendAlerts.kt).
   * Once per friend per title per 10 minutes, and never for people who don't share activity.
   */
  alertFriends(user: UserRec, title: string, app: string, jamId: JamId | null) {
    if (this.seeding || !user.shareActivity) return;
    const now = Date.now();
    for (const fid of user.friends) {
      const friend = this.users.get(fid);
      if (!friend || friend.isBot) continue;
      if (jamId && this.jamOf(fid)?.id === jamId) continue; // already watching together
      const key = `${user.id}>${fid}:${title}`;
      if (now - (this.lastAlert.get(key) ?? 0) < 10 * 60_000) continue;
      this.lastAlert.set(key, now);
      const list = this.inbox.get(fid) ?? [];
      list.push({ id: ++this.alertSeq, at: now, from: user.id, title, app, jamId });
      if (list.length > 20) list.splice(0, list.length - 20);
      this.inbox.set(fid, list);
      this.toast(fid, { kind: 'friend-watching', from: user.id, title, app, jamId });
    }
  }

  tvInbox(user: UserRec, since: number) {
    const items = (this.inbox.get(user.id) ?? []).filter((a) => a.id > since);
    return {
      cursor: this.alertSeq,
      items: items.map((a) => {
        const from = this.users.get(a.from);
        return { ...a, name: from?.name ?? 'A friend', city: from ? placeById(from.placeId).city : '' };
      }),
    };
  }

  // ---------- activity & history ----------

  private startWatching(userId: UserId, jam: Jam) {
    this.stopWatching(userId);
    const others = new Set(jam.members.filter((m) => m !== userId));
    this.watching.set(userId, { jamId: jam.id, mediaId: jam.mediaId, since: Date.now(), with: others });
    // Everyone already watching now has company.
    for (const m of others) this.watching.get(m)?.with.add(userId);
  }

  private stopWatching(userId: UserId) {
    const w = this.watching.get(userId);
    if (!w) return;
    this.watching.delete(userId);
    const media = mediaById(w.mediaId);
    const user = this.users.get(userId);
    if (!media || !user) return;
    const app = media.provider === 'firejam' ? 'FireJam' : SERVICE_NAME[media.provider];
    this.addHistory(user, { title: media.title, mediaId: media.id, app, with: [...w.with], at: w.since, seconds: (Date.now() - w.since) / 1000 });
  }

  addHistory(user: UserRec, entry: Omit<HistoryEntry, 'id'>, force = false) {
    if (!force && entry.seconds < MIN_HISTORY_S) return;
    const last = user.history[0];
    // Rejoining the same title soon after counts as one sitting.
    if (last && last.title === entry.title && entry.at - (last.at + last.seconds * 1000) < 10 * 60_000) {
      last.seconds += entry.seconds;
      last.with = [...new Set([...last.with, ...entry.with])];
    } else {
      user.history.unshift({ id: newId(4), ...entry });
      user.history.length = Math.min(user.history.length, HISTORY_KEEP);
    }
    this.onPersist();
  }

  /** A Fire TV says what it's playing outside FireJam (or that it stopped). */
  reportActivity(r: ActivityReport): boolean {
    const user = this.users.get(String(r.userId));
    if (!user || !r.token || r.token !== user.token) return false;
    if (!user.shareActivity || this.jamOf(user.id)) return true; // jams speak for themselves
    const title = String(r.title ?? '').trim().slice(0, 80);
    const pkg = String(r.package ?? '');
    const provider: Service | null = PRIME_PACKAGES.includes(pkg) ? 'prime' : null;
    const app = provider ? SERVICE_NAME[provider] : String(r.app ?? '').trim().slice(0, 40);
    // Some apps (Prime Video on Fire OS 8) don't say what's playing; "watching Prime Video" still counts.
    if (r.stopped || (!title && !app)) {
      this.endNowPlaying(user);
      this.flush();
      return true;
    }
    const now = Date.now();
    if (user.nowPlaying && (user.nowPlaying.title !== title || user.nowPlaying.app !== app)) this.endNowPlaying(user);
    let mediaId: string | null = null;
    if (provider && title) {
      const { media, added } = serviceTitle(provider, title);
      mediaId = media.id;
      if (added) this.io.emit('catalog', CATALOG);
    }
    if (!user.nowPlaying) this.alertFriends(user, title || app, app, null);
    user.nowPlaying = {
      app,
      provider,
      title,
      mediaId,
      playing: r.playing !== false,
      position: Math.max(0, Number(r.position) || 0),
      updatedAt: now,
      since: user.nowPlaying?.since ?? now,
    };
    this.flush();
    return true;
  }

  endNowPlaying(user: UserRec) {
    const np = user.nowPlaying;
    if (!np) return;
    user.nowPlaying = null;
    this.addHistory(user, { title: np.title || np.app, mediaId: np.mediaId, app: np.app, with: [], at: np.since, seconds: (Date.now() - np.since) / 1000 });
  }

  private expireNowPlaying() {
    const now = Date.now();
    let changed = false;
    for (const u of this.users.values()) {
      if (u.nowPlaying && !u.isBot && now - u.nowPlaying.updatedAt > NOW_PLAYING_STALE_MS) {
        this.endNowPlaying(u);
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  setShare(userId: UserId, on: boolean) {
    const u = this.users.get(userId);
    if (!u) return;
    u.shareActivity = on;
    if (!on) u.nowPlaying = null;
    this.flush();
    this.onPersist();
  }

  // ---------- snapshots ----------

  publicUser(u: UserRec, viewer: UserRec): PublicUser {
    const jam = this.jamOf(u.id);
    const self = u.id === viewer.id;
    const friend = viewer.friends.has(u.id);
    const sharedJam = !!jam && jam.members.includes(viewer.id);
    return {
      id: u.id,
      name: u.name,
      color: u.color,
      place: placeById(u.placeId),
      online: this.isOnline(u),
      lastSeen: u.lastSeen,
      jamId: jam && (self || friend || sharedJam || jam.privacy === 'public') ? jam.id : null,
      isBot: u.isBot,
      onMap: !u.ghost && (self || friend || sharedJam || jam?.privacy === 'public'),
      services: [...u.services],
      nowPlaying: (self || friend) && u.shareActivity && !jam ? u.nowPlaying : null,
      recent: (self || friend) && u.shareActivity ? u.history.slice(0, 6) : [],
    };
  }

  worldFor(viewer: UserRec): WorldSnapshot {
    const users: PublicUser[] = [];
    for (const u of this.users.values()) {
      const related =
        u.id === viewer.id ||
        viewer.friends.has(u.id) ||
        viewer.incoming.has(u.id) ||
        viewer.outgoing.has(u.id) ||
        this.isOnline(u);
      if (related) users.push(this.publicUser(u, viewer));
    }
    const jams = [...this.jams.values()].filter(
      (j) => j.privacy === 'public' || j.members.some((m) => m === viewer.id || viewer.friends.has(m)),
    );
    return { users, jams };
  }

  meFor(u: UserRec): MeState {
    return {
      user: this.publicUser(u, u),
      ghost: u.ghost,
      shareActivity: u.shareActivity,
      token: u.token,
      friends: [...u.friends],
      incoming: [...u.incoming],
      outgoing: [...u.outgoing],
      pendingJoin: u.pendingJoin,
    };
  }

  /** Coalesce every change in this tick into one snapshot per connected screen. */
  flush() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    setImmediate(() => {
      this.flushQueued = false;
      for (const [id, socks] of [...this.viewers, ...this.companions]) {
        const u = this.users.get(id);
        if (!u) continue;
        const world = this.worldFor(u);
        const me = this.meFor(u);
        for (const s of socks) {
          s.emit('world', world);
          s.emit('me', me);
        }
      }
    });
  }

  // ---------- plumbing ----------

  socketsOf(userId: UserId): Sock[] {
    return [...(this.viewers.get(userId) ?? []), ...(this.companions.get(userId) ?? [])];
  }

  emitTo<E extends keyof ServerToClient>(userId: UserId, event: E, ...args: Parameters<ServerToClient[E]>) {
    for (const s of this.socketsOf(userId)) (s.emit as (e: E, ...a: Parameters<ServerToClient[E]>) => void)(event, ...args);
  }

  toast(userId: UserId, t: Toast) {
    this.emitTo(userId, 'toast', t);
  }

  private joinRoom(userId: UserId, jamId: JamId) {
    for (const s of this.socketsOf(userId)) s.join(room(jamId));
  }
}

export const room = (jamId: JamId) => `jam:${jamId}`;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Package names Prime Video ships under on Fire TV / Android TV (mirrors android/…/PrimeVideo.kt). */
const PRIME_PACKAGES = ['com.amazon.amazonvideo.livingroom', 'com.amazon.firebat', 'com.amazon.avod.thirdpartyclient', 'com.amazon.avod'];
