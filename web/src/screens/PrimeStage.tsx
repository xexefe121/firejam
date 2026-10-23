import { useEffect, useState } from 'react';
import { SERVICE_NAME } from '../../../shared/playhead';
import type { Jam, Media, PublicUser } from '../../../shared/protocol';
import { ServiceBadge, Still } from '../components/cards';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { native, nativeInfo, onPrime, type PrimeState } from '../lib/native';
import { clock } from '../lib/format';
import { jamPosition, serverNow, useTick } from '../lib/store';

// Prime Video titles never stream through FireJam. On a Fire TV, FireJam opens
// the title in that TV's own Prime Video app (the viewer's own account) and the
// native shell keeps Prime Video on the jam's playhead through Android's media
// session controls. Pausing Prime Video with the remote pauses the whole jam.
// In a browser there's no Prime Video to drive, so the page becomes the jam's
// remote: timeline, controls, reactions and chat.

export interface PrimeSync {
  /** 'ready': the jam hasn't started yet; Prime Video opens on every TV when the host presses Start. */
  state: PrimeState | 'remote' | 'ready';
  drift?: number;
  title?: string;
}

export function usePrimeSync(active: boolean, jam: Jam, media: Media): PrimeSync {
  const [status, setStatus] = useState<PrimeSync>({ state: native ? 'opening' : 'remote' });

  // Open the title in Prime Video once per title; stop driving it when we leave.
  useEffect(() => {
    if (!active || !native) return;
    native.openPrime(media.link ?? '', media.title);
    return () => native!.stopSync();
  }, [active, media.id, media.link, media.title]);

  // Every jam change goes to the native sync loop, with our offset to the server clock.
  useEffect(() => {
    if (!active || !native) return;
    native.syncJam(
      JSON.stringify({
        playing: jam.playing,
        position: jam.position,
        updatedAt: jam.updatedAt,
        loop: jam.loop,
        runtime: media.runtime,
        offset: serverNow() - Date.now(),
        title: media.title,
      }),
    );
  }, [active, jam.playing, jam.position, jam.updatedAt, jam.loop, media.runtime, media.title]);

  // Native tells us what Prime Video is doing. Remote presses on Prime Video are
  // sent to the server by the shell itself (this page's timers are frozen then).
  useEffect(() => {
    if (!active) return;
    return onPrime((e) => {
      if (e.type === 'status') setStatus({ state: e.state, drift: e.drift, title: e.title });
    });
  }, [active]);

  // Bubbles over Prime Video (reactions, chat, "Ma paused · jam at 12:34") come from
  // the shell's own server link in PrimeSync.kt, which keeps working while this page is frozen.

  return active || !native ? status : { state: 'ready' };
}

const STATE_TEXT: Record<PrimeSync['state'], string> = {
  ready: 'Waiting for the host to press Start. Then every TV opens Prime Video together.',
  opening: 'Opening Prime Video on this TV…',
  waiting: 'Press play in Prime Video. FireJam will line you up with everyone.',
  synced: 'Playing in Prime Video, in step with everyone',
  catching: 'Lining Prime Video up with the jam…',
  loose: 'Play and pause are linked with the jam. Prime Video doesn’t share its position yet (ads), so skip to the jam clock once if you need to.',
  left: 'You left this jam on another screen.',
  paused: 'Paused in Prime Video',
  'no-access': 'FireJam needs permission to follow Prime Video (one-time setup below)',
  'no-app': 'Prime Video isn’t installed on this TV',
  remote: 'Remote mode',
};

export const openInPrime = (media: Media) => native?.openPrime(media.link ?? '', media.title);

export function PrimeStage({ jam, media, sync, members }: { jam: Jam; media: Media; sync: PrimeSync; members: PublicUser[] }) {
  useTick();
  const service = SERVICE_NAME[media.provider as keyof typeof SERVICE_NAME];
  const info = nativeInfo();
  return (
    <div className="prime-stage">
      <Still media={media} className="prime-art" />
      <span className="prime-shade" />
      <div className="prime-card">
        <ServiceBadge media={media} className="big" />
        <h1>{media.title}</h1>
        {media.subtitle && <p className="muted big">{media.subtitle}</p>}
        <p className={`prime-state ${sync.state}`}>
          <i className="dot" /> {STATE_TEXT[sync.state]}
          {sync.title && sync.state !== 'remote' ? ` · Prime Video shows “${sync.title}”` : ''}
        </p>
        {(sync.state === 'loose' || sync.state === 'waiting' || sync.state === 'remote') && (
          <p className="jam-clock">
            Jam clock <b>{clock(jamPosition(jam, media))}</b>
          </p>
        )}
        {sync.state === 'remote' && (
          <p className="lede">
            Everyone in this jam watches in their own {service} app on their TV, and FireJam keeps them in step. In a browser
            this page is the jam's remote: play, pause, skip, react and chat for the whole room.
          </p>
        )}
        {sync.state === 'no-access' && info?.settingsAvailable && (
          <p className="lede">Go back to FireJam Home and press <b>Open Settings</b> to let FireJam follow Prime Video.</p>
        )}
        {sync.state === 'no-access' && info && !info.settingsAvailable && (
          <div className="setup">
            <b>One-time setup, from a computer on the same Wi-Fi:</b>
            <code>adb shell cmd notification allow_listener {info.listener}</code>
            <code>adb shell appops set app.firejam.tv SYSTEM_ALERT_WINDOW allow</code>
          </div>
        )}
        <div className="prime-people">
          {members.map((u) => (
            <span key={u.id} className="prime-person">
              <Avatar name={u.name} color={u.color} size={2.4} />
              {u.name}
              <Icon name="check" size="1em" />
            </span>
          ))}
          <span className="muted">Everyone here has {service}</span>
        </div>
        <p className="credit">
          {jam.name} · {media.credit}
        </p>
      </div>
    </div>
  );
}

