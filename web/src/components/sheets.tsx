import { useState } from 'react';
import { canWatch, SERVICE_NAME } from '../../../shared/playhead';
import type { JamPrivacy, Media, Service } from '../../../shared/protocol';
import {
  addFriend,
  answerFriend,
  inviteToJam,
  joinByCode,
  joinJam,
  relationTo,
  setGhost,
  setServices,
  setName,
  setShare,
  startJam,
  watchTogether,
  switchProfile,
} from '../lib/actions';
import { clock, localTime, nowPlayingPosition, PRIVACY_HINT, PRIVACY_LABEL } from '../lib/format';
import { nativeInfo } from '../lib/native';
import { iCanWatch, jamById, jamPosition, mediaById, pushToast, useMe, useStore, useTick } from '../lib/store';
import { HistoryLine, ServiceBadge, Still, StatusLine } from './cards';
import { Icon } from './Icon';
import { Avatar, Btn, Modal, Progress } from './ui';

/** Everything you can do with one person: join them, befriend them, invite them. */
export function PersonSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  useTick();
  const me = useMe();
  const user = useStore((s) => s.world.users.find((u) => u.id === userId));
  if (!user || !me) return null;
  const rel = relationTo(user.id);
  const jam = jamById(user.jamId);
  const media = jam && mediaById(jam.mediaId);
  const myJam = jamById(me.user.jamId);
  const inMyJam = !!myJam && myJam.members.includes(user.id);
  const walkIn = jam && (jam.privacy === 'public' || (jam.privacy === 'friends' && rel === 'friend'));
  const asked = me.pendingJoin === jam?.id;
  // Titles on a service (Prime Video) need everyone in the jam to have it.
  const service = media && media.provider !== 'firejam' ? media.provider : null;
  const iCan = !media || iCanWatch(media);
  const myMedia = myJam && mediaById(myJam.mediaId);
  const theyCanJoinMine = !myMedia || canWatch(user.services, myMedia);
  // Watching on their own TV, outside FireJam. A service title FireJam can sync becomes "watch together".
  const np = user.nowPlaying;
  const npMedia = np?.mediaId ? mediaById(np.mediaId) : undefined;
  const npService = npMedia && npMedia.provider !== 'firejam' ? npMedia.provider : null;
  const canTogether = !!npMedia && rel === 'friend' && iCanWatch(npMedia);
  const allUsers = useStore((s) => s.world.users);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <Modal onClose={onClose} label={user.name} className="person-sheet">
      {media && <Still media={media} className="sheet-bg" />}
      <div className="sheet-body">
        <div className="sheet-head">
          <Avatar name={user.name} color={user.color} size={7} ring={user.jamId ? 'live' : user.online ? 'online' : 'offline'} />
          <div>
            <h2>{user.name}</h2>
            <p className="muted big">
              {user.place.city}, {user.place.country} · <b>{localTime(user.place.tz)}</b> there
            </p>
            <StatusLine user={user} />
          </div>
        </div>
        {jam && media && (
          <div className="sheet-jam">
            <span className="eyebrow">{jam.name}</span>
            <b>
              {media.title} <ServiceBadge media={media} />
            </b>
            {service && (
              <span className={`svc-note ${iCan ? 'ok' : ''}`}>
                {iCan
                  ? rel === 'me' || inMyJam
                    ? `Playing in ${SERVICE_NAME[service]} on each TV`
                    : `You both have ${SERVICE_NAME[service]}, so you can watch together`
                  : `${user.name} is watching on ${SERVICE_NAME[service]}. You need ${SERVICE_NAME[service]} to join.`}
              </span>
            )}
            <Progress value={jamPosition(jam, media) / media.runtime} />
            <span className="muted">
              {clock(jamPosition(jam, media))} / {clock(media.runtime)} · {jam.members.length} watching ·{' '}
              {PRIVACY_LABEL[jam.privacy]}
            </span>
          </div>
        )}
        {np && (
          <div className="sheet-jam">
            <span className="eyebrow">On their own TV</span>
            <b>
              {np.title || np.app} {npMedia && <ServiceBadge media={npMedia} />}
            </b>
            <span className="muted">
              {np.playing ? 'Playing' : 'Paused'} in {np.app} · {clock(nowPlayingPosition(np))} in
            </span>
            {rel === 'friend' && (
              <span className={`svc-note ${canTogether ? 'ok' : ''}`}>
                {!npMedia
                  ? `FireJam can't sync ${np.app} yet, but you can see what they're into.`
                  : canTogether
                    ? `You both have ${SERVICE_NAME[npService!]}. Start a jam from where ${user.name} is and they'll get an invite.`
                    : `${user.name} is watching on ${SERVICE_NAME[npService!]}. You need ${SERVICE_NAME[npService!]} to watch together.`}
              </span>
            )}
          </div>
        )}
        {!!user.recent.length && (
          <div className="history">
            <span className="eyebrow">Recently watched</span>
            {user.recent.slice(0, 4).map((h) => (
              <HistoryLine key={h.id} entry={h} users={allUsers} />
            ))}
          </div>
        )}
        <div className="sheet-actions">
          {np && canTogether && !jam && (
            <Btn
              kind="primary"
              autoFocus
              icon={<Icon name="play" fill />}
              onClick={act(() => watchTogether(user.id, npMedia!.id, nowPlayingPosition(np)))}
            >
              Watch together
            </Btn>
          )}
          {np && npService && !canTogether && rel === 'friend' && (
            <Btn autoFocus icon={<Icon name="check" />} onClick={() => setServices([...me.user.services, npService])}>
              I have {SERVICE_NAME[npService]}
            </Btn>
          )}
          {jam && rel !== 'me' && !inMyJam && iCan && (
            <Btn kind="primary" autoFocus icon={<Icon name="play" fill />} disabled={asked} onClick={act(() => joinJam(jam.id))}>
              {asked ? 'Waiting for host…' : walkIn ? `Join ${user.name}` : 'Ask to join'}
            </Btn>
          )}
          {jam && rel !== 'me' && !inMyJam && !iCan && service && (
            <Btn autoFocus icon={<Icon name="check" />} onClick={() => setServices([...me.user.services, service])}>
              I have {SERVICE_NAME[service]}
            </Btn>
          )}
          {myJam && rel === 'friend' && !inMyJam && (
            <Btn
              kind={jam ? 'ghost' : 'primary'}
              autoFocus={!jam}
              disabled={!theyCanJoinMine}
              icon={<Icon name="invite" />}
              onClick={act(() => inviteToJam(user.id))}
            >
              {theyCanJoinMine ? 'Invite to my jam' : `No ${SERVICE_NAME[myMedia!.provider as Service]}`}
            </Btn>
          )}
          {rel === 'stranger' && (
            <Btn icon={<Icon name="plus" />} autoFocus={!jam} onClick={act(() => addFriend(user.id))}>
              Add friend
            </Btn>
          )}
          {rel === 'incoming' && (
            <>
              <Btn kind="primary" autoFocus icon={<Icon name="check" />} onClick={act(() => answerFriend(user.id, true))}>
                Accept friend
              </Btn>
              <Btn onClick={act(() => answerFriend(user.id, false))}>Decline</Btn>
            </>
          )}
          {rel === 'outgoing' && <span className="tag big">Friend request sent</span>}
          {rel === 'friend' && <span className="tag big ok"><Icon name="check" size="1em" /> Friends</span>}
          <Btn kind="quiet" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

const PRIVACIES: JamPrivacy[] = ['friends', 'public', 'invite'];

export function StartJamSheet({ media, onClose, reason }: { media: Media; onClose: () => void; reason?: string }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const service = media.provider !== 'firejam' ? media.provider : null;
  const allowed = iCanWatch(media);
  const go = async (p: JamPrivacy) => {
    setBusy(true);
    try {
      // Paused until the host has shared the invite QR (Player shows it first).
      await startJam(media.id, p, { paused: true });
    } catch (e) {
      pushToast({ kind: 'info', text: (e as Error).message });
    } finally {
      onClose();
    }
  };
  return (
    <Modal onClose={onClose} label={`Start ${media.title}`} className="start-sheet">
      <Still media={media} className="sheet-bg" />
      <div className="sheet-body">
        <span className="eyebrow">Start a Jam</span>
        <h2>
          {media.title} <ServiceBadge media={media} />
        </h2>
        <p className="muted big">
          {media.subtitle ? `${media.subtitle} · ` : ''}
          {media.year} · {media.genre} · {service ? '~' : ''}
          {Math.round(media.runtime / 60)} min
        </p>
        <p className="logline">{media.logline}</p>
        {reason && <p className="pick-reason">✨ {reason}</p>}
        {service && (
          <p className={`svc-note ${allowed ? 'ok' : ''}`}>
            {allowed
              ? `Every TV plays it in its own ${SERVICE_NAME[service]} app and FireJam keeps them in step. Only friends who have ${SERVICE_NAME[service]} can join.`
              : `This plays in ${SERVICE_NAME[service]}. Everyone in the jam needs it, you included.`}
          </p>
        )}
        {!allowed && service && me && (
          <div className="sheet-actions">
            <Btn kind="primary" autoFocus icon={<Icon name="check" />} onClick={() => setServices([...me.user.services, service])}>
              I have {SERVICE_NAME[service]}
            </Btn>
            <Btn kind="quiet" onClick={onClose}>
              Not now
            </Btn>
          </div>
        )}
        <div className="privacy-options">
          {PRIVACIES.map((p, i) => (
            <button
              key={p}
              className="option"
              data-focus
              data-autofocus={(allowed && i === 0) || undefined}
              disabled={busy || !allowed}
              onClick={() => go(p)}
            >
              <Icon name={p === 'public' ? 'globe' : p === 'invite' ? 'lock' : 'friends'} size="2rem" />
              <b>{PRIVACY_LABEL[p]}</b>
              <span>{PRIVACY_HINT[p]}</span>
            </button>
          ))}
        </div>
        <p className="credit">{media.credit}</p>
      </div>
    </Modal>
  );
}

export function JoinCodeSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const submit = async () => {
    if (await joinByCode(code)) onClose();
  };
  return (
    <Modal onClose={onClose} label="Join with a code" className="code-sheet">
      <div className="sheet-body">
        <span className="eyebrow">Join with a code</span>
        <h2>Got a Jam code?</h2>
        <p className="muted big">It's on the host's screen, top left. Four letters or numbers.</p>
        <input
          className="code-input"
          data-focus
          data-autofocus
          maxLength={4}
          value={code}
          placeholder="K7QF"
          enterKeyHint="go"
          onChange={(e) => {
            const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            setCode(next);
            // The fourth character joins: no hunting for a button behind Fire TV's keyboard.
            if (next.length === 4 && next !== code) void joinByCode(next).then((ok) => ok && onClose());
          }}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && submit()}
        />
        <div className="sheet-actions">
          <Btn kind="primary" disabled={code.length !== 4} onClick={submit}>
            Join
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            Cancel
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  useTick();
  const me = useMe();
  if (!me) return null;
  const u = me.user;
  return (
    <Modal onClose={onClose} label="Profile" className="profile-sheet">
      <div className="sheet-body">
        <div className="sheet-head">
          <Avatar name={u.name} color={u.color} size={7} ring="online" />
          <div>
            <h2>{u.name}</h2>
            <p className="muted big">
              {u.place.city}, {u.place.country} · {localTime(u.place.tz)}
            </p>
          </div>
        </div>
        <NameField name={u.name} />
        <PrimeToggle services={u.services} />
        <button className="option wide" data-focus onClick={() => setShare(!me.shareActivity)}>
          <Icon name="friends" size="2rem" />
          <b>Share what I watch {me.shareActivity ? 'on' : 'off'}</b>
          <span>
            {me.shareActivity
              ? 'Friends see what you watch, in FireJam and on your own (e.g. Prime Video), and what you watched recently.'
              : 'Friends only see jams you are in. Nothing you watch on your own is shared.'}
          </span>
        </button>
        <button className="option wide" data-focus onClick={() => setGhost(!me.ghost)}>
          <Icon name="ghost" size="2rem" />
          <b>Ghost mode {me.ghost ? 'on' : 'off'}</b>
          <span>{me.ghost ? 'Hidden from the Jam Map. Friends can still invite you.' : 'Friends see your pin on the Jam Map.'}</span>
        </button>
        <div className="sheet-actions">
          <Btn icon={<Icon name="user" />} onClick={switchProfile}>
            Switch profile
          </Btn>
          <Btn kind="quiet" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/** What friends call you, changed with the TV keyboard (Fire TV doesn't share its profile names with apps). */
function NameField({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  const save = async () => {
    if (value.trim() === name) return setEditing(false);
    try {
      await setName(value);
      setEditing(false);
      pushToast({ kind: 'info', text: `Friends now see you as ${value.trim()}` });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!editing) {
    return (
      <button className="option wide" data-focus onClick={() => (setValue(name), setEditing(true))}>
        <Icon name="user" size="2rem" />
        <b>Name: {name}</b>
        <span>Change what friends call you.</span>
      </button>
    );
  }
  return (
    <div className="name-edit">
      <input
        className="name-input"
        data-focus
        data-autofocus
        autoFocus
        maxLength={20}
        enterKeyHint="done"
        value={value}
        onChange={(e) => (setValue(e.target.value), setError(''))}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && void save()}
      />
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <Btn kind="primary" disabled={!value.trim()} onClick={save}>
          Save name
        </Btn>
        <Btn kind="quiet" onClick={() => setEditing(false)}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

/** "I have Prime Video" switch. On a Fire TV it also says whether the Prime Video app is on this TV. */
export function PrimeToggle({ services, autoFocus = true }: { services: Service[]; autoFocus?: boolean }) {
  const has = services.includes('prime');
  const device = nativeInfo();
  const toggle = () => setServices(has ? services.filter((s) => s !== 'prime') : [...services, 'prime']);
  return (
    <button className={`option wide svc-toggle ${has ? 'on' : ''}`} data-focus data-autofocus={autoFocus || undefined} onClick={toggle}>
      <span className="svc-badge prime big">
        <Icon name="play" fill size="0.9em" /> Prime Video
      </span>
      <b>{has ? 'I have Prime Video' : "I don't have Prime Video"}</b>
      <span>
        {has
          ? 'You can join and start Prime Video jams with friends who have it too.'
          : 'Turn on to watch Prime Video titles together. Everyone in a Prime jam needs their own Prime.'}
        {device && (device.primeInstalled ? ' Prime Video app found on this TV.' : ' Prime Video app not found on this TV.')}
      </span>
    </button>
  );
}
