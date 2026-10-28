import type { JamPrivacy, ReportMsg, Service } from '../../../shared/protocol';
import { blockedName, errorText, REPORT_THANKS, rememberBlockedName } from './safety';
import { emitAck, getState, jamById, pushToast, rememberUser, setState, socket, SWITCH_KEY, userById } from './store';

export async function joinJam(jamId: string) {
  try {
    const { status } = await emitAck<{ status: 'joined' | 'requested' }>((ack) => socket.emit('jam:join', jamId, ack));
    if (status === 'requested') {
      const host = userById(jamById(jamId)?.hostId);
      pushToast({ kind: 'info', text: `Asked ${host?.name ?? 'the host'} to let you in…`, userId: host?.id });
    }
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
  }
}

export async function joinByCode(code: string) {
  try {
    const { status, jamId } = await emitAck<{ status: 'joined' | 'requested'; jamId: string }>((ack) =>
      socket.emit('jam:join-code', code, ack),
    );
    if (status === 'requested') {
      const host = userById(jamById(jamId)?.hostId);
      pushToast({ kind: 'info', text: `Asked ${host?.name ?? 'the host'} to let you in…` });
    }
    return true;
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
    return false;
  }
}

export async function startJam(
  mediaId: string,
  privacy: JamPrivacy,
  extra: { startAt?: number; invite?: string; paused?: boolean } = {},
) {
  const { jamId } = await emitAck<{ jamId: string }>((ack) => socket.emit('jam:create', { mediaId, privacy, ...extra }, ack));
  if (extra.paused) setState({ sharing: jamId });
}

/** The host is done sharing the invite: play, and (for Prime titles) open Prime Video. */
export function startSharedJam() {
  setState({ sharing: null });
  socket.emit('jam:control', { kind: 'play' });
}

/** Start a jam on what a friend is watching on their own, at their spot, and invite them in. */
export async function watchTogether(friendId: string, mediaId: string, startAt: number) {
  try {
    await startJam(mediaId, 'friends', { startAt, invite: friendId });
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
  }
}

/** Flag someone (or one of their messages). The server also blocks them for me. */
export async function reportUser(msg: ReportMsg, name: string): Promise<boolean> {
  try {
    await emitAck((ack) => socket.emit('user:report', msg, ack));
    rememberBlockedName(msg.target, name);
    pushToast({ kind: 'info', text: REPORT_THANKS });
    return true;
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
    return false;
  }
}

export async function blockUser(id: string, name: string): Promise<boolean> {
  try {
    await emitAck((ack) => socket.emit('user:block', id, ack));
    rememberBlockedName(id, name);
    pushToast({ kind: 'info', text: `Blocked ${name}. You won't see them any more. Unblock in your profile.` });
    return true;
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
    return false;
  }
}

export async function unblockUser(id: string): Promise<boolean> {
  const name = userById(id)?.name ?? blockedName(id);
  try {
    await emitAck((ack) => socket.emit('user:unblock', id, ack));
    pushToast({ kind: 'info', text: name ? `Unblocked ${name}` : 'Unblocked' });
    return true;
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
    return false;
  }
}

/** Host only: take someone out of my jam. */
export async function removeFromJam(id: string, name: string): Promise<boolean> {
  try {
    await emitAck((ack) => socket.emit('jam:remove', id, ack));
    pushToast({ kind: 'info', text: `Removed ${name} from the jam` });
    return true;
  } catch (e) {
    pushToast({ kind: 'info', text: errorText(e) });
    return false;
  }
}

export const leaveJam = () => socket.emit('jam:leave');
export const addFriend = (id: string) => socket.emit('friend:request', id);
export const answerFriend = (id: string, accept: boolean) => socket.emit('friend:respond', id, accept);
export const inviteToJam = (id: string) => socket.emit('jam:invite', id);
export const setGhost = (on: boolean) => socket.emit('ghost:set', on);
export const setServices = (services: Service[]) => socket.emit('profile:services', services);
export const setShare = (on: boolean) => socket.emit('profile:share', on);
export const setName = (name: string) => emitAck((ack) => socket.emit('profile:name', name, ack));
export const react = (emoji: string) => socket.emit('jam:react', emoji);
export const sendChat = (text: string) => socket.emit('jam:chat', text);
export const setPrivacy = (p: JamPrivacy) => socket.emit('jam:privacy', p);

export function switchProfile() {
  try {
    sessionStorage.setItem(SWITCH_KEY, '1');
  } catch {
    /* without session storage the picker still shows once the profile is forgotten */
  }
  rememberUser(null);
  location.reload();
}

export type Relation = 'me' | 'friend' | 'incoming' | 'outgoing' | 'stranger';
export function relationTo(id: string): Relation {
  const me = getState().me;
  if (!me) return 'stranger';
  if (me.user.id === id) return 'me';
  if (me.friends.includes(id)) return 'friend';
  if (me.incoming.includes(id)) return 'incoming';
  if (me.outgoing.includes(id)) return 'outgoing';
  return 'stranger';
}
