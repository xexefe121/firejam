import { useRef, useState } from 'react';
import { PersonCard } from '../components/cards';
import { Icon } from '../components/Icon';
import { JoinCodeSheet, PersonSheet } from '../components/sheets';
import { Avatar, Btn } from '../components/ui';
import { addFriend, answerFriend } from '../lib/actions';
import { localTime } from '../lib/format';
import { useAutoFocus } from '../lib/nav';
import { useMe, useStore, useTick } from '../lib/store';

export function Friends() {
  useTick();
  const me = useMe();
  const users = useStore((s) => s.world.users);
  const [person, setPerson] = useState<string | null>(null);
  const [code, setCode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref);
  if (!me) return null;

  const friendSet = new Set(me.friends);
  const incoming = me.incoming.map((id) => users.find((u) => u.id === id)).filter((u) => !!u);
  const friends = users
    .filter((u) => friendSet.has(u.id))
    .sort((a, b) => Number(!!b.jamId) - Number(!!a.jamId) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const discover = users.filter(
    (u) => u.online && u.id !== me.user.id && !friendSet.has(u.id) && !me.incoming.includes(u.id),
  );
  const watching = friends.filter((f) => f.jamId).length;

  return (
    <div className="screen friends" ref={ref}>
      <header className="screen-head">
        <div>
          <h1>Friends</h1>
          <p className="muted big">
            {friends.length} friends · {watching} watching now · {friends.filter((f) => f.online).length} online
          </p>
        </div>
        <Btn icon={<Icon name="code" />} onClick={() => setCode(true)}>
          Join with code
        </Btn>
      </header>

      {incoming.length > 0 && (
        <section className="block">
          <h3>Friend requests</h3>
          <div className="request-list">
            {incoming.map((u) => (
              <div key={u.id} className="request">
                <Avatar name={u.name} color={u.color} size={4.4} ring={u.online ? 'online' : 'offline'} />
                <span className="person-text">
                  <b>{u.name}</b>
                  <span className="muted">
                    {u.place.city} · {localTime(u.place.tz)}
                  </span>
                </span>
                <Btn kind="primary" autoFocus icon={<Icon name="check" />} onClick={() => answerFriend(u.id, true)}>
                  Accept
                </Btn>
                <Btn onClick={() => answerFriend(u.id, false)}>Decline</Btn>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h3>Your friends</h3>
        {friends.length ? (
          <div className="grid people-grid">
            {friends.map((u) => (
              <PersonCard key={u.id} user={u} onSelect={() => setPerson(u.id)} />
            ))}
          </div>
        ) : (
          <p className="muted big">No friends yet. Find people below or on the Jam Map.</p>
        )}
      </section>

      {discover.length > 0 && (
        <section className="block">
          <h3>
            People on FireJam <span>Online now</span>
          </h3>
          <div className="grid people-grid">
            {discover.map((u) => (
              <div key={u.id} className="discover">
                <PersonCard user={u} onSelect={() => setPerson(u.id)} />
                {!me.outgoing.includes(u.id) && (
                  <button className="mini-add" data-focus onClick={() => addFriend(u.id)} aria-label={`Add ${u.name}`}>
                    <Icon name="plus" size="1.6rem" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {person && <PersonSheet userId={person} onClose={() => setPerson(null)} />}
      {code && <JoinCodeSheet onClose={() => setCode(false)} />}
    </div>
  );
}
