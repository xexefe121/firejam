import { useEffect, useRef, useState } from 'react';
import { Flame, Icon } from '../components/Icon';
import { Avatar, Progress } from '../components/ui';
import { react, sendChat } from '../lib/actions';
import { clock, localTime } from '../lib/format';
import { jamPosition, mediaById, socket, useStore, useTick } from '../lib/store';

// Phone companion, opened from the QR code on the TV. It acts as the TV's
// viewer: reactions and chat show up on every screen in the jam, and the
// play/pause button drives the shared playhead. No video plays here.

const REACTIONS = ['😂', '❤️', '😮', '👏', '🔥', '😢', '🍿', '👋'];

export function Companion() {
  useTick();
  const status = useStore((s) => s.status);
  const me = useStore((s) => s.me);
  const jam = useStore((s) => s.world.jams.find((j) => j.members.includes(s.me?.user.id ?? '')));
  const users = useStore((s) => s.world.users);
  const chat = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  if (status !== 'ready' || !me) {
    return (
      <div className="companion center">
        <Flame size="4rem" />
        <p>{status === 'onboarding' ? 'Scan the QR code from FireJam on your TV to pair this phone.' : 'Connecting…'}</p>
      </div>
    );
  }
  const media = mediaById(jam?.mediaId);
  if (!jam || !media) {
    return (
      <div className="companion center">
        <Flame size="4rem" />
        <p>
          Paired as <b>{me.user.name}</b>. Start or join a jam on your TV and it'll show up here.
        </p>
      </div>
    );
  }
  const pos = jamPosition(jam, media);
  const members = jam.members.map((m) => users.find((u) => u.id === m)).filter((u) => !!u);
  const send = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText('');
  };

  return (
    <div className="companion">
      <header>
        <div className="c-art" style={{ backgroundImage: `url(${media.still})` }} />
        <div className="c-head">
          <span className="eyebrow">
            <i className="dot" /> {jam.name}
          </span>
          <h1>{media.title}</h1>
          <Progress value={pos / media.runtime} />
          <span className="muted">
            {clock(pos)} / {clock(media.runtime)}
          </span>
        </div>
        <button
          className="c-play"
          onClick={() => socket.emit('jam:control', { kind: jam.playing ? 'pause' : 'play' })}
          aria-label={jam.playing ? 'Pause for everyone' : 'Play for everyone'}
        >
          <Icon name={jam.playing ? 'pause' : 'play'} fill size="2rem" />
        </button>
      </header>

      <div className="c-members">
        {members.map((u) => (
          <span key={u.id} className="c-member">
            <Avatar name={u.name} color={u.color} size={2.2} />
            {u.id === me.user.id ? 'You' : u.name}
            <i>{localTime(u.place.tz)}</i>
          </span>
        ))}
      </div>

      <div className="c-reactions">
        {REACTIONS.map((e) => (
          <button key={e} onClick={() => react(e)}>
            {e}
          </button>
        ))}
      </div>

      <div className="c-feed" ref={feed}>
        {chat.length === 0 && <p className="muted">Say hi. Messages pop up on everyone's TV.</p>}
        {chat.map((c) => {
          const u = users.find((x) => x.id === c.from);
          return (
            <div key={c.id} className={`c-msg ${c.from === me.user.id ? 'mine' : ''}`}>
              {u && <Avatar name={u.name} color={u.color} size={1.8} />}
              <span>
                <b>{u?.name}</b>
                {c.text}
              </span>
            </div>
          );
        })}
      </div>

      <form
        className="c-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={text} maxLength={160} placeholder="Message the jam…" onChange={(e) => setText(e.target.value)} />
        <button type="submit" aria-label="Send">
          Send
        </button>
      </form>
    </div>
  );
}
