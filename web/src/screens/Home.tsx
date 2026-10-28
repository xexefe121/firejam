import { useEffect, useRef, useState } from 'react';
import type { Jam, Media, PublicUser } from '../../../shared/protocol';
import { ActivityCard, friendActivity, JamCard, MediaCard, PersonCard, Still } from '../components/cards';
import { Icon } from '../components/Icon';
import { askForPick, pickedBy } from '../components/Pick';
import { JoinCodeSheet, PersonSheet, StartJamSheet } from '../components/sheets';
import { AvatarStack, Btn, Progress } from '../components/ui';
import { joinJam } from '../lib/actions';
import { clock, localTime } from '../lib/format';
import { native, nativeInfo } from '../lib/native';
import { useAutoFocus } from '../lib/nav';
import { go, jamPosition, mediaById, useMe, useStore, useTick } from '../lib/store';

export function Home() {
  const me = useMe();
  const { users, jams } = useStore((s) => s.world);
  const catalog = useStore((s) => s.catalog);
  const [start, setStart] = useState<Media | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const pickForMe = async () => {
    setPicking(true);
    const p = await askForPick();
    setPicking(false);
    if (p) {
      setReason(`${pickedBy(p.by)}: ${p.reason}`);
      setStart(p.media);
    }
  };
  const [person, setPerson] = useState<string | null>(null);
  const [code, setCode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref);
  if (!me) return null;

  const friends = new Set(me.friends);
  const myJam = jams.find((j) => j.members.includes(me.user.id));
  // Jams a friend is hosting come first: that's someone saying "come over".
  const friendCount = (j: Jam) => j.members.filter((m) => friends.has(m)).length;
  const friendJams = jams
    .filter((j) => j !== myJam && j.members.some((m) => friends.has(m)))
    .sort(
      (a, b) =>
        Number(friends.has(b.hostId)) - Number(friends.has(a.hostId)) ||
        friendCount(b) - friendCount(a) ||
        b.members.length - a.members.length,
    );
  const worldJams = jams.filter((j) => j !== myJam && !friendJams.includes(j));
  const friendPeople = users
    .filter((u) => friends.has(u.id))
    .sort((a, b) => Number(!!b.jamId) - Number(!!a.jamId) || Number(b.online) - Number(a.online));
  const hero = myJam ?? friendJams[0];
  const activity = friendActivity(friendPeople);

  const openJam = (j: Jam) => (j === myJam ? go('player') : setPerson(j.members.find((m) => friends.has(m)) ?? j.hostId));

  return (
    <div className="screen home" ref={ref}>
      {hero ? (
        <Hero jam={hero} mine={hero === myJam} users={users} meId={me.user.id} onAlt={() => go('library')} />
      ) : (
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">FireJam</span>
            <h1>The living room is back.</h1>
            <p className="lede">Watch together with the people you love, wherever they are. Same moment, same laugh.</p>
            <div className="hero-actions">
              <Btn kind="primary" autoFocus icon={<Icon name="play" fill />} onClick={() => go('library')}>
                Start a Jam
              </Btn>
              <Btn icon={<Icon name="map" />} onClick={() => go('map')}>
                Open Jam Map
              </Btn>
            </div>
          </div>
        </section>
      )}

      <AllowAccess />

      {friendJams.length > (hero === myJam ? 0 : 1) && (
        <Row title="Friends watching now">
          {friendJams.filter((j) => j !== hero).map((j) => (
            <JamCard key={j.id} jam={j} onSelect={() => openJam(j)} />
          ))}
        </Row>
      )}

      {activity.length > 0 && (
        <Row title="Friend activity" hint="What your people are watching, and what they watched">
          {activity.map((a) => (
            <ActivityCard key={a.kind === 'now' ? `now-${a.user.id}` : a.entry.id} item={a} onSelect={() => setPerson(a.user.id)} />
          ))}
        </Row>
      )}

      <Row title="Start a Jam" hint="Pick something, then invite anyone">
        <button className="card code-card pick-card" data-focus onClick={pickForMe} disabled={picking}>
          <span className="pick-spark">✨</span>
          <b>{picking ? 'Thinking…' : 'Pick for me'}</b>
          <span>Amazon Bedrock suggests one</span>
        </button>
        {catalog.filter((m) => m.provider === 'firejam').map((m) => (
          <MediaCard key={m.id} media={m} onSelect={() => setStart(m)} />
        ))}
        <button className="card code-card" data-focus onClick={() => setCode(true)}>
          <Icon name="code" size="3rem" />
          <b>Join with code</b>
          <span>Someone shared a Jam code?</span>
        </button>
      </Row>

      <Row
        title="Watch on Prime Video"
        hint={
          me.user.services.includes('prime')
            ? 'Plays in Prime Video on every TV. Friends with Prime can join.'
            : 'Everyone in the jam needs their own Prime Video'
        }
      >
        {catalog.filter((m) => m.provider === 'prime').map((m) => (
          <MediaCard key={m.id} media={m} onSelect={() => setStart(m)} />
        ))}
      </Row>

      {friendPeople.length > 0 && (
        <Row title="Your people">
          {friendPeople.map((u) => (
            <PersonCard key={u.id} user={u} onSelect={() => setPerson(u.id)} />
          ))}
        </Row>
      )}

      {worldJams.length > 0 && (
        <Row title="Live around the world" hint="Public jams anyone can drop into">
          {worldJams.map((j) => (
            <JamCard key={j.id} jam={j} onSelect={() => setPerson(j.hostId)} />
          ))}
        </Row>
      )}

      {start && (
        <StartJamSheet
          media={start}
          reason={reason}
          onClose={() => {
            setStart(null);
            setReason(undefined);
          }}
        />
      )}
      {person && <PersonSheet userId={person} onClose={() => setPerson(null)} />}
      {code && <JoinCodeSheet onClose={() => setCode(false)} />}
    </div>
  );
}

function Hero({ jam, mine, users, meId, onAlt }: { jam: Jam; mine: boolean; users: PublicUser[]; meId: string; onAlt: () => void }) {
  useTick();
  const media = mediaById(jam.mediaId);
  const me = useMe();
  const friendIds = new Set(me?.friends);
  const host = users.find((u) => u.id === jam.hostId);
  const lead = mine ? host : users.find((u) => jam.members.includes(u.id) && friendIds.has(u.id)) ?? host;
  const members = jam.members.map((m) => users.find((u) => u.id === m)).filter(Boolean) as PublicUser[];
  if (!media || !lead) return null;
  const pos = jamPosition(jam, media);
  const asked = me?.pendingJoin === jam.id;
  const others = members.filter((m) => m.id !== meId);
  return (
    <section className="hero has-art">
      <Still media={media} className="hero-art" />
      <span className="hero-shade" />
      <div className="hero-copy">
        <span className="eyebrow live">
          <i className="dot" /> {mine ? 'YOU’RE IN A JAM' : 'LIVE NOW'} · {jam.name}
        </span>
        <h1>
          {mine ? (
            <>
              Back to <em>{media.title}</em>
            </>
          ) : (
            <>
              {lead.name} is watching <em>{media.title}</em>
            </>
          )}
        </h1>
        <p className="lede">
          {mine
            ? others.length
              ? `${others.map((o) => o.name).join(', ')} ${others.length > 1 ? 'are' : 'is'} still watching.`
              : 'Invite someone and they land on the exact same frame.'
            : `It's ${localTime(lead.place.tz)} in ${lead.place.city}. Pull up a chair.`}
        </p>
        <div className="hero-progress">
          <AvatarStack people={members} size={2.6} max={5} />
          <Progress value={pos / media.runtime} />
          <span className="muted">
            {clock(pos)} / {clock(media.runtime)}
          </span>
        </div>
        <div className="hero-actions">
          <Btn
            kind="primary"
            autoFocus
            icon={<Icon name="play" fill />}
            disabled={asked}
            onClick={() => (mine ? go('player') : joinJam(jam.id))}
          >
            {mine ? 'Resume' : asked ? 'Waiting for host…' : `Join ${lead.name}`}
          </Btn>
          <Btn icon={<Icon name="film" />} onClick={onAlt}>
            Start your own
          </Btn>
        </div>
      </div>
    </section>
  );
}

/**
 * On Android TVs one tap in Settings lets FireJam follow Prime Video, share what's on and pop up
 * friends' activity. Shown until it's allowed; Fire TV has no such screen (see README).
 */
function AllowAccess() {
  const [info, setInfo] = useState(nativeInfo);
  useEffect(() => {
    const again = () => setInfo(nativeInfo());
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);
  if (!info) return null;
  // Two switches, one at a time: following Prime Video, then pop-ups over other apps.
  const step =
    info.settingsAvailable && !info.sessionAccess
      ? {
          title: 'Turn on Prime Video sync and friend activity',
          how: 'In Settings, find FireJam under Notification access and turn it on.',
          open: () => native?.openAccessSettings(),
        }
      : info.overlaySettingsAvailable && !info.overlayAccess && native?.openOverlaySettings
        ? {
            title: "Let friends' pop-ups show over other apps",
            how: 'In Settings, turn on FireJam under Display over other apps.',
            open: () => native?.openOverlaySettings?.(),
          }
        : null;
  if (!step) return null;
  // The whole banner is one button, so Down from the hero lands on it wherever the remote is.
  return (
    <button className="allow" data-focus onClick={step.open}>
      <span className="allow-text">
        <b>{step.title}</b>
        <span className="muted">{step.how}</span>
      </span>
      <span className="btn btn-primary">Open Settings</span>
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="row">
      <h3>
        {title}
        {hint && <span>{hint}</span>}
      </h3>
      <div className="row-track">{children}</div>
    </section>
  );
}

export { Row };
