import { SERVICE_NAME } from '../../../shared/playhead';
import type { HistoryEntry, Jam, Media, PublicUser } from '../../../shared/protocol';
import { relationTo } from '../lib/actions';
import { ago, clock, localTime, nowPlayingPosition } from '../lib/format';
import { iCanWatch, jamById, jamPosition, mediaById, useMe, useStore, useTick } from '../lib/store';
import { Icon } from './Icon';
import { Avatar, AvatarStack, Progress } from './ui';

/**
 * Title artwork. FireJam's own films use a still; titles on a service get a
 * typographic card instead, since FireJam doesn't ship the service's artwork.
 */
export function Still({ media, className = '' }: { media?: Media; className?: string }) {
  if (media && !media.still) {
    const [a, b] = media.tint ?? ['#16243f', '#3a6fb8'];
    return (
      <span
        className={`still typo ${className}`}
        style={{ backgroundImage: `radial-gradient(circle at 78% 18%, ${b} 0%, transparent 62%), linear-gradient(135deg, ${a} 0%, #0c0a14 85%)` }}
      >
        <span className="typo-title">{media.title}</span>
      </span>
    );
  }
  return <span className={`still ${className}`} style={{ backgroundImage: media ? `url(${media.still})` : undefined }} />;
}

/** "Prime Video" pill on anything that plays in a viewer's own service app. */
export function ServiceBadge({ media, className = '' }: { media: Media; className?: string }) {
  if (media.provider === 'firejam') return null;
  return (
    <span className={`svc-badge ${media.provider} ${className}`}>
      <Icon name="play" fill size="0.9em" /> {SERVICE_NAME[media.provider]}
    </span>
  );
}

/** Shown over a title the viewer can't watch because they don't have its service. */
function Locked({ media }: { media: Media }) {
  if (iCanWatch(media)) return null;
  return (
    <span className="locked">
      <Icon name="lock" size="1.1em" /> Needs {SERVICE_NAME[media.provider as keyof typeof SERVICE_NAME]}
    </span>
  );
}

export function JamCard({ jam, onSelect }: { jam: Jam; onSelect: () => void }) {
  useTick();
  const users = useStore((s) => s.world.users);
  const me = useMe();
  const media = mediaById(jam.mediaId);
  const host = users.find((u) => u.id === jam.hostId);
  const members = jam.members.map((m) => users.find((u) => u.id === m)).filter(Boolean) as PublicUser[];
  if (!media || !host) return null;
  const pos = jamPosition(jam, media);
  const mine = me && jam.members.includes(me.user.id);
  return (
    <button className="card jam-card" data-focus onClick={onSelect}>
      <span className="card-art">
        <Still media={media} />
        <span className="card-shade" />
        <span className="pill live">
          <i className="dot" /> {mine ? 'YOUR JAM' : 'LIVE'} · {jam.members.length}
        </span>
        {jam.privacy !== 'public' && (
          <span className="pill privacy">
            <Icon name={jam.privacy === 'invite' ? 'lock' : 'friends'} size="1em" />
          </span>
        )}
        <Locked media={media} />
        <span className="card-over">
          <ServiceBadge media={media} />
          <span className="card-title">{media.title}</span>
          <span className="card-sub">{jam.name}</span>
        </span>
        <Progress value={pos / media.runtime} className="card-progress" />
      </span>
      <span className="card-meta">
        <Avatar name={host.name} color={host.color} size={2.4} ring="live" />
        <span className="card-meta-text">
          <b>{host.name}</b>
          <span>
            {host.place.city} · {localTime(host.place.tz)}
          </span>
        </span>
        <AvatarStack people={members.filter((m) => m.id !== host.id)} size={1.8} max={3} />
      </span>
    </button>
  );
}

export function MediaCard({ media, onSelect, big }: { media: Media; onSelect: () => void; big?: boolean }) {
  return (
    <button className={`card media-card ${big ? 'big' : ''}`} data-focus onClick={onSelect}>
      <span className="card-art">
        <Still media={media} />
        <span className="card-shade" />
        <Locked media={media} />
        <span className="card-over">
          <ServiceBadge media={media} />
          <span className="card-title">{media.title}</span>
          <span className="card-sub">
            {media.subtitle ? `${media.subtitle} · ` : `${media.year} · `}
            {media.genre} · {media.provider === 'firejam' ? '' : '~'}
            {Math.round(media.runtime / 60)} min
          </span>
        </span>
      </span>
    </button>
  );
}

/** One line describing what someone is up to right now. */
export function StatusLine({ user }: { user: PublicUser }) {
  const now = useTick();
  const jam = jamById(user.jamId);
  const media = jam && mediaById(jam.mediaId);
  if (jam && media) {
    const others = jam.members.length - 1;
    return (
      <span className="status watching">
        <i className="dot" /> Watching <b>{media.title}</b>
        {media.provider !== 'firejam' && ` on ${SERVICE_NAME[media.provider]}`}
        {others > 0 ? ` with ${others} other${others > 1 ? 's' : ''}` : ''} · {clock(jamPosition(jam, media))}
      </span>
    );
  }
  const np = user.nowPlaying;
  if (np) {
    return (
      <span className="status watching solo">
        <i className="dot" /> Watching {np.title ? <><b>{np.title}</b> on {np.app}</> : <b>{np.app}</b>}
        {np.position > 0 && ` · ${clock(nowPlayingPosition(np, now))}`}
      </span>
    );
  }
  if (user.online) return <span className="status online"><i className="dot" /> Online</span>;
  const last = user.recent[0];
  if (last && last.at + last.seconds * 1000 > user.lastSeen - 60_000) {
    return (
      <span className="status offline">
        Watched <b>{last.title}</b> · {ago(last.at + last.seconds * 1000, now)}
      </span>
    );
  }
  return <span className="status offline">Last seen {ago(user.lastSeen, now)}</span>;
}

/** One line of history: "The Boys · Prime Video · with Leo · 3h ago". */
export function HistoryLine({ entry, users }: { entry: HistoryEntry; users: PublicUser[] }) {
  const now = useTick();
  const meId = useMe()?.user.id;
  const names = entry.with.map((id) => (id === meId ? 'you' : users.find((u) => u.id === id)?.name)).filter(Boolean);
  return (
    <span className="history-line">
      <b>{entry.title}</b>
      <span className="muted">
        {entry.app}
        {names.length ? ` · with ${names.join(', ')}` : ''} · {ago(entry.at + entry.seconds * 1000, now)}
      </span>
    </span>
  );
}

export type Activity =
  | { kind: 'now'; user: PublicUser; at: number }
  | { kind: 'past'; user: PublicUser; entry: HistoryEntry; at: number };

/** Friend activity, newest first: what friends are watching on their own TVs, then what they watched. */
export function friendActivity(friends: PublicUser[]): Activity[] {
  const items: Activity[] = [];
  for (const u of friends) {
    if (u.nowPlaying) items.push({ kind: 'now', user: u, at: u.nowPlaying.since });
    for (const entry of u.recent.slice(0, 2)) items.push({ kind: 'past', user: u, entry, at: entry.at + entry.seconds * 1000 });
  }
  return items.sort((a, b) => Number(b.kind === 'now') - Number(a.kind === 'now') || b.at - a.at).slice(0, 12);
}

export function ActivityCard({ item, onSelect }: { item: Activity; onSelect: () => void }) {
  const now = useTick();
  const users = useStore((s) => s.world.users);
  const meId = useMe()?.user.id;
  const u = item.user;
  if (item.kind === 'now') {
    const np = u.nowPlaying!;
    return (
      <button className="card activity-card now" data-focus onClick={onSelect}>
        <Avatar name={u.name} color={u.color} size={4} ring="live" />
        <span className="person-text">
          <b>{u.name}</b>
          <span className="activity-text">
            is watching {np.title ? <><em>{np.title}</em> on {np.app}</> : <em>{np.app}</em>}
          </span>
          <span className="muted">
            {np.position > 0 ? `${clock(nowPlayingPosition(np, now))} in · ` : ''}
            {u.place.city} · {localTime(u.place.tz, now)}
          </span>
        </span>
      </button>
    );
  }
  const { entry } = item;
  const names = entry.with.map((id) => (id === meId ? 'you' : users.find((x) => x.id === id)?.name)).filter(Boolean);
  return (
    <button className="card activity-card" data-focus onClick={onSelect}>
      <Avatar name={u.name} color={u.color} size={4} ring={u.jamId ? 'live' : u.online ? 'online' : 'offline'} />
      <span className="person-text">
        <b>{u.name}</b>
        <span className="activity-text">
          watched <em>{entry.title}</em>
          {names.length ? ` with ${names.join(', ')}` : ''}
        </span>
        <span className="muted">
          {entry.app} · {ago(item.at, now)}
        </span>
      </span>
    </button>
  );
}

export function PersonCard({ user, onSelect }: { user: PublicUser; onSelect: () => void }) {
  useTick();
  const rel = relationTo(user.id);
  const ring = user.jamId ? 'live' : user.online ? 'online' : 'offline';
  return (
    <button className="card person-card" data-focus onClick={onSelect}>
      <Avatar name={user.name} color={user.color} size={4.4} ring={ring} />
      <span className="person-text">
        <b>
          {user.name}
          {rel === 'outgoing' && <em className="tag">Requested</em>}
          {user.isBot && <em className="tag demo">Demo</em>}
        </b>
        <span className="muted">
          {user.place.city} · {localTime(user.place.tz)}
        </span>
        <StatusLine user={user} />
      </span>
    </button>
  );
}
