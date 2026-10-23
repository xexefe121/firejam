import { useState } from 'react';
import type { Media } from '../../../shared/protocol';
import { emitAck, mediaById, pushToast, socket } from '../lib/store';
import { Still } from './cards';
import { Btn } from './ui';

export interface PickResult {
  media: Media;
  reason: string;
  by: 'bedrock' | 'fallback';
}

/** Ask the server (Amazon Bedrock) what everyone in my jam, or just me, should watch. */
export async function askForPick(): Promise<PickResult | null> {
  try {
    const p = await emitAck<{ mediaId: string; reason: string; by: 'bedrock' | 'fallback' }>((ack) => socket.emit('jam:pick', ack));
    const media = mediaById(p.mediaId);
    return media ? { media, reason: p.reason, by: p.by } : null;
  } catch (e) {
    pushToast({ kind: 'info', text: (e as Error).message });
    return null;
  }
}

export const pickedBy = (by: PickResult['by']) => (by === 'bedrock' ? 'Picked by Amazon Bedrock' : 'Picked for you');

/** "✨ Pick for us" inside a jam: suggest, then switch everyone to it in one press. */
export function PickForUs({ onChoose }: { onChoose: (media: Media) => void }) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<PickResult | null>(null);
  const ask = async () => {
    setBusy(true);
    setPick(await askForPick());
    setBusy(false);
  };
  if (!pick) {
    return (
      <div className="pick">
        <Btn kind="primary" onClick={ask} disabled={busy}>
          {busy ? 'Thinking about everyone…' : '✨ Pick for us'}
        </Btn>
        <span className="muted">Amazon Bedrock looks at what you all watched and what time it is for each of you.</span>
      </div>
    );
  }
  return (
    <div className="pick picked">
      <Still media={pick.media} className="pick-art" />
      <div className="pick-text">
        <span className="eyebrow">✨ {pickedBy(pick.by)}</span>
        <b>{pick.media.title}</b>
        <span>{pick.reason}</span>
      </div>
      <div className="sheet-actions">
        <Btn kind="primary" autoFocus onClick={() => onChoose(pick.media)}>
          Watch it
        </Btn>
        <Btn onClick={ask} disabled={busy}>
          {busy ? 'Thinking…' : 'Another'}
        </Btn>
      </div>
    </div>
  );
}
