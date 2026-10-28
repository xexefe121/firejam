// Wire types shared by the FireJam server and clients.
// Every message the server sends is derived from these shapes.

export type UserId = string;
export type JamId = string;

export interface Place {
  id: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
}

/** Streaming services a viewer can bring to a jam. Everyone in a jam must have the title's service. */
export type Service = 'prime';

export interface Media {
  id: string;
  title: string;
  /** Episode or edition line, e.g. "S1 · E1 · The End". */
  subtitle?: string;
  year: number;
  /** Seconds. Exact for FireJam's own films, an estimate for titles on a service. */
  runtime: number;
  /** `firejam`: streamed by FireJam itself. Anything else plays in that service's own app on each TV. */
  provider: 'firejam' | Service;
  src: string;
  kind: 'mp4' | 'hls' | 'external';
  /** For service titles: the link the service's TV app opens to this title. */
  link?: string;
  genre: string;
  logline: string;
  still: string; // backdrop image path ('' for service titles, which get a typographic card)
  tint?: [string, string];
  credit: string; // attribution line required by the CC-BY licence
}

/** Who can walk straight into a jam without asking the host. */
export type JamPrivacy = 'public' | 'friends' | 'invite';

export interface Jam {
  id: JamId;
  code: string; // short join code shown on screen and in the QR link
  name: string;
  hostId: UserId;
  privacy: JamPrivacy;
  members: UserId[];
  mediaId: string;
  playing: boolean;
  /** Playback position (seconds) at `updatedAt` (server clock, ms). */
  position: number;
  updatedAt: number;
  /** Seeded demo jams loop forever so the map always has life on it. */
  loop: boolean;
  lastAction: { by: UserId; kind: ControlKind; at: number } | null;
}

/** Something a friend is watching outside FireJam, reported by their Fire TV (e.g. Prime Video on their own). */
export interface NowPlaying {
  app: string; // "Prime Video", "Netflix", …
  provider: Service | null; // set when it's a service FireJam can sync
  title: string;
  mediaId: string | null; // catalogue title it matches, for "watch together"
  playing: boolean;
  position: number; // seconds, at updatedAt
  updatedAt: number;
  since: number;
}

/** One thing someone watched, in FireJam or elsewhere on their TV. */
export interface HistoryEntry {
  id: string;
  title: string;
  mediaId: string | null;
  app: string; // "FireJam", "Prime Video", …
  with: UserId[]; // who was in the jam (empty when watched alone)
  at: number; // when it started
  seconds: number; // how long they watched
}

export interface PublicUser {
  id: UserId;
  name: string;
  color: string;
  place: Place;
  online: boolean;
  lastSeen: number;
  jamId: JamId | null;
  isBot: boolean;
  /** Whether this viewer may see the user's pin on the Jam Map (friends, public jams, not ghosted). */
  onMap: boolean;
  services: Service[];
  /** Only visible to friends, and only if the person shares their activity. */
  nowPlaying: NowPlaying | null;
  recent: HistoryEntry[];
}

/** What one viewer is allowed to see of the world right now. */
export interface WorldSnapshot {
  users: PublicUser[];
  jams: Jam[];
}

export interface MeState {
  user: PublicUser;
  ghost: boolean;
  /** Share what I'm watching (in and outside FireJam) and my history with friends. */
  shareActivity: boolean;
  /** Lets this person's Fire TV report what's playing outside FireJam (POST /api/activity). */
  token: string;
  friends: UserId[];
  incoming: UserId[]; // friend requests waiting for me
  outgoing: UserId[]; // friend requests I sent
  pendingJoin: JamId | null; // jam I asked to join
  /** People I blocked: their chat, reactions, requests and invites never reach me. */
  blocked: UserId[];
}

export type ReportReason = 'offensive-name' | 'abusive-messages' | 'spam' | 'other';

/** A viewer flags someone (and optionally one of their chat messages) for review. */
export interface ReportMsg {
  target: UserId;
  reason: ReportReason;
  jamId?: JamId;
  messageId?: string;
}

/** What a Fire TV reports about its foreground player (see android/…/ActivityReporter.kt). */
export interface ActivityReport {
  userId: UserId;
  token: string;
  stopped?: boolean;
  app?: string;
  package?: string;
  title?: string;
  playing?: boolean;
  position?: number; // seconds
}

export interface Session {
  me: MeState;
  world: WorldSnapshot;
  catalog: Media[];
  places: Place[];
}

export type ControlKind = 'play' | 'pause' | 'seek' | 'media';

export interface ControlMsg {
  kind: ControlKind;
  position?: number;
  mediaId?: string;
}

export interface Reaction {
  id: string;
  jamId: JamId;
  from: UserId;
  emoji: string;
  at: number;
}

export interface ChatMsg {
  id: string;
  jamId: JamId;
  from: UserId;
  text: string;
  at: number;
}

export type Toast =
  | { kind: 'info'; text: string; userId?: UserId }
  | { kind: 'friend-request'; from: UserId }
  | { kind: 'friend-accepted'; by: UserId }
  | { kind: 'jam-control'; by: UserId; control: ControlKind; jamId: JamId }
  | { kind: 'jam-member'; userId: UserId; joined: boolean; jamId: JamId }
  /** A friend started watching something: in a jam (jamId) or on their own TV. */
  | { kind: 'friend-watching'; from: UserId; title: string; app: string; jamId: JamId | null };

/** Something that needs the viewer to answer (shown as a focus-trapping dialog). */
export type Prompt =
  | { id: string; kind: 'join-request'; jamId: JamId; from: UserId }
  | { id: string; kind: 'invite'; jamId: JamId; from: UserId };

export interface HelloMsg {
  userId?: UserId;
  /** The profile's secret, from `MeState.token`. A TV the profile is bound to may leave it out. */
  token?: string;
  /** The Fire TV this screen is (Android ID), so profiles stay tied to the TV they were made on. */
  deviceId?: string;
  /** The active Fire TV profile (hashed on the TV). Signing in links it to this FireJam profile. */
  tvProfile?: string;
  /** Phone companions act as the user but don't count as a separate viewer. */
  companion?: boolean;
}

export interface CreateProfileMsg {
  name: string;
  /** Picked by hand; otherwise the server picks the city from `tz`. */
  placeId?: string;
  tz?: string;
  services: Service[];
  deviceId?: string;
  tvProfile?: string;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ServerToClient {
  session: (s: Session) => void;
  world: (w: WorldSnapshot) => void;
  me: (m: MeState) => void;
  toast: (t: Toast) => void;
  prompt: (p: Prompt) => void;
  'prompt:cancel': (id: string) => void;
  reaction: (r: Reaction) => void;
  chat: (c: ChatMsg) => void;
  'jam:entered': (jamId: JamId) => void;
  'jam:left': (jamId: JamId) => void;
  catalog: (c: Media[]) => void;
}

export interface ClientToServer {
  hello: (msg: HelloMsg, ack: Ack<{ needsProfile: boolean }>) => void;
  'profile:create': (msg: CreateProfileMsg, ack: Ack<{ userId: UserId; token: string }>) => void;
  /**
   * With a deviceId: the profiles bound to that TV. Without: the profiles this browser holds tokens
   * for (`mine`) plus demo people.
   */
  'profile:list': (opts: { deviceId?: string; mine?: { id: UserId; token: string }[] }, ack: Ack<PublicUser[]>) => void;
  /**
   * Which FireJam profile goes with a Fire TV profile on this TV (`linked`), and which of the TV's
   * FireJam profiles already belong to some Fire TV profile (`claimed`).
   */
  'profile:tv': (opts: { deviceId: string; tvProfile: string }, ack: Ack<{ linked: UserId | null; claimed: UserId[] }>) => void;
  'ghost:set': (on: boolean) => void;
  'profile:services': (services: Service[]) => void;
  time: (ack: (serverNow: number) => void) => void;
  'friend:request': (to: UserId) => void;
  'friend:respond': (from: UserId, accept: boolean) => void;
  'friend:remove': (id: UserId) => void;
  'jam:create': (
    /** `paused`: wait at the start while the host shares the invite, then play. */
    msg: { mediaId: string; privacy: JamPrivacy; startAt?: number; invite?: UserId; paused?: boolean },
    ack: Ack<{ jamId: JamId }>,
  ) => void;
  'profile:share': (on: boolean) => void;
  /** What friends call you. Fire TV keeps its profile names to itself, so this is set here. */
  'profile:name': (name: string, ack: Ack) => void;
  /** Amazon Bedrock picks what to watch for everyone in my jam (or just me). */
  'jam:pick': (ack: Ack<{ mediaId: string; reason: string; by: 'bedrock' | 'fallback' }>) => void;
  'jam:join': (jamId: JamId, ack: Ack<{ status: 'joined' | 'requested' }>) => void;
  'jam:join-code': (code: string, ack: Ack<{ status: 'joined' | 'requested'; jamId: JamId }>) => void;
  'jam:leave': () => void;
  'jam:invite': (to: UserId) => void;
  'jam:privacy': (privacy: JamPrivacy) => void;
  'prompt:answer': (id: string, accept: boolean) => void;
  'jam:control': (msg: ControlMsg) => void;
  'jam:react': (emoji: string) => void;
  /** The server filters objectionable words before anyone sees the message. */
  'jam:chat': (text: string) => void;
  /** Flag a person (or one of their messages) for review. Also blocks them for the reporter. */
  'user:report': (msg: ReportMsg, ack: Ack) => void;
  'user:block': (target: UserId, ack: Ack) => void;
  'user:unblock': (target: UserId, ack: Ack) => void;
  /** Host only: take someone out of my jam. They can't rejoin that jam. */
  'jam:remove': (target: UserId, ack: Ack) => void;
}
