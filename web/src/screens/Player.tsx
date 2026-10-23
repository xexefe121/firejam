import { useEffect, useMemo, useRef, useState } from 'react';
import type { Jam, JamPrivacy, Media, PublicUser } from '../../../shared/protocol';
import { canWatch, SERVICE_NAME } from '../../../shared/playhead';
import { MediaCard, ServiceBadge, Still } from '../components/cards';
import { PickForUs } from '../components/Pick';
import { Flame, Icon } from '../components/Icon';
import { Avatar, AvatarStack, Btn, Modal, Progress } from '../components/ui';
import { inviteToJam, leaveJam, react, setPrivacy, startSharedJam } from '../lib/actions';
import { clock, localTime, PRIVACY_HINT, PRIVACY_LABEL } from '../lib/format';
import { native, voiceControl } from '../lib/native';
import { focusEl, scopeRoot, useKeys } from '../lib/nav';
import { openInPrime, PrimeStage, type PrimeSync, usePrimeSync } from './PrimeStage';
import { go, jamPosition, mediaById, serverNow, socket, useMe, useStore, useTick } from '../lib/store';

const REACTIONS = ['😂', '❤️', '😮', '👏', '🔥', '😢'];
const HIDE_AFTER_MS = 5000;

type SyncStatus = 'syncing' | 'synced' | 'catching' | 'paused' | 'buffering' | 'blocked';

/**
 * Keeps a <video> on the jam's shared playhead.
 *
 * Every member computes the same expected position from the jam state and the
 * server clock. Small drift is absorbed by nudging playbackRate (inaudible),
 * big drift by seeking, with a lead that learns how long seeks take on this
 * device so a slow Fire TV Stick doesn't keep landing behind.
 */
function useJamSync(video: HTMLVideoElement | null, jam: Jam, media: Media) {
  const [status, setStatus] = useState<SyncStatus>('syncing');
  const [drift, setDrift] = useState(0);
  const jamRef = useRef(jam);
  jamRef.current = jam;

  useEffect(() => {
    if (!video) return;
    let lastSeek = 0;
    let seekLead = 0.3;
    let seekStarted = 0;
    let blocked = false;
    const onSeeking = () => (seekStarted = performance.now());
    const onPlaying = () => {
      if (!seekStarted) return;
      const took = (performance.now() - seekStarted) / 1000;
      seekLead = Math.min(2, seekLead * 0.6 + took * 0.4);
      seekStarted = 0;
    };
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('playing', onPlaying);

    const timer = setInterval(() => {
      const j = jamRef.current;
      if (video.readyState < 1) return setStatus('syncing');
      const expected = jamPosition(j, media, serverNow());
      if (!j.playing) {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - expected) > 0.3 && !video.seeking) video.currentTime = expected;
        video.playbackRate = 1;
        setDrift(0);
        return setStatus('paused');
      }
      if (video.paused && !blocked) {
        video.play().catch((e: DOMException) => {
          if (e.name === 'NotAllowedError') {
            blocked = true;
            setStatus('blocked');
          }
        });
      }
      if (blocked) return;
      if (video.seeking || video.readyState < 3) return setStatus('buffering');
      const d = video.currentTime - expected;
      const sinceSeek = performance.now() - lastSeek;
      if (Math.abs(d) > 0.7 && (sinceSeek > 3000 || Math.abs(d) > 6)) {
        video.currentTime = Math.min(media.runtime, expected + seekLead);
        lastSeek = performance.now();
        video.playbackRate = 1;
        setStatus('syncing');
      } else {
        // Up to ±10% speed: imperceptible on dialogue, closes half a second in ~5s.
        video.playbackRate = Math.abs(d) > 0.04 ? Math.min(1.1, Math.max(0.9, 1 - d * 0.6)) : 1;
        setStatus(Math.abs(d) < 0.25 ? 'synced' : 'catching');
      }
      setDrift(d);
    }, 250);

    const unblock = () => {
      if (!blocked) return;
      blocked = false;
      video.play().catch(() => (blocked = true));
    };
    window.addEventListener('keydown', unblock, true);
    window.addEventListener('pointerdown', unblock, true);
    return () => {
      clearInterval(timer);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('playing', onPlaying);
      window.removeEventListener('keydown', unblock, true);
      window.removeEventListener('pointerdown', unblock, true);
    };
  }, [video, media.id, media.runtime]);

  return { status, drift };
}

/** Attach the title to the <video>, loading hls.js only for HLS streams. */
function useSource(video: HTMLVideoElement | null, media: Media) {
  useEffect(() => {
    if (!video) return;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    if (media.kind === 'hls') {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) return void (video.src = media.src);
        const h = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20 });
        h.loadSource(media.src);
        h.attachMedia(video);
        hls = h;
      });
    } else {
      video.src = media.src;
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [video, media.id, media.kind, media.src]);
}

export function Player() {
  const me = useMe();
  const jam = useStore((s) => s.world.jams.find((j) => j.members.includes(s.me?.user.id ?? '')));
  const media = mediaById(jam?.mediaId);
  // `jam:entered` can arrive a beat before the world snapshot that lists us as a member.
  useEffect(() => {
    if (jam) return;
    const t = setTimeout(() => go('home'), 3000);
    return () => clearTimeout(t);
  }, [jam]);
  if (!me || !jam || !media) return <div className="screen player"><div className="spinner" /></div>;
  return <PlayerInner jam={jam} media={media} meId={me.user.id} />;
}

type Sheet = null | 'invite' | 'change' | 'leave';

function PlayerInner({ jam, media, meId }: { jam: Jam; media: Media; meId: string }) {
  useTick();
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // FireJam's own films play in a <video> here; service titles play in the service's app on each TV.
  const external = media.provider !== 'firejam';
  const { status, drift } = useJamSync(external ? null : video, jam, media);
  useSource(external ? null : video, media);
  // A jam I just started shows its invite first; Prime Video opens once I press Start.
  const sharing = useStore((s) => s.sharing === jam.id && jam.hostId === meId);
  // Everyone waits for the host's Start, so all the TVs open Prime Video together.
  const notStarted = !jam.playing && jam.position === 0 && !jam.lastAction;
  const prime = usePrimeSync(external && !sharing && !notStarted, jam, media);
  const users = useStore((s) => s.world.users);
  const members = jam.members.map((m) => users.find((u) => u.id === m)).filter(Boolean) as PublicUser[];
  // Controls stay out of the way (and keep their hands off the focus) while a new jam's invite shows.
  const [overlay, setOverlay] = useState(!sharing);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [hud, setHud] = useState<string | null>(null);
  const hideTimer = useRef<number>();
  const hudTimer = useRef<number>();
  const controlsRef = useRef<HTMLDivElement>(null);
  const seekTarget = useRef<{ pos: number; at: number } | null>(null);

  const pos = jamPosition(jam, media);
  const ended = !external && !jam.playing && !jam.loop && pos >= media.runtime - 0.5;

  const bump = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOverlay(false), HIDE_AFTER_MS);
  };
  useEffect(() => {
    bump();
    return () => window.clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => {
    if (overlay && !sharing) setTimeout(() => focusEl(controlsRef.current?.querySelector<HTMLElement>('[data-autofocus]')), 0);
  }, [overlay, sharing]);

  const flash = (text: string) => {
    setHud(text);
    window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(null), 1200);
  };
  const toggle = () => {
    socket.emit('jam:control', { kind: jam.playing ? 'pause' : 'play' });
    flash(jam.playing ? '⏸' : '▶');
  };
  const seekBy = (delta: number) => {
    const now = performance.now();
    const base = seekTarget.current && now - seekTarget.current.at < 900 ? seekTarget.current.pos : pos;
    const target = Math.max(0, external ? base + delta : Math.min(media.runtime - 1, base + delta));
    seekTarget.current = { pos: target, at: now };
    socket.emit('jam:control', { kind: 'seek', position: target });
    flash(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}s · ${clock(target)}`);
  };

  // "Alexa, pause" / "Alexa, rewind 30 seconds": the Fire TV app hands Alexa's commands to the jam.
  const voice = useRef<ReturnType<typeof voiceControl>>();
  const latest = useRef({ jam, media });
  latest.current = { jam, media };
  useEffect(() => {
    if (external) return;
    voice.current = voiceControl(
      () => {
        const { jam: j, media: m } = latest.current;
        return { title: m.title, playing: j.playing, position: jamPosition(j, m), duration: m.runtime };
      },
      (c) => {
        const { jam: j, media: m } = latest.current;
        if (c.kind === 'seek') {
          const target = Math.max(0, Math.min(m.runtime - 1, c.position));
          socket.emit('jam:control', { kind: 'seek', position: target });
          flash(`${target < jamPosition(j, m) ? '−' : '+'} · ${clock(target)}`);
        } else {
          socket.emit('jam:control', { kind: c.kind });
          flash(c.kind === 'pause' ? '⏸' : '▶');
        }
      },
    );
    return () => voice.current?.stop();
  }, [external, media.id]);
  useEffect(() => voice.current?.report(), [jam.playing, jam.position, jam.updatedAt, media.id]);

  useKeys((key) => {
    const root = scopeRoot();
    if (root !== document.body && root !== controlsRef.current) return false; // a dialog owns the keys
    if (key === 'playpause') return toggle(), true;
    if (key === 'rewind') return seekBy(-10), true;
    if (key === 'ffwd') return seekBy(10), true;
    if (!overlay) {
      if (key === 'enter') return toggle(), setOverlay(true), true;
      if (key === 'left') return seekBy(-10), true;
      if (key === 'right') return seekBy(10), true;
      if (key === 'up' || key === 'down' || key === 'menu') return setOverlay(true), true;
      if (key === 'back') return setSheet('leave'), true;
      return false;
    }
    bump();
    const onScrubber = document.activeElement?.classList.contains('scrubber');
    if (onScrubber && (key === 'left' || key === 'right')) return seekBy(key === 'left' ? -10 : 10), true;
    if (key === 'back') return setOverlay(false), true;
    return false;
  });

  const lastControl = useStore((s) =>
    [...s.toasts].reverse().find((t) => t.kind === 'jam-control' && t.jamId === jam.id && t.by !== meId),
  );
  const controller = lastControl?.kind === 'jam-control' ? users.find((u) => u.id === lastControl.by) : undefined;
  const pausedBy = !jam.playing && jam.lastAction?.kind === 'pause' ? users.find((u) => u.id === jam.lastAction!.by) : undefined;
  const showTop = overlay || !jam.playing;

  return (
    <div className={`screen player ${overlay ? 'with-overlay' : ''}`}>
      {external ? (
        <PrimeStage jam={jam} media={media} sync={prime} members={members} />
      ) : (
        <video ref={setVideo} className="video" playsInline preload="auto" />
      )}
      <span className="player-shade" />

      <header className={`player-top ${showTop ? 'show' : ''}`}>
        <div className="jam-title">
          <Flame size="2.6rem" />
          <div>
            <b>{jam.name}</b>
            <span className="muted">
              {media.title} · {PRIVACY_LABEL[jam.privacy]} · Code <em className="code">{jam.code}</em>
            </span>
          </div>
        </div>
        <div className="members">
          {members.map((u) => (
            <div key={u.id} className="member">
              <Avatar name={u.name} color={u.color} size={3} ring={u.online ? 'live' : 'offline'} />
              <span>
                <b>{u.id === meId ? 'You' : u.name}</b>
                <i>
                  {u.place.city} · {localTime(u.place.tz)}
                </i>
              </span>
            </div>
          ))}
          {external ? <PrimePill sync={prime} /> : <SyncPill status={status} drift={drift} />}
        </div>
      </header>

      <Reactions />
      <ChatFeed lifted={overlay} />

      {controller && lastControl?.kind === 'jam-control' && (
        <div key={lastControl.id} className="control-banner">
          <Avatar name={controller.name} color={controller.color} size={2.6} />
          <span>
            <b>{controller.name}</b> {controlVerb(lastControl.control, jam.mediaId)}
          </span>
        </div>
      )}

      {hud && <div className="hud">{hud}</div>}
      {!external && status === 'blocked' && <div className="center-msg">Press OK to start watching</div>}
      {!jam.playing && !ended && !overlay && (
        <div className="center-msg paused">
          <Icon name="pause" fill size="3rem" />
          {pausedBy && pausedBy.id !== meId ? `Paused by ${pausedBy.name}` : 'Paused'}
        </div>
      )}
      {!external && status === 'buffering' && jam.playing && <div className="spinner" />}

      {overlay && !ended && (
        <div className="controls" data-trap ref={controlsRef}>
          <div className="controls-title">
            <b>{media.title}</b>
            <span className="muted">
              {clock(pos)} / {clock(media.runtime)}
            </span>
          </div>
          <button className="scrubber" data-focus aria-label="Seek">
            <Progress value={pos / media.runtime} />
          </button>
          <div className="controls-row">
            <button className="round" data-focus onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
              <Icon name="back10" size="2.2rem" />
            </button>
            <button className="round big" data-focus data-autofocus onClick={toggle} aria-label={jam.playing ? 'Pause' : 'Play'}>
              <Icon name={jam.playing ? 'pause' : 'play'} fill size="2.6rem" />
            </button>
            <button className="round" data-focus onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
              <Icon name="fwd10" size="2.2rem" />
            </button>
            <span className="sep" />
            {REACTIONS.map((e) => (
              <button key={e} className="round emoji" data-focus onClick={() => (react(e), bump())} aria-label={`React ${e}`}>
                {e}
              </button>
            ))}
            <span className="sep" />
            {external && native && (
              <Btn kind="primary" icon={<Icon name="play" fill />} onClick={() => openInPrime(media)}>
                Open {SERVICE_NAME[media.provider as keyof typeof SERVICE_NAME]}
              </Btn>
            )}
            <Btn icon={<Icon name="invite" />} onClick={() => setSheet('invite')}>
              Invite
            </Btn>
            <Btn icon={<Icon name="swap" />} onClick={() => setSheet('change')}>
              Change film
            </Btn>
            <Btn kind="quiet" icon={<Icon name="leave" />} onClick={() => setSheet('leave')}>
              Leave
            </Btn>
          </div>
        </div>
      )}

      {ended && !sheet && <EndedSheet jam={jam} media={media} members={members} onLeave={() => setSheet('leave')} />}
      {sharing && (
        <InviteSheet
          jam={jam}
          meId={meId}
          starting
          onClose={() => {
            startSharedJam();
            setOverlay(true);
            bump();
          }}
        />
      )}
      {!sharing && sheet === 'invite' && <InviteSheet jam={jam} meId={meId} onClose={() => setSheet(null)} />}
      {sheet === 'change' && <ChangeSheet current={media.id} members={members} onClose={() => setSheet(null)} />}
      {sheet === 'leave' && (
        <Modal onClose={() => setSheet(null)} label="Leave jam" className="prompt-sheet">
          <div className="sheet-body center">
            <h2>Leave {jam.name}?</h2>
            <p className="muted big">
              {members.length > 1
                ? `${members.filter((m) => m.id !== meId).map((m) => m.name).join(', ')} will keep watching.`
                : 'The jam ends when the last person leaves.'}
            </p>
            <div className="sheet-actions">
              <Btn kind="primary" autoFocus onClick={() => setSheet(null)}>
                Keep watching
              </Btn>
              <Btn icon={<Icon name="leave" />} onClick={leaveJam}>
                Leave jam
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function controlVerb(kind: string, mediaId: string) {
  switch (kind) {
    case 'play': return 'pressed play ▶';
    case 'pause': return 'paused ⏸';
    case 'seek': return 'skipped ⏩';
    default: return `switched to ${mediaById(mediaId)?.title ?? 'something new'}`;
  }
}

function SyncPill({ status, drift }: { status: SyncStatus; drift: number }) {
  const label =
    status === 'synced' ? `In sync · ${Math.round(Math.abs(drift) * 1000)} ms` :
    status === 'catching' ? `Catching up · ${Math.abs(drift).toFixed(1)}s` :
    status === 'paused' ? 'In sync · paused' :
    status === 'buffering' ? 'Buffering…' :
    status === 'blocked' ? 'Press OK' : 'Syncing…';
  return (
    <span className={`sync-pill ${status}`}>
      <i className="dot" /> {label}
    </span>
  );
}

function PrimePill({ sync }: { sync: PrimeSync }) {
  const label =
    sync.state === 'synced' ? `Prime Video in sync${sync.drift != null ? ` · ${Math.abs(sync.drift).toFixed(1)}s` : ''}` :
    sync.state === 'catching' ? 'Lining up Prime Video…' :
    sync.state === 'loose' ? 'Prime Video · play/pause linked' :
    sync.state === 'paused' ? 'Prime Video · paused' :
    sync.state === 'waiting' ? 'Waiting for Prime Video' :
    sync.state === 'remote' ? 'Remote for Prime Video jam' :
    sync.state === 'opening' ? 'Opening Prime Video…' :
    sync.state === 'ready' ? 'Waiting to start' : 'Prime Video needs setup';
  const css = sync.state === 'synced' || sync.state === 'paused' || sync.state === 'loose' ? 'synced' : sync.state === 'remote' ? 'paused' : 'syncing';
  return (
    <span className={`sync-pill ${css}`}>
      <i className="dot" /> {label}
    </span>
  );
}

function Reactions() {
  const reactions = useStore((s) => s.reactions);
  const users = useStore((s) => s.world.users);
  return (
    <div className="reactions" aria-hidden>
      {reactions.map((r, i) => {
        const u = users.find((x) => x.id === r.from);
        // Consecutive reactions take different lanes so a burst doesn't stack on one spot.
        const lane = (i % 5) * 3.6;
        return (
          <span key={r.id} className="reaction" style={{ right: `${3 + lane}rem` }}>
            <span className="emoji">{r.emoji}</span>
            {u && <span className="who">{u.name}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ChatFeed({ lifted }: { lifted: boolean }) {
  useTick();
  const chat = useStore((s) => s.chat);
  const users = useStore((s) => s.world.users);
  const now = serverNow();
  const recent = chat.filter((c) => now - c.at < 12_000).slice(-4);
  return (
    <div className={`chat-feed ${lifted ? 'lifted' : ''}`}>
      {recent.map((c) => {
        const u = users.find((x) => x.id === c.from);
        return (
          <div key={c.id} className="chat-msg">
            {u && <Avatar name={u.name} color={u.color} size={2.4} />}
            <span>
              <b>{u?.name ?? 'Someone'}</b> {c.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const PRIVACIES: JamPrivacy[] = ['friends', 'public', 'invite'];

/**
 * Invite people. The QR is a join link anyone can use (/j/<code>); "Pair my phone" swaps it for the
 * host's own phone-remote link, which carries their token and must not be shared. Right after
 * starting a jam (`starting`) this shows first and the jam waits for Start watching.
 */
function InviteSheet({ jam, meId, onClose, starting }: { jam: Jam; meId: string; onClose: () => void; starting?: boolean }) {
  useTick();
  const me = useMe();
  const users = useStore((s) => s.world.users);
  const lanOrigin = useStore((s) => s.lanOrigin);
  const media = mediaById(jam.mediaId)!;
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [qr, setQr] = useState<string>('');
  const [mine, setMine] = useState(false);
  const inviteUrl = `${lanOrigin}/j/${jam.code}`;
  // The phone-remote link carries this profile's token, so the phone that scans it can act as you.
  const remoteUrl = `${lanOrigin}/m?code=${jam.code}&as=${encodeURIComponent(meId)}&t=${encodeURIComponent(me?.token ?? '')}`;
  const url = mine ? remoteUrl : inviteUrl;
  useEffect(() => {
    import('qrcode').then((QRCode) =>
      QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0c0a14', light: '#ffffff' } }).then(setQr),
    );
  }, [url]);
  const friends = useMemo(
    () =>
      users
        .filter((u) => me?.friends.includes(u.id))
        .sort(
          (a, b) =>
            Number(canWatch(b.services, media)) - Number(canWatch(a.services, media)) || Number(b.online) - Number(a.online),
        ),
    [users, me, media],
  );
  const isHost = jam.hostId === meId;
  const here = jam.members.map((id) => users.find((u) => u.id === id)).filter(Boolean) as PublicUser[];
  const episode = media.subtitle && media.subtitle !== 'Film' ? media.subtitle : '';
  const service = media.provider !== 'firejam' ? SERVICE_NAME[media.provider] : null;
  const firstInvitable = friends.find((u) => !jam.members.includes(u.id) && canWatch(u.services, media))?.id;
  return (
    <Modal onClose={onClose} label="Invite" className={`invite-sheet ${service ? 'service' : ''}`}>
      {/* What's on and who's already here, live as people join. */}
      <header className="share-band">
        <Still media={media} className="band-art" />
        <span className="band-shade" />
        <div className="band-text">
          <span className="eyebrow">{starting ? 'Your jam is ready · share it' : 'Bring people in'}</span>
          <h2>
            {media.title} <ServiceBadge media={media} />
          </h2>
          <p className="muted">
            {episode ? `${episode} · ` : ''}
            {jam.name} · {PRIVACY_LABEL[jam.privacy]}
          </p>
        </div>
        <div className="band-here">
          <AvatarStack people={here} size={3.2} max={6} />
          <span>{here.length === 1 ? 'Just you so far' : `${here.length} here, ready to go`}</span>
        </div>
      </header>
      {service && (
        <ol className="service-steps">
          <li>
            <b>1</b>Everyone joins on their own TV with {service}.
          </li>
          <li>
            <b>2</b>
            {starting ? `Press Start: every TV opens ${service}.` : `Every TV in the jam opens ${service}.`}
          </li>
          <li>
            <b>3</b>Play {media.title}
            {episode ? ` ${episode}` : ''}. FireJam lines everyone up.
          </li>
        </ol>
      )}
      <div className="invite-grid">
        <div className="invite-left">
          <div className="qr-box">
            {qr && <img src={qr} alt={mine ? 'QR code for your phone remote' : 'QR code to join this jam'} />}
            {mine ? (
              <span>
                <b>
                  <Icon name="phone" size="1.2em" /> Your phone remote
                </b>
                Just for you: react, chat and play/pause from your phone. Don't share this one.
              </span>
            ) : (
              <span>
                <b>
                  <Icon name="invite" size="1.2em" /> Scan to join
                </b>
                Anyone can scan this with a phone camera, or type the code in FireJam on their TV.
              </span>
            )}
          </div>
          <div className="code-big">
            <span className="muted">Jam code</span>
            <b>{jam.code}</b>
          </div>
          <button className="chip qr-switch" data-focus onClick={() => setMine(!mine)}>
            <Icon name={mine ? 'invite' : 'phone'} size="1.3rem" /> {mine ? 'Show the invite QR' : 'Pair my phone as a remote'}
          </button>
          {isHost && (
            <div className="chips">
              {PRIVACIES.map((p) => (
                <button key={p} className={`chip ${jam.privacy === p ? 'on' : ''}`} data-focus onClick={() => setPrivacy(p)} title={PRIVACY_HINT[p]}>
                  {PRIVACY_LABEL[p]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="invite-right">
          <h3>
            Friends{service && <span>Friends with {service} first</span>}
          </h3>
          <div className="invite-list">
            {friends.map((u) => {
              const inJam = jam.members.includes(u.id);
              const done = sent.has(u.id);
              const can = canWatch(u.services, media);
              return (
                <div key={u.id} className="invite-row">
                  <Avatar name={u.name} color={u.color} size={3.4} ring={u.jamId ? 'live' : u.online ? 'online' : 'offline'} />
                  <span className="person-text">
                    <b>{u.name}</b>
                    <span className="muted">
                      {u.place.city} · {localTime(u.place.tz)} ·{' '}
                      {inJam ? 'here with you' : !u.online ? 'away' : u.jamId ? 'in another jam' : 'online'}
                      {service && (can ? ` · has ${service}` : ` · no ${service}`)}
                    </span>
                  </span>
                  {inJam ? (
                    <span className="tag ok">
                      <Icon name="check" size="1em" /> Watching
                    </span>
                  ) : !can ? (
                    <span className="tag">Needs {service}</span>
                  ) : (
                    <Btn
                      kind={done ? 'quiet' : 'primary'}
                      // The first friend who can still be invited, not row one (who may already be here).
                      autoFocus={!starting && u.id === firstInvitable}
                      disabled={done}
                      onClick={() => {
                        inviteToJam(u.id);
                        setSent(new Set(sent).add(u.id));
                      }}
                    >
                      {done ? 'Invited' : 'Invite'}
                    </Btn>
                  )}
                </div>
              );
            })}
          </div>
          {starting ? (
            <Btn kind="primary" autoFocus icon={<Icon name="play" fill />} onClick={onClose}>
              {service ? `Start in ${service}` : 'Start watching'}
            </Btn>
          ) : (
            <Btn kind="quiet" onClick={onClose}>
              Done
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Who in the room couldn't watch a title (e.g. no Prime Video). Switching to it needs everyone. */
function blockedBy(media: Media, members: PublicUser[]): PublicUser[] {
  return members.filter((u) => !canWatch(u.services, media));
}

function TitleChoice({ media, members, onPick }: { media: Media; members: PublicUser[]; onPick: () => void }) {
  const blocked = blockedBy(media, members);
  return (
    <div className={`title-choice ${blocked.length ? 'blocked' : ''}`}>
      <MediaCard media={media} onSelect={() => !blocked.length && onPick()} />
      {media.provider !== 'firejam' && (
        <span className={`svc-note ${blocked.length ? '' : 'ok'}`}>
          {blocked.length
            ? `${blocked.map((u) => u.name).join(', ')} ${blocked.length > 1 ? "don't" : "doesn't"} have ${SERVICE_NAME[media.provider]}`
            : `Everyone here has ${SERVICE_NAME[media.provider]}`}
        </span>
      )}
    </div>
  );
}

function ChangeSheet({ current, members, onClose }: { current: string; members: PublicUser[]; onClose: () => void }) {
  const catalog = useStore((s) => s.catalog);
  return (
    <Modal onClose={onClose} label="Change film" className="change-sheet">
      <div className="sheet-body">
        <span className="eyebrow">Everyone switches together</span>
        <h2>What's next?</h2>
        <PickForUs
          onChoose={(m) => {
            if (m.id !== current) socket.emit('jam:control', { kind: 'media', mediaId: m.id });
            onClose();
          }}
        />
        <div className="grid media-grid small">
          {catalog.map((m) => (
            <TitleChoice
              key={m.id}
              media={m}
              members={members}
              onPick={() => {
                if (m.id !== current) socket.emit('jam:control', { kind: 'media', mediaId: m.id });
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function EndedSheet({ jam, media, members, onLeave }: { jam: Jam; media: Media; members: PublicUser[]; onLeave: () => void }) {
  const catalog = useStore((s) => s.catalog);
  return (
    <Modal onClose={onLeave} label="That's a wrap" className="change-sheet">
      <div className="sheet-body">
        <span className="eyebrow">That's a wrap</span>
        <h2>Pick the next one together</h2>
        <PickForUs onChoose={(m) => socket.emit('jam:control', { kind: 'media', mediaId: m.id })} />
        <div className="grid media-grid small">
          {catalog
            .filter((m) => m.id !== media.id)
            .map((m) => (
              <TitleChoice
                key={m.id}
                media={m}
                members={members}
                onPick={() => socket.emit('jam:control', { kind: 'media', mediaId: m.id })}
              />
            ))}
        </div>
        <div className="sheet-actions">
          <Btn icon={<Icon name="play" fill />} onClick={() => socket.emit('jam:control', { kind: 'play' })}>
            Watch {media.title} again
          </Btn>
          <Btn kind="quiet" icon={<Icon name="leave" />} onClick={onLeave}>
            Leave {jam.name}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
