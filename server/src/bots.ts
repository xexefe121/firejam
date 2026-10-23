import type { HistoryEntry, Jam, JamPrivacy, NowPlaying } from '../../shared/protocol.ts';
import { mediaById } from './catalog.ts';
import { type BotHooks, type Hub, newId, type UserRec, REACTIONS } from './hub.ts';

// A small cast of demo people so a fresh install already feels like a living
// room full of friends: jams running around the world, someone to invite,
// someone who sends you a friend request. Any of them can be "picked up" by a
// real person from the profile screen, at which point the bot goes quiet.

interface BotSpec {
  id: string;
  name: string;
  placeId: string;
  color: string;
  online?: boolean;
  lastSeenAgoMin?: number;
  /** Friends with every new profile, so first launch isn't empty. */
  starterFriend?: boolean;
  /** Has Prime Video. Some don't, so the "everyone needs Prime" rule shows up in the demo. */
  prime?: boolean;
  lines?: string[];
  /** Watching something on their own TV outside FireJam (what a Fire TV would report). */
  nowPlaying?: { app: string; title: string; mediaId: string | null; minutesIn: number };
  /** Things they watched earlier: [title, app, hours ago, minutes watched, watched with]. */
  history?: [string, string, number, number, string[]][];
}

const SPECS: BotSpec[] = [
  { id: 'ammu', prime: true, name: 'Ma', placeId: 'hyderabad', color: '#ff6b9a', starterFriend: true,
    lines: ['Hi kanna ❤️', 'Have you eaten yet?', 'This part! 😂', 'Just like when you were small', 'Call me after, ok?'],
    history: [['Big Buck Bunny', 'FireJam', 26, 10, ['leo']], ['Reacher', 'Prime Video', 50, 48, []]] },
  { id: 'leo', prime: true, name: 'Leo', placeId: 'london', color: '#4cc9f0', starterFriend: true,
    lines: ['yo 👋', 'no way', 'this soundtrack 🔥', 'rewind that bit lol'],
    history: [['The Boys', 'Prime Video', 3, 58, []], ['Big Buck Bunny', 'FireJam', 26, 10, ['ammu']]] },
  { id: 'aiko', prime: true, name: 'Aiko', placeId: 'tokyo', color: '#b388ff', starterFriend: true,
    lines: ['ooh hi!', 'this episode is so good', '😮😮'],
    nowPlaying: { app: 'Prime Video', title: 'Fallout', mediaId: 'prime-fallout', minutesIn: 21 },
    history: [['Tears of Steel', 'FireJam', 20, 12, ['leo']]] },
  { id: 'sam', name: 'Sam', placeId: 'seattle', color: '#f4a261', starterFriend: true, online: false, lastSeenAgoMin: 290,
    history: [['Lo-fi Beats Live', 'YouTube', 5, 40, []], ['Elephants Dream', 'FireJam', 30, 11, ['kwame']]] },
  { id: 'maya', name: 'Maya', placeId: 'toronto', color: '#90be6d', lines: ['hey! saw you on the map 👋'] },
  { id: 'sofia', prime: true, name: 'Sofia', placeId: 'saopaulo', color: '#ffb547', lines: ['bem-vindo! 🐰', 'best part coming up'] },
  { id: 'jonas', prime: true, name: 'Jonas', placeId: 'berlin', color: '#43aa8b' },
  { id: 'priya', prime: true, name: 'Priya', placeId: 'mumbai', color: '#f72585', lines: ['😂😂😂', 'the squirrel!!'] },
  { id: 'diego', name: 'Diego', placeId: 'mexicocity', color: '#ff6b35' },
  { id: 'kwame', name: 'Kwame', placeId: 'accra', color: '#2ec4b6', lines: ['welcome to Dream Club', 'this one gets weird 😮'] },
  { id: 'zara', name: 'Zara', placeId: 'dubai', color: '#f9c74f' },
  { id: 'amara', name: 'Amara', placeId: 'nairobi', color: '#7c5cff' },
  { id: 'nora', prime: true, name: 'Nora', placeId: 'oslo', color: '#e0aaff' },
  { id: 'liam', prime: true, name: 'Liam', placeId: 'auckland', color: '#56cfe1' },
];

const SEED_JAMS: { host: string; name: string; mediaId: string; privacy: JamPrivacy; members: string[] }[] = [
  { host: 'ammu', name: 'Sunday Movie Night', mediaId: 'sintel', privacy: 'friends', members: [] },
  { host: 'leo', name: 'Reacher Night', mediaId: 'prime-reacher', privacy: 'friends', members: [] },
  { host: 'sofia', name: 'Bunny Marathon 🐰', mediaId: 'bbb', privacy: 'public', members: ['jonas', 'priya', 'diego'] },
  { host: 'kwame', name: 'Dream Club', mediaId: 'ed', privacy: 'public', members: ['zara', 'amara'] },
  { host: 'nora', name: 'Nordic Night', mediaId: 'sintel', privacy: 'public', members: [] },
];

const later = (ms: number, fn: () => void) => setTimeout(fn, ms + Math.random() * 1000);

function botNowPlaying(n: NonNullable<BotSpec['nowPlaying']>): NowPlaying {
  const now = Date.now();
  return {
    app: n.app,
    provider: n.app === 'Prime Video' ? 'prime' : null,
    title: n.title,
    mediaId: n.mediaId,
    playing: true,
    position: n.minutesIn * 60,
    updatedAt: now,
    since: now - n.minutesIn * 60_000,
  };
}
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function seedBots(hub: Hub) {
  for (const s of SPECS) {
    hub.users.set(s.id, {
      id: s.id,
      name: s.name,
      color: s.color,
      placeId: s.placeId,
      isBot: true,
      ghost: false,
      friends: new Set(),
      incoming: new Set(),
      outgoing: new Set(),
      lastSeen: Date.now() - (s.lastSeenAgoMin ?? 0) * 60_000,
      createdAt: Date.now(),
      botOnline: s.online !== false,
      pendingJoin: null,
      services: new Set(s.prime ? ['prime'] : []),
      shareActivity: true,
      devices: new Set(),
      tvProfiles: new Set(),
      nativeSeenAt: 0,
      token: newId(12),
      nowPlaying: s.nowPlaying ? botNowPlaying(s.nowPlaying) : null,
      history: (s.history ?? []).map(([title, app, hoursAgo, minutes, withIds]): HistoryEntry => ({
        id: newId(4),
        title,
        mediaId: null,
        app,
        with: withIds,
        at: Date.now() - hoursAgo * 3600_000,
        seconds: minutes * 60,
      })),
    });
  }
  const now = Date.now();
  hub.seeding = true;
  for (const j of SEED_JAMS) {
    const runtime = mediaById(j.mediaId)!.runtime;
    const jam = hub.createJam(j.host, j.mediaId, j.privacy, {
      name: j.name,
      loop: true,
      position: Math.random() * runtime * 0.8,
      updatedAt: now,
    });
    jam.members.push(...j.members);
  }
  hub.seeding = false;
}

export function makeBotHooks(hub: Hub): BotHooks {
  const say = (bot: UserRec, jam: Jam) => {
    const spec = SPECS.find((s) => s.id === bot.id);
    if (spec?.lines?.length && hub.jamOf(bot.id)?.id === jam.id) hub.chat(bot.id, pick(spec.lines));
  };

  // Bots in a jam with a real person chime in now and then so the room feels alive.
  setInterval(() => {
    for (const jam of hub.jams.values()) {
      const humans = jam.members.filter((m) => !hub.botActs(hub.users.get(m)!));
      if (humans.length === 0) continue;
      const bots = jam.members.map((m) => hub.users.get(m)!).filter((u) => hub.botActs(u));
      if (bots.length === 0 || !jam.playing) continue;
      if (Math.random() < 0.35) hub.react(pick(bots).id, pick(REACTIONS.slice(0, 6)));
      if (Math.random() < 0.06) say(pick(bots), jam);
    }
  }, 5000);

  return {
    onFriendRequest(bot, from) {
      later(2500, () => {
        if (hub.botActs(bot)) hub.respondFriend(bot.id, from.id, true);
      });
    },
    onJoinRequest(host, prompt) {
      later(2000, () => {
        if (hub.botActs(host)) hub.answerPrompt(host.id, prompt.id, true);
      });
    },
    onInvite(bot, prompt) {
      later(2500, () => {
        if (!hub.botActs(bot)) return;
        const current = hub.jamOf(bot.id);
        // Says yes when online and either idle or only watching on their own.
        const free = hub.isOnline(bot) && (!current || current.members.length === 1);
        hub.answerPrompt(bot.id, prompt.id, free);
      });
    },
    onJamEntered(jam, who) {
      // A bot arriving says hello; a person arriving gets greeted by a bot already there.
      const greeter = hub.botActs(who)
        ? who
        : jam.members.map((m) => hub.users.get(m)!).find((u) => u.id !== who.id && hub.botActs(u));
      if (greeter) later(1800, () => say(greeter, jam));
    },
    onProfileCreated(user) {
      for (const s of SPECS) if (s.starterFriend) hub.makeFriends(user, hub.users.get(s.id)!);
      // Someone new spots you on the map shortly after you arrive.
      later(9000, () => {
        const maya = hub.users.get('maya')!;
        if (hub.botActs(maya) && !maya.friends.has(user.id)) hub.requestFriend(maya.id, user.id);
      });
    },
  };
}

export const BOT_IDS = new Set(SPECS.map((s) => s.id));
export const FEATURED_BOTS = ['ammu', 'leo', 'maya'];
