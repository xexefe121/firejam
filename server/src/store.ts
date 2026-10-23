import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoryEntry, Service } from '../../shared/protocol.ts';
import { newId } from './hub.ts';
import type { Hub } from './hub.ts';

// Real profiles and their friendships survive restarts in a small JSON file.
// Demo bots and jams are rebuilt from seed on every boot.

const DATA_DIR = process.env.FIREJAM_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface StoredUser {
  id: string;
  name: string;
  color: string;
  placeId: string;
  ghost: boolean;
  friends: string[];
  incoming: string[];
  outgoing: string[];
  services?: string[];
  shareActivity?: boolean;
  token?: string;
  history?: HistoryEntry[];
  devices?: string[];
  tvProfiles?: string[];
  lastSeen: number;
  createdAt: number;
}

export function load(hub: Hub) {
  if (!existsSync(DB_FILE)) return;
  const { users } = JSON.parse(readFileSync(DB_FILE, 'utf8')) as { users: StoredUser[] };
  for (const s of users) {
    hub.users.set(s.id, {
      ...s,
      isBot: false,
      botOnline: false,
      pendingJoin: null,
      friends: new Set(s.friends),
      incoming: new Set(s.incoming),
      outgoing: new Set(s.outgoing),
      services: new Set((s.services ?? []) as Service[]),
      shareActivity: s.shareActivity ?? true,
      token: s.token ?? newId(12),
      nowPlaying: null,
      history: s.history ?? [],
      devices: new Set(s.devices ?? []),
      tvProfiles: new Set(s.tvProfiles ?? []),
      nativeSeenAt: 0,
    });
  }
  // Mirror edges onto the seeded bots so relationships stay symmetric.
  for (const s of users) {
    for (const f of s.friends) hub.users.get(f)?.friends.add(s.id);
    for (const f of s.incoming) hub.users.get(f)?.outgoing.add(s.id);
    for (const f of s.outgoing) hub.users.get(f)?.incoming.add(s.id);
  }
}

let timer: NodeJS.Timeout | null = null;

export function scheduleSave(hub: Hub) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const users: StoredUser[] = [...hub.users.values()]
      .filter((u) => !u.isBot)
      .map((u) => ({
        id: u.id,
        name: u.name,
        color: u.color,
        placeId: u.placeId,
        ghost: u.ghost,
        friends: [...u.friends],
        incoming: [...u.incoming],
        outgoing: [...u.outgoing],
        services: [...u.services],
        shareActivity: u.shareActivity,
        token: u.token,
        history: u.history,
        devices: [...u.devices],
        tvProfiles: [...u.tvProfiles],
        lastSeen: u.lastSeen,
        createdAt: u.createdAt,
      }));
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(DB_FILE, JSON.stringify({ users }, null, 2));
    } catch (e) {
      // Keep serving even if the disk is read-only; profiles live on in memory.
      console.error('could not save profiles:', (e as Error).message);
    }
  }, 500);
}
