import type { Jam, JamPrivacy, PublicUser } from '../../../shared/protocol';
import { serverNow } from './store';

// Times from the server are compared against the server clock, not the TV's own:
// a Fire TV's clock can be minutes off (one in testing ran 162 s fast).

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const timeFmt = new Map<string, Intl.DateTimeFormat>();
/** "7:42 pm" in someone's own time zone. */
export function localTime(tz: string, now = serverNow()): string {
  if (!timeFmt.has(tz)) timeFmt.set(tz, new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: tz }));
  return timeFmt.get(tz)!.format(now).toLowerCase().replace(/\s/g, ' ');
}

export function ago(ts: number, now = serverNow()): string {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return h < 48 ? 'yesterday' : `${Math.round(h / 24)}d ago`;
}

/** Where a friend's own-TV playback is now (it keeps moving between reports while playing). */
export function nowPlayingPosition(np: { playing: boolean; position: number; updatedAt: number }, now = serverNow()): number {
  return np.playing ? np.position + (now - np.updatedAt) / 1000 : np.position;
}

export const PRIVACY_LABEL: Record<JamPrivacy, string> = {
  public: 'Public',
  friends: 'Friends',
  invite: 'Invite only',
};

export const PRIVACY_HINT: Record<JamPrivacy, string> = {
  public: 'Anyone on the Jam Map can drop in',
  friends: 'Your friends can join straight away',
  invite: 'People ask, you decide',
};

export function memberLine(jam: Jam, users: PublicUser[], meId?: string): string {
  const names = jam.members
    .filter((m) => m !== meId)
    .map((m) => users.find((u) => u.id === m)?.name)
    .filter(Boolean) as string[];
  const withMe = jam.members.includes(meId ?? '');
  if (names.length === 0) return withMe ? 'Just you' : '';
  const shown = names.slice(0, 2).join(', ');
  const more = names.length > 2 ? ` +${names.length - 2}` : '';
  return withMe ? `You, ${shown}${more}` : `${shown}${more}`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
