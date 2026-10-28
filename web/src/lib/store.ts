import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ChatMsg,
  ClientToServer,
  Jam,
  Media,
  MeState,
  Place,
  Prompt,
  PublicUser,
  Reaction,
  ServerToClient,
  Toast,
  WorldSnapshot,
} from '../../../shared/protocol';
import { canWatch, positionAt } from '../../../shared/playhead';
import { deviceInfo } from './native';
import { errorCode, errorText } from './safety';

export type Screen = 'home' | 'map' | 'friends' | 'library' | 'player';

export interface State {
  status: 'connecting' | 'onboarding' | 'ready' | 'banned';
  /** Profiles made on this Fire TV, when there's more than one to choose from. */
  deviceProfiles: PublicUser[];
  /** The picker is up because someone switched to a Fire TV profile FireJam hasn't met. */
  newTvProfile: boolean;
  /** The name the TV offered was refused (offensive), so onboarding asks for another. */
  nameRejected: boolean;
  online: boolean;
  me: MeState | null;
  world: WorldSnapshot;
  catalog: Media[];
  places: Place[];
  screen: Screen;
  toasts: (Toast & { id: number })[];
  prompts: Prompt[];
  reactions: Reaction[];
  chat: ChatMsg[];
  lanOrigin: string;
  /** A jam I just started: its invite (QR and code) shows first, and it plays when I say so. */
  sharing: string | null;
}

const USER_KEY = 'firejam.userId';
const TOKENS_KEY = 'firejam.tokens';
const params = new URLSearchParams(location.search);
export const isCompanion = location.pathname.startsWith('/m');

let state: State = {
  status: 'connecting',
  deviceProfiles: [],
  newTvProfile: false,
  nameRejected: false,
  online: false,
  me: null,
  world: { users: [], jams: [] },
  catalog: [],
  places: [],
  screen: 'home',
  toasts: [],
  prompts: [],
  reactions: [],
  chat: [],
  sharing: null,
  lanOrigin: location.origin,
};
const listeners = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// ---------- server clock ----------
// Every screen in a jam computes the playhead from the same server clock,
// so we estimate our offset NTP-style and keep the lowest-latency samples.

let clockOffset = 0;
const samples: { rtt: number; offset: number }[] = [];
export const serverNow = () => Date.now() + clockOffset;

async function syncClock(rounds: number) {
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    const ts = await new Promise<number>((r) => socket.emit('time', r));
    const t1 = Date.now();
    samples.push({ rtt: t1 - t0, offset: ts - (t0 + (t1 - t0) / 2) });
    if (samples.length > 12) samples.shift();
  }
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
  clockOffset = best.reduce((s, x) => s + x.offset, 0) / best.length;
}

// ---------- socket ----------

export const socket: Socket<ServerToClient, ClientToServer> = io(params.get('server') ?? undefined, {
  transports: ['websocket', 'polling'],
});

/** `?as=<userId>` pins a screen to one profile (phone companions, or a laptop playing "Ma" in a demo). */
const forcedUser = params.get('as') ?? undefined;

export const storedUserId = () => {
  if (forcedUser) return forcedUser;
  try {
    return localStorage.getItem(USER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Each profile's secret, kept by the screens that have been it: the server asks for it on hello. */
function tokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function rememberToken(id: string, token: string) {
  if (forcedUser) return;
  try {
    const all = tokens();
    if (all[id] === token) return;
    all[id] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* private mode: this browser signs in again next time */
  }
}

/** Profiles this browser can sign in as. */
export const knownProfiles = () => Object.entries(tokens()).map(([id, token]) => ({ id, token }));

// A phone companion's link carries the token as `t` (`/m?code=K7QF&as=<id>&t=<token>`).
const tokenFor = (id: string) => (id === forcedUser ? params.get('t') ?? undefined : tokens()[id]);

export function rememberUser(id: string | null) {
  if (forcedUser) return;
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* private mode: the profile simply isn't remembered */
  }
}

export const device = isCompanion ? null : deviceInfo();
export const SWITCH_KEY = 'firejam.switch';

export function hello(userId: string | undefined) {
  const token = userId ? tokenFor(userId) : undefined;
  socket.emit('hello', { userId, token, companion: isCompanion, deviceId: device?.deviceId, tvProfile: device?.tvProfile ?? undefined }, (res) => {
    if (res.ok && res.data && (res.data as { needsProfile: boolean }).needsProfile) setState({ status: 'onboarding' });
    else if (!res.ok && res.error === 'banned') setState({ status: 'banned' });
  });
}

/**
 * On a Fire TV nobody fills in a form: the first launch makes a profile from what the
 * TV knows (owner's name, time zone, Prime Video), one profile signs straight in, and
 * with several profiles on this TV we ask who's watching, like Prime Video does.
 */
async function signInOnTv() {
  if (!device) return hello(storedUserId());
  const tvProfile = device.tvProfile ?? undefined;
  const [list, tv] = await Promise.all([
    emitAck<PublicUser[]>((ack) => socket.emit('profile:list', { deviceId: device.deviceId }, ack)).catch(() => []),
    tvProfile
      ? emitAck<{ linked: string | null; claimed: string[] }>((ack) => socket.emit('profile:tv', { deviceId: device.deviceId, tvProfile }, ack)).catch(() => null)
      : null,
  ]);
  const stored = storedUserId();
  // "Switch profile" always shows the picker, even with one profile on this TV.
  let switching = false;
  try {
    switching = sessionStorage.getItem(SWITCH_KEY) === '1';
    sessionStorage.removeItem(SWITCH_KEY);
  } catch {
    /* no session storage: fall through to the usual sign-in */
  }
  if (switching) {
    setState({ status: 'onboarding', deviceProfiles: list, newTvProfile: false });
    return;
  }
  // Each Fire TV profile is one person: once picked, FireJam signs in as them whenever that
  // Fire TV profile is active, and switching Fire TV profiles switches FireJam with it.
  if (tv?.linked && list.some((u) => u.id === tv.linked)) {
    rememberUser(tv.linked);
    return hello(tv.linked);
  }
  if (list.length === 0 && device.ownerName) {
    try {
      const { userId } = await emitAck<{ userId: string }>((ack) =>
        socket.emit(
          'profile:create',
          { name: device.ownerName!, tz: device.timezone, services: device.primeInstalled ? ['prime'] : [], deviceId: device.deviceId, tvProfile },
          ack,
        ),
      );
      rememberUser(userId);
      pushToast({ kind: 'info', text: `Signed in as ${device.ownerName} from this TV. Change it any time in your profile.` });
    } catch (e) {
      // The TV's owner name was refused: ask for another by hand instead of getting stuck.
      const code = errorCode(e);
      if (code === 'banned') setState({ status: 'banned' });
      else setState({ status: 'onboarding', deviceProfiles: list, newTvProfile: false, nameRejected: code === 'name_not_allowed' });
    }
    return;
  }
  // A Fire TV profile FireJam hasn't met: the TV's only FireJam profile if no other Fire TV profile
  // has it yet (first run after an update), otherwise ask once who this is.
  const unclaimed = list.filter((u) => !tv?.claimed.includes(u.id));
  if (list.length === 1 && (!tv || unclaimed.length === 1)) return hello(list[0].id);
  if (tv && list.length > 0) {
    setState({ status: 'onboarding', deviceProfiles: list, newTvProfile: true });
    return;
  }
  if (list.length > 1 && getState().status !== 'ready') {
    setState({ status: 'onboarding', deviceProfiles: list, newTvProfile: false });
    return;
  }
  if (stored) return hello(stored);
  setState({ status: 'onboarding', deviceProfiles: list, newTvProfile: false });
}

socket.on('connect', () => {
  setState({ online: true });
  if (isCompanion || forcedUser || getState().status === 'ready') hello(storedUserId());
  else void signInOnTv();
  syncClock(6);
});
socket.on('disconnect', () => setState({ online: false }));
setInterval(() => socket.connected && syncClock(2), 20_000);

socket.on('session', (s) => {
  if (!isCompanion) rememberUser(s.me.user.id);
  rememberToken(s.me.user.id, s.me.token);
  // First load drops you straight back into a jam you were part of; reconnects stay where you are.
  const resume = state.status !== 'ready' && !!s.me.user.jamId && !isCompanion;
  setState({ status: 'ready', me: s.me, world: s.world, catalog: s.catalog, places: s.places });
  if (resume) setState({ screen: 'player' });
  shareIdentity();
  // Opened from a friend alert on the Fire TV: go straight into their jam.
  const join = params.get('join');
  if (join && !isCompanion) {
    params.delete('join');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
    // A four-letter code comes from an invite QR (/j/K7QF); a jam id from a friend alert on the TV.
    if (/^[a-z0-9]{4}$/i.test(join)) {
      socket.emit('jam:join-code', join.toUpperCase(), (res) => {
        if (!res.ok) pushToast({ kind: 'info', text: errorText(res.error) });
        else if ((res.data as { status: string }).status === 'requested') pushToast({ kind: 'info', text: 'Asked the host to let you in…' });
      });
    } else socket.emit('jam:join', join, (res) => !res.ok && pushToast({ kind: 'info', text: errorText(res.error) }));
  }
});
socket.on('world', (world) => setState({ world }));
socket.on('catalog', (catalog) => setState({ catalog }));
socket.on('me', (me) => {
  setState({ me });
  shareIdentity();
});

/** Lets the Fire TV shell report what this TV plays outside FireJam, as this person. */
let sharedIdentity = '';
function shareIdentity() {
  const me = state.me;
  const bridge = (window as unknown as { FireJamNative?: { setIdentity(url: string, userId: string, token: string, share: boolean): void } })
    .FireJamNative;
  if (!me || !bridge || isCompanion) return;
  const key = `${me.user.id}:${me.token}:${me.shareActivity}`;
  if (key === sharedIdentity) return;
  sharedIdentity = key;
  bridge.setIdentity(location.origin, me.user.id, me.token, me.shareActivity);
}

let toastSeq = 0;
export function pushToast(t: Toast) {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
}
socket.on('toast', pushToast);

socket.on('prompt', (p) => setState((s) => ({ prompts: [...s.prompts.filter((x) => x.id !== p.id), p] })));
socket.on('prompt:cancel', (id) => setState((s) => ({ prompts: s.prompts.filter((x) => x.id !== id) })));

/** Whether I blocked this person. The server already filters them out; this is the belt to its braces. */
const isBlocked = (id: string) => !!state.me?.blocked?.includes(id);
const NO_ONE: string[] = [];
/** The people I blocked (stable empty list when none, so selectors don't re-render). */
export const useBlocked = () => useStore((s) => s.me?.blocked ?? NO_ONE);

socket.on('reaction', (r) => {
  if (isBlocked(r.from)) return;
  setState((s) => ({ reactions: [...s.reactions, r].slice(-24) }));
  setTimeout(() => setState((s) => ({ reactions: s.reactions.filter((x) => x.id !== r.id) })), 3800);
});
socket.on('chat', (c) => {
  if (!isBlocked(c.from)) setState((s) => ({ chat: [...s.chat, c].slice(-30) }));
});

socket.on('jam:entered', () => {
  if (!isCompanion) setState({ screen: 'player', chat: [] });
});
socket.on('jam:left', () => {
  if (!isCompanion && getState().screen === 'player') setState({ screen: 'home' });
});

fetch('/api/info')
  .then((r) => r.json())
  .then(({ lanIp }: { lanIp: string }) => {
    if (['localhost', '127.0.0.1'].includes(location.hostname) && lanIp !== 'localhost')
      setState({ lanOrigin: `${location.protocol}//${lanIp}${location.port ? `:${location.port}` : ''}` });
  })
  .catch(() => {});

// ---------- derived helpers ----------

export const useMe = () => useStore((s) => s.me);
export const userById = (id: string | undefined | null): PublicUser | undefined =>
  id ? state.world.users.find((u) => u.id === id) : undefined;
export const jamById = (id: string | undefined | null): Jam | undefined =>
  id ? state.world.jams.find((j) => j.id === id) : undefined;
export const mediaById = (id: string | undefined): Media | undefined => state.catalog.find((m) => m.id === id);

export function useUsers() {
  return useStore((s) => s.world.users);
}

/** Playhead in seconds, using the same rule as the server. */
export function jamPosition(jam: Jam, media: Pick<Media, 'runtime' | 'provider'>, now = serverNow()): number {
  return positionAt(jam, media, now);
}

/** Whether I can watch a title (FireJam's own films, or a service I have). */
export function iCanWatch(media: Pick<Media, 'provider'>): boolean {
  return canWatch(state.me?.user.services ?? [], media);
}

export const go = (screen: Screen) => setState({ screen });

export function emitAck<T>(fn: (ack: (res: { ok: true; data?: T } | { ok: false; error: string }) => void) => void) {
  return new Promise<T>((resolve, reject) =>
    fn((res) => (res.ok ? resolve(res.data as T) : reject(new Error(res.error)))),
  );
}

// One shared ticker so every progress bar and clock on screen updates together.
let tick = Date.now();
const tickers = new Set<() => void>();
setInterval(() => {
  tick = serverNow();
  tickers.forEach((l) => l());
}, 1000);
export function useTick(): number {
  return useSyncExternalStore(
    (l) => {
      tickers.add(l);
      return () => tickers.delete(l);
    },
    () => tick,
  );
}

// Handy in dev tools and for scripted sync checks; stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { __firejam: { getState, socket, jamPosition, mediaById, serverNow } });
