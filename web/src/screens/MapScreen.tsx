import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import { useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { PublicUser } from '../../../shared/protocol';
import { StatusLine } from '../components/cards';
import { Icon } from '../components/Icon';
import { PersonSheet } from '../components/sheets';
import { Avatar } from '../components/ui';
import { setGhost } from '../lib/actions';
import { localTime } from '../lib/format';
import { useAutoFocus } from '../lib/nav';
import { jamById, mediaById, useMe, useStore, useTick } from '../lib/store';

// Snap-Map-style world view of who's watching what. Pins are HTML buttons laid
// over an SVG map so the D-pad can hop between people; arcs connect everyone
// sharing a jam, which is the whole point: Sydney and Hyderabad on the same couch.

const W = 1600;
const H = 800;

const topo = world as unknown as Topology;
const countries = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
const land: FeatureCollection = { type: 'FeatureCollection', features: countries.features.filter((f) => f.id !== '010') };
const projection = geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], land);
const path = geoPath(projection);
const LAND_D = path(land) ?? '';
const GRATICULE_D = path(geoGraticule10()) ?? '';

interface Pin {
  user: PublicUser;
  x: number; // where the pin is drawn
  y: number;
  ax: number; // where the person actually is
  ay: number;
}

/** Nudge overlapping pins apart so every person stays reachable with the D-pad. */
function layout(users: PublicUser[]): Pin[] {
  const pins = users.map((user) => {
    const [ax, ay] = projection([user.place.lon, user.place.lat]) ?? [0, 0];
    return { user, x: ax, y: ay, ax, ay };
  });
  const MIN = 78;
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i];
        const b = pins[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 0.01) {
          dx = Math.cos(j * 2.4);
          dy = Math.sin(j * 2.4);
          d = 1;
        }
        const push = (MIN - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }
  return pins;
}

export function MapScreen() {
  useTick();
  const me = useMe();
  const users = useStore((s) => s.world.users);
  const jams = useStore((s) => s.world.jams);
  const [filter, setFilter] = useState<'everyone' | 'friends'>('everyone');
  const [focused, setFocused] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref);

  const friendSet = new Set(me?.friends);
  const visible = users.filter((u) => u.onMap && (filter === 'everyone' || friendSet.has(u.id) || u.id === me?.user.id));
  const visibleIds = visible.map((u) => u.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pins = useMemo(() => layout(visible), [visibleIds]);
  const byId = new Map(pins.map((p) => [p.user.id, p]));

  const arcs = jams.flatMap((jam) => {
    const host = byId.get(jam.hostId) ?? byId.get(jam.members.find((m) => byId.has(m)) ?? '');
    if (!host) return [];
    return jam.members
      .filter((m) => m !== host.user.id && byId.has(m))
      .map((m) => {
        const other = byId.get(m)!.user;
        const d = path({ type: 'LineString', coordinates: [[host.user.place.lon, host.user.place.lat], [other.place.lon, other.place.lat]] });
        return { key: `${jam.id}-${m}`, d: d ?? '', mine: jam.members.includes(me?.user.id ?? '') };
      });
  });

  const live = visible.filter((u) => u.jamId);
  const cities = new Set(live.map((u) => u.place.id)).size;
  const autoId = (visible.find((u) => u.jamId && friendSet.has(u.id)) ?? visible.find((u) => u.id === me?.user.id))?.id;
  const focusPin = focused ? byId.get(focused) : undefined;

  return (
    <div className="screen map-screen" ref={ref}>
      <header className="map-head">
        <div>
          <h1>Jam Map</h1>
          <p className="muted big">
            {live.length} {live.length === 1 ? 'person' : 'people'} watching in {cities} {cities === 1 ? 'city' : 'cities'} right now
          </p>
        </div>
        <div className="chips">
          <button className={`chip ${filter === 'everyone' ? 'on' : ''}`} data-focus onClick={() => setFilter('everyone')}>
            <Icon name="globe" size="1.4rem" /> Everyone
          </button>
          <button className={`chip ${filter === 'friends' ? 'on' : ''}`} data-focus onClick={() => setFilter('friends')}>
            <Icon name="friends" size="1.4rem" /> Friends
          </button>
          <button className={`chip ${me?.ghost ? 'on' : ''}`} data-focus onClick={() => setGhost(!me?.ghost)}>
            <Icon name="ghost" size="1.4rem" /> Ghost {me?.ghost ? 'on' : 'off'}
          </button>
        </div>
      </header>

      <div className="map-stage">
        <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" aria-hidden>
          <defs>
            <pattern id="land-dots" width="7" height="7" patternUnits="userSpaceOnUse">
              <circle cx="3.5" cy="3.5" r="1.6" className="land-dot" />
            </pattern>
          </defs>
          <path d={GRATICULE_D} className="graticule" />
          <path d={LAND_D} className="land" />
          <path d={LAND_D} fill="url(#land-dots)" />
          {arcs.map((a) => (
            <path key={a.key} d={a.d} className={`arc ${a.mine ? 'mine' : ''}`} />
          ))}
          {pins.map((p) =>
            Math.hypot(p.x - p.ax, p.y - p.ay) > 4 ? (
              <g key={p.user.id}>
                <line x1={p.ax} y1={p.ay} x2={p.x} y2={p.y} className="leader" />
                <circle cx={p.ax} cy={p.ay} r={3} className="anchor" />
              </g>
            ) : null,
          )}
        </svg>

        {pins.map((p) => {
          const u = p.user;
          const isMe = u.id === me?.user.id;
          const jam = jamById(u.jamId);
          const media = jam && mediaById(jam.mediaId);
          return (
            <button
              key={u.id}
              className={`pin ${u.jamId ? 'live' : ''} ${u.online ? '' : 'away'} ${isMe ? 'me' : ''} ${friendSet.has(u.id) ? 'friend' : ''}`}
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
              data-focus
              data-autofocus={u.id === autoId || undefined}
              onFocus={() => setFocused(u.id)}
              onBlur={() => setFocused((f) => (f === u.id ? null : f))}
              onClick={() => !isMe && setOpen(u.id)}
            >
              <span className="pin-dot" data-nav-rect>
                <Avatar name={u.name} color={u.color} size={3.4} ring={u.jamId ? 'live' : u.online ? 'online' : 'offline'} />
              </span>
              <span className="pin-label">
                {isMe ? 'You' : u.name}
                {media && <i> · {media.title}</i>}
              </span>
            </button>
          );
        })}

        {focusPin && (
          <PinCard pin={focusPin} isMe={focusPin.user.id === me?.user.id} friend={friendSet.has(focusPin.user.id)} />
        )}
      </div>

      <footer className="map-legend">
        <span><i className="dot live" /> In a jam</span>
        <span><i className="dot online" /> Online</span>
        <span><i className="dot offline" /> Away</span>
        <span className="muted">Press OK on someone to join, add or invite them</span>
      </footer>

      {open && <PersonSheet userId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PinCard({ pin, isMe, friend }: { pin: Pin; isMe: boolean; friend: boolean }) {
  const u = pin.user;
  const right = pin.x < W * 0.62;
  return (
    <div
      className={`pin-card ${right ? 'right' : 'left'}`}
      style={{ left: `${(pin.x / W) * 100}%`, top: `${(pin.y / H) * 100}%` }}
    >
      <b>
        {isMe ? 'You' : u.name}
        {!isMe && <em className={`tag ${friend ? 'ok' : ''}`}>{friend ? 'Friend' : 'Public jam'}</em>}
      </b>
      <span className="muted">
        {u.place.city}, {u.place.country} · {localTime(u.place.tz)}
      </span>
      <StatusLine user={u} />
    </div>
  );
}
