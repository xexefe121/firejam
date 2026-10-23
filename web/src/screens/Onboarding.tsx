import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../../../shared/protocol';
import { Flame, Icon } from '../components/Icon';
import { Avatar, Btn } from '../components/ui';
import { localTime } from '../lib/format';
import { nativeInfo } from '../lib/native';
import { focusFirst } from '../lib/nav';
import { device, emitAck, hello, knownProfiles, rememberUser, socket, storedUserId, useStore } from '../lib/store';

// Where someone is (their Jam Map pin and the local time friends see) comes from the
// device's time zone, so there's nothing to pick.
const timezone = () => device?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Onboarding() {
  // On a Fire TV the store already fetched this TV's profiles; a browser lists everyone (demo screens).
  const tvProfiles = useStore((s) => s.deviceProfiles);
  const newTvProfile = useStore((s) => s.newTvProfile);
  const [step, setStep] = useState<'pick' | 'new'>(() => (device && !tvProfiles.length ? 'new' : 'pick'));
  const [profiles, setProfiles] = useState<PublicUser[]>(tvProfiles);
  // Prefilled from the TV: owner's name and Prime if the app is installed.
  const [name, setName] = useState(() => (device && !tvProfiles.length ? device.ownerName ?? '' : ''));
  const [prime, setPrime] = useState(() => !!(device?.primeInstalled ?? nativeInfo()?.primeInstalled));
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const last = storedUserId();

  useEffect(() => {
    if (device) return;
    emitAck<PublicUser[]>((ack) => socket.emit('profile:list', { mine: knownProfiles() }, ack)).then(setProfiles, () => setProfiles([]));
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current && focusFirst(ref.current), 0);
    return () => clearTimeout(id);
  }, [step, profiles.length]);

  const pick = (id: string) => {
    rememberUser(id);
    hello(id);
  };
  const create = async () => {
    if (!name.trim()) return setError('Type a name first');
    try {
      const { userId } = await emitAck<{ userId: string }>((ack) =>
        socket.emit(
          'profile:create',
          { name, tz: timezone(), services: prime ? ['prime'] : [], deviceId: device?.deviceId, tvProfile: device?.tvProfile ?? undefined },
          ack,
        ),
      );
      rememberUser(userId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const real = profiles.filter((p) => !p.isBot);
  const demo = profiles.filter((p) => p.isBot);

  return (
    <div className="onboarding" ref={ref}>
      <div className="brand">
        <Flame size="7rem" />
        <h1>
          Fire<span>Jam</span>
        </h1>
        <p className="lede">
          The living room is back.
          <br />
          Watch together with the people you love, wherever they are.
        </p>
        <ul className="brand-points">
          <li><Icon name="map" /> See what friends are watching on the Jam Map</li>
          <li><Icon name="play" fill /> Join in one click, land on the same frame</li>
          <li><Icon name="phone" /> React and chat from your phone</li>
        </ul>
      </div>

      {step === 'pick' ? (
        <div className="who">
          <h2>Who's watching?</h2>
          {newTvProfile && (
            <p className="muted big who-note">New Fire TV profile. Pick once: from now on FireJam switches whenever you switch Fire TV profiles.</p>
          )}
          <div className="profile-grid">
            <button className="profile new" data-focus data-autofocus={!real.length || newTvProfile || undefined} onClick={() => setStep('new')}>
              <span className="avatar plus">
                <Icon name="plus" size="2.6rem" />
              </span>
              <b>{device ? 'Someone else' : 'New profile'}</b>
              <span className="muted">{device ? 'Just a name' : 'Takes 10 seconds'}</span>
            </button>
            {real.map((p, i) => (
              <button
                key={p.id}
                className="profile"
                data-focus
                data-autofocus={(!newTvProfile && (last ? p.id === last : i === 0)) || undefined}
                onClick={() => pick(p.id)}
              >
                <Avatar name={p.name} color={p.color} size={6} ring={p.online ? 'online' : 'none'} />
                <b>{p.name}</b>
                <span className="muted">{p.place.city}</span>
              </button>
            ))}
          </div>
          {demo.length > 0 && !device && (
            <>
              <h3>
                Or try a demo profile <span>Great for a second screen in a demo</span>
              </h3>
              <div className="profile-grid">
                {demo.map((p) => (
                  <button key={p.id} className="profile small" data-focus onClick={() => pick(p.id)}>
                    <Avatar name={p.name} color={p.color} size={4.4} />
                    <b>{p.name}</b>
                    <span className="muted">
                      {p.place.city} · {localTime(p.place.tz)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="who">
          <h2>What should friends call you?</h2>
          <input
            className="name-input"
            data-focus
            data-autofocus
            maxLength={20}
            placeholder="Your name"
            enterKeyHint="done"
            value={name}
            onChange={(e) => (setName(e.target.value), setError(''))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && focusFirst(document.querySelector<HTMLElement>('.start-row')!)}
          />
          <h3>Streaming you already have</h3>
          <div className="chips">
            <button className={`chip svc-chip ${prime ? 'on' : ''}`} data-focus onClick={() => setPrime(!prime)}>
              <Icon name={prime ? 'check' : 'plus'} size="1.3rem" /> Prime Video
              <i>{prime ? 'Prime jams unlocked' : 'Tap if you have it'}</i>
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {device && <p className="muted big">Prime Video is set from the apps on this TV. Change it any time in your profile.</p>}
          <div className="sheet-actions start-row">
            <Btn kind="primary" autoFocus={!!device && !!name} icon={<Icon name="play" fill />} onClick={create}>
              Start watching together
            </Btn>
            <Btn kind="quiet" onClick={() => setStep('pick')}>
              Back
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
