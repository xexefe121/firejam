import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Media } from '../../shared/protocol.ts';

// Open movies from the Blender Foundation (CC-BY). They stand in for the
// viewer's own streaming apps, which the jam protocol would drive the same way.
// Files dropped into server/media/<id>.mp4 (see `npm run media:fetch`) are served
// locally instead, which keeps LAN demos smooth.
export const MEDIA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../media');

/**
 * Prime Video app links (`https://app.primevideo.com/detail?gti=…`) by title. A title
 * without one opens the Prime Video app and asks the viewer to pick it there; the
 * jam syncs whatever Prime Video plays either way.
 */
const PRIME_LINKS: Record<string, string | undefined> = {};

/** FireJam's own films carry an MP4 that `npm run media:fetch` can mirror locally (runtimes differ slightly per cut). */
type Entry = Media & { mirror?: { url: string; runtime: number } };

export const ENTRIES: Entry[] = [
  {
    id: 'sintel',
    title: 'Sintel',
    year: 2010,
    runtime: 888.06,
    src: 'https://archive.org/download/Sintel/sintel-2048-stereo.mp4',
    kind: 'mp4',
    provider: 'firejam',
    genre: 'Fantasy · Adventure',
    logline: 'A lone girl crosses a frozen world to find the baby dragon she raised.',
    still: '/stills/sintel.jpg',
    credit: '© copyright Blender Foundation | durian.blender.org (CC-BY 3.0)',
    mirror: { url: 'https://archive.org/download/Sintel/sintel-2048-stereo.mp4', runtime: 888.06 },
  },
  {
    id: 'bbb',
    title: 'Big Buck Bunny',
    year: 2008,
    runtime: 634.57,
    src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    kind: 'hls',
    provider: 'firejam',
    genre: 'Comedy · Family',
    logline: 'A gentle giant rabbit finally has enough of three forest bullies.',
    still: '/stills/bbb.jpg',
    credit: '© copyright Blender Foundation | www.bigbuckbunny.org (CC-BY 3.0)',
    mirror: { url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4', runtime: 596.48 },
  },
  {
    id: 'tos',
    title: 'Tears of Steel',
    year: 2012,
    runtime: 734.22,
    src: 'https://archive.org/download/tears-of-steel_202604/Tears%20of%20Steel.mp4',
    kind: 'mp4',
    provider: 'firejam',
    genre: 'Sci-Fi · Action',
    logline: 'Scientists in a future Amsterdam relive one breakup to save the world.',
    still: '/stills/tos.jpg',
    credit: '© copyright Blender Foundation | mango.blender.org (CC-BY 3.0)',
    mirror: { url: 'https://archive.org/download/tears-of-steel_202604/Tears%20of%20Steel.mp4', runtime: 734.22 },
  },
  {
    id: 'ed',
    title: 'Elephants Dream',
    year: 2006,
    runtime: 653.82,
    src: 'https://archive.org/download/ElephantsDream/ed_hd.mp4',
    kind: 'mp4',
    provider: 'firejam',
    genre: 'Surreal · Sci-Fi',
    logline: 'Two strangers wander an endless machine that only one of them believes in.',
    still: '/stills/ed.jpg',
    credit: '© copyright Blender Foundation | orange.blender.org (CC-BY 2.5)',
    mirror: { url: 'https://archive.org/download/ElephantsDream/ed_hd.mp4', runtime: 653.82 },
  },
  // Prime Video titles never stream through FireJam. Each TV opens them in its own
  // Prime Video app, on its own account, and FireJam keeps those players in step.
  // So a Prime title is only open to jams where every member has Prime Video.
  // Runtimes are estimates; the playhead isn't clamped for service titles.
  prime('prime-fallout', 'Fallout', 'S1 · E1 · The End', 2024, 74, 'Drama · Sci-Fi',
    'Two hundred years after the bombs, a vault dweller climbs out into what is left of Los Angeles.', ['#2f4a1c', '#c9a13b']),
  prime('prime-reacher', 'Reacher', 'S1 · E1 · Welcome to Margrave', 2022, 51, 'Crime · Action',
    'A former military cop walks into a small Georgia town and straight into a murder charge.', ['#17283a', '#7f97b0']),
  prime('prime-theboys', 'The Boys', 'S1 · E1 · The Name of the Game', 2019, 61, 'Superhero · Satire',
    'When superheroes abuse their power, a handful of nobodies decides to fight back.', ['#4d0c10', '#e0b84a']),
  prime('prime-roadhouse', 'Road House', 'Film', 2024, 121, 'Action',
    'A former UFC fighter takes a job as a bouncer at a roadhouse in the Florida Keys.', ['#0e3a49', '#e2793a']),
  prime('prime-ringsofpower', 'The Rings of Power', 'S1 · E1', 2022, 66, 'Fantasy · Adventure',
    'Thousands of years before the Fellowship, an elf commander hunts a darkness everyone else thinks is gone.', ['#1d2a3f', '#d9b25f']),
  prime('prime-jackryan', 'Jack Ryan', 'S1 · E1', 2018, 63, 'Thriller · Action',
    'A CIA analyst spots a pattern in bank transfers and gets pulled out from behind his desk.', ['#0f2333', '#8fb3c9']),
  prime('prime-invincible', 'Invincible', 'S1 · E1', 2021, 47, 'Animation · Superhero',
    "A teenager finally gets his powers, and learns what his superhero dad really stands for.", ['#123a6b', '#f2c230']),
  prime('prime-familyman', 'The Family Man', 'S1 · E1', 2019, 45, 'Thriller · Hindi',
    'A middle-class dad juggles a home that thinks he has a desk job with a secret life stopping attacks.', ['#3b2412', '#e0a35a']),
  prime('prime-mirzapur', 'Mirzapur', 'S1 · E1', 2018, 54, 'Crime · Hindi',
    "Two brothers get drawn into the business of the town's most feared family.", ['#3a0d0d', '#c9893a']),
  prime('prime-panchayat', 'Panchayat', 'S1 · E1', 2020, 33, 'Comedy · Hindi',
    'An engineering graduate takes the only job he can get: secretary of a village office far from the city.', ['#2c4220', '#e8d27a']),
  prime('prime-farzi', 'Farzi', 'S1 · E1', 2023, 55, 'Crime · Hindi',
    'A struggling artist discovers he can paint money, and a task force notices.', ['#1b2a24', '#9fd18b']),
  prime('prime-madeinheaven', 'Made in Heaven', 'S1 · E1', 2019, 55, 'Drama · Hindi',
    "Two Delhi wedding planners see what's behind the perfect weddings they put on.", ['#3d1230', '#f0a6c8']),
  prime('prime-maisel', 'The Marvelous Mrs. Maisel', 'S1 · E1', 2017, 56, 'Comedy',
    'A 1950s New York housewife finds out she is very, very good at stand-up.', ['#33123b', '#f3b6c4']),
  prime('prime-clarksonsfarm', "Clarkson's Farm", 'S1 · E1', 2021, 50, 'Reality · Comedy',
    'A famous car presenter buys a farm in the Cotswolds and learns how hard farming is.', ['#2d3a14', '#d7c46a']),
  prime('prime-citadel', 'Citadel', 'S1 · E1', 2023, 50, 'Spy · Action',
    'Two agents of a fallen spy agency get their memories back, along with their enemies.', ['#141b2e', '#c4cbe0']),
  prime('prime-mrmrssmith', 'Mr. & Mrs. Smith', 'S1 · E1', 2024, 60, 'Comedy · Thriller',
    'Two strangers are hired as a married couple of spies and have to make it work.', ['#2a1420', '#e88a7a']),
  prime('prime-genv', 'Gen V', 'S1 · E1', 2023, 60, 'Superhero · Satire',
    "At a college for young superheroes, a first-year finds out what the school is hiding.", ['#3a0a24', '#f05a8a']),
  prime('prime-tomorrowwar', 'The Tomorrow War', 'Film', 2021, 138, 'Sci-Fi · Action',
    'Soldiers from the future recruit people from today to fight a war thirty years ahead.', ['#1a2c33', '#7fd0e0']),
  prime('prime-redone', 'Red One', 'Film', 2024, 123, 'Comedy · Action',
    "When Santa is kidnapped, the head of North Pole security teams up with a bounty hunter.", ['#4a0e14', '#f2d07a']),
];

function prime(
  id: string,
  title: string,
  subtitle: string,
  year: number,
  minutes: number,
  genre: string,
  logline: string,
  tint: [string, string],
): Entry {
  return {
    id,
    title,
    subtitle,
    year,
    genre,
    logline,
    tint,
    runtime: minutes * 60,
    provider: 'prime',
    src: '',
    kind: 'external',
    link: PRIME_LINKS[id],
    still: '',
    credit: 'Plays in Prime Video on each viewer’s own account. Runtime approximate.',
  };
}

export const CATALOG: Media[] = ENTRIES.map(({ mirror, ...m }) =>
  mirror && existsSync(path.join(MEDIA_DIR, `${m.id}.mp4`))
    ? { ...m, src: `/media/${m.id}.mp4`, kind: 'mp4', runtime: mirror.runtime }
    : m,
);

export const mediaById = (id: string): Media | undefined => CATALOG.find((m) => m.id === id);

/**
 * The catalogue title for something a TV reported playing on a service, adding it
 * when it isn't listed yet, so friends can start a jam on it. Returns whether it was new.
 */
export function serviceTitle(provider: Media['provider'], title: string): { media: Media; added: boolean } {
  const key = title.trim().toLowerCase();
  const found = CATALOG.find((m) => m.provider === provider && m.title.toLowerCase() === key);
  if (found) return { media: found, added: false };
  const media: Media = {
    id: `${provider}-${key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'title'}`,
    title: title.trim().slice(0, 80),
    year: new Date().getFullYear(),
    runtime: 2 * 3600,
    provider,
    src: '',
    kind: 'external',
    genre: 'Seen on a friend’s TV',
    logline: 'A friend is watching this right now.',
    still: '',
    credit: 'Plays in Prime Video on each viewer’s own account. Runtime unknown.',
  };
  CATALOG.push(media);
  return { media, added: true };
}
