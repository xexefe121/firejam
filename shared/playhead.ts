import type { Jam, Media, Service } from './protocol';

// Rules every screen and the server must agree on, kept in one place.

export const SERVICE_NAME: Record<Service, string> = { prime: 'Prime Video' };

/**
 * Where a jam's playhead is at `now` (server clock, ms).
 * FireJam's own films have exact runtimes, so the playhead stops at the end.
 * Service runtimes are estimates, so the playhead is never clamped there:
 * cutting someone's real episode short would be worse than a progress bar past 100%.
 */
export function positionAt(jam: Jam, media: Pick<Media, 'runtime' | 'provider'>, now: number): number {
  if (!jam.playing) return jam.position;
  const p = jam.position + (now - jam.updatedAt) / 1000;
  if (jam.loop) return p % media.runtime;
  return media.provider === 'firejam' ? Math.min(p, media.runtime) : p;
}

/** A viewer can watch a title if FireJam streams it, or they have the service that does. */
export function canWatch(services: readonly Service[], media: Pick<Media, 'provider'>): boolean {
  return media.provider === 'firejam' || services.includes(media.provider);
}
