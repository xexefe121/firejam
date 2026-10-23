import type { Prompt, Toast } from '../../../shared/protocol';
import { localTime } from '../lib/format';
import { getState, jamById, mediaById, setState, socket, useStore, userById } from '../lib/store';
import { Icon } from './Icon';
import { Avatar, Btn, Modal } from './ui';

function toastText(t: Toast): { userId?: string; text: string } | null {
  const me = getState().me?.user.id;
  switch (t.kind) {
    case 'info':
      return { userId: t.userId, text: t.text };
    case 'friend-request':
      return { userId: t.from, text: `${userById(t.from)?.name ?? 'Someone'} wants to be friends · see Friends` };
    case 'friend-accepted':
      return { userId: t.by, text: `${userById(t.by)?.name ?? 'Someone'} accepted your friend request 🎉` };
    case 'jam-member': {
      if (t.userId === me) return null;
      const u = userById(t.userId);
      const where = u ? ` from ${u.place.city}` : '';
      return { userId: t.userId, text: t.joined ? `${u?.name ?? 'Someone'} joined${where}` : `${u?.name ?? 'Someone'} left the jam` };
    }
    case 'friend-watching': {
      const name = userById(t.from)?.name ?? 'A friend';
      return { userId: t.from, text: t.jamId ? `🔥 ${name} is watching ${t.title}. Join from Home` : `${name} is watching ${t.title} on ${t.app}` };
    }
    default:
      return null; // playback changes are shown inside the player
  }
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const view = toastText(t);
        if (!view) return null;
        const u = userById(view.userId);
        return (
          <div key={t.id} className="toast">
            {u ? <Avatar name={u.name} color={u.color} size={2.6} /> : <Icon name="friends" />}
            <span>{view.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Time-sensitive questions (someone knocking on your jam, an invite) take over focus until answered. */
export function Prompts() {
  const prompts = useStore((s) => s.prompts);
  const p = prompts[0];
  if (!p) return null;
  return <PromptDialog key={p.id} prompt={p} />;
}

function PromptDialog({ prompt }: { prompt: Prompt }) {
  useStore((s) => s.world);
  const from = userById(prompt.from);
  const jam = jamById(prompt.jamId);
  const media = mediaById(jam?.mediaId);
  const answer = (accept: boolean) => {
    socket.emit('prompt:answer', prompt.id, accept);
    setState((s) => ({ prompts: s.prompts.filter((x) => x.id !== prompt.id) }));
  };
  const name = from?.name ?? 'Someone';
  return (
    <Modal onClose={() => answer(false)} label="Request" className="prompt-sheet">
      <div className="sheet-body center">
        {from && <Avatar name={from.name} color={from.color} size={7} ring="live" />}
        {prompt.kind === 'join-request' ? (
          <>
            <h2>{name} wants to join your jam</h2>
            <p className="muted big">
              {from ? `${from.place.city} · ${localTime(from.place.tz)} there` : ''}
            </p>
          </>
        ) : (
          <>
            <h2>
              {name} invited you to watch {media?.title ?? 'together'}
            </h2>
            <p className="muted big">
              {jam?.name} · {jam?.members.length ?? 1} watching
              {from ? ` · ${localTime(from.place.tz)} in ${from.place.city}` : ''}
            </p>
          </>
        )}
        <div className="sheet-actions">
          <Btn kind="primary" autoFocus icon={<Icon name="check" />} onClick={() => answer(true)}>
            {prompt.kind === 'join-request' ? 'Let them in' : 'Join now'}
          </Btn>
          <Btn onClick={() => answer(false)}>Not now</Btn>
        </div>
      </div>
    </Modal>
  );
}
