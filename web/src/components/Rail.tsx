import { useState } from 'react';
import { go, type Screen, useMe, useStore } from '../lib/store';
import { Flame, Icon } from './Icon';
import { ProfileSheet } from './sheets';
import { Avatar } from './ui';

const ITEMS: { screen: Screen; icon: string; label: string }[] = [
  { screen: 'home', icon: 'home', label: 'Home' },
  { screen: 'map', icon: 'map', label: 'Jam Map' },
  { screen: 'friends', icon: 'friends', label: 'Friends' },
  { screen: 'library', icon: 'film', label: 'Watch' },
];

export function Rail() {
  const screen = useStore((s) => s.screen);
  const me = useMe();
  const online = useStore((s) => s.online);
  const [profile, setProfile] = useState(false);
  return (
    <nav className="rail" data-group>
      <div className="rail-logo" title="FireJam">
        <Flame size="3rem" />
      </div>
      {ITEMS.map((it) => (
        <button
          key={it.screen}
          className={`rail-item ${screen === it.screen ? 'active' : ''}`}
          data-focus
          data-group-entry={screen === it.screen ? '' : undefined}
          onClick={() => go(it.screen)}
        >
          <Icon name={it.icon} size="2.2rem" />
          <span>{it.label}</span>
          {it.screen === 'friends' && !!me?.incoming.length && <i className="badge">{me.incoming.length}</i>}
        </button>
      ))}
      <div className="rail-spacer" />
      {me && (
        <button className="rail-item rail-me" data-focus onClick={() => setProfile(true)}>
          <Avatar name={me.user.name} color={me.user.color} size={3.2} ring={online ? 'online' : 'offline'} />
          <span>{me.ghost ? 'Ghost' : me.user.name}</span>
        </button>
      )}
      {profile && <ProfileSheet onClose={() => setProfile(false)} />}
    </nav>
  );
}
