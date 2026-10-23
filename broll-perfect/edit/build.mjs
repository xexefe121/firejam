// Builds manifest/edit.json from the voiceover's word timestamps, so every cut lands on the
// narration. Run: node edit/build.mjs   (re-run after the voiceover or captures change)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (file) => JSON.parse(await readFile(path.join(project, file), 'utf8'));

// The voiceover begins this far into the film, over the opening title and the music's intro.
const INTRO = 1.4;
// Pictures change a beat before the word that names them.
const LEAD = 0.25;
const END_CARD = 3.6;

// From edit/voice.py: the cleaned voiceover at its final pace, with words on its clock.
const vo = await read('manifest/vo-final.json');
const words = vo.words;
const voFile = vo.file;
const voDuration = vo.duration;

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9']/g, '');
let cursor = 0;
// Time on the film's timeline of the first word of `phrase`, searching forward from the last match.
function at(phrase) {
  const want = phrase.split(/\s+/).map(norm);
  for (let i = cursor; i < words.length; i++) {
    if (want.every((w, k) => norm(words[i + k]?.text ?? '') === w)) {
      cursor = i + 1;
      return INTRO + words[i].start;
    }
  }
  throw new Error(`Phrase not found in voiceover: "${phrase}"`);
}

const broll = await read('manifest/broll.json');
const event = (id, label) => broll.clips.find((c) => c.id === id)?.events?.find((e) => e.label === label)?.t;

// Anchors, in narration order.
const tSigns = at('It signs');
const tHome = at('Home shows');
const tMap = at('The Jam Map');
const tAdd = at('Add friends');
const tStart = at('Start a jam');
const tWithin = at('within');
const tPause = at('Anyone can pause');
const tPhone = at('Your phone');
const tPrime = at('Prime titles');
const tHow = at('How');
const tKotlin = at('A Kotlin');
const tFollows = at('It follows');
const tNode = at('A Node');
const tBedrock = at('Amazon Bedrock');
const tVoEnd = INTRO + words.at(-1).end;

const segments = [];
let last = 0;
function add(seg, end) {
  const start = segments.length ? last : 0;
  segments.push({ ...seg, start: round(start), dur: round(end - start) });
  last = end;
}
const round = (n) => Math.round(n * 1000) / 1000;

// 1. Brand open while "FireJam is a native Fire TV app" plays.
add({ id: 'open', kind: 'title', logo: true, text: 'FireJam', sub: 'Multiplayer TV for Fire TV', captions: false }, tSigns - LEAD);

// 2. Real device: signs you in from the TV itself.
add({ id: 'device', kind: 'clip', src: 'broll/firetv-home.mp4', in: 0, label: 'Real Fire TV Stick 4K Max',
  camera: [{ at: 0, scale: 1 }, { at: 4, scale: 1.05, x: 0.35, y: 0.3 }] }, tHome - LEAD);

// 3. Home: who's watching, where, what time it is for them.
add({ id: 'home', kind: 'clip', src: 'broll/tv-home-hero.mp4', in: 0, label: 'Home',
  camera: [{ at: 0, scale: 1.0, x: 0.5, y: 0.5 }, { at: 1.6, scale: 1.0 }, { at: 3.6, scale: 1.75, x: 0.2, y: 0.2 }] }, tMap - LEAD);

// 4. Jam Map: everyone you love, lit up.
const mapIn = (event('tv-jam-map', 'open-jam-map') ?? 1.1) + 0.45;
add({ id: 'map', kind: 'clip', src: 'broll/tv-jam-map.mp4', in: mapIn, label: 'Jam Map',
  camera: [{ at: 0, scale: 1.0 }, { at: 5, scale: 1.12, x: 0.55, y: 0.5 }] }, tAdd - LEAD);

// 5. Add friends, see what they watched, pop-ups: the real stick's map and friend cards.
add({ id: 'friends', kind: 'clip', src: 'broll/firetv-map.mp4', in: 1.2, label: 'Real Fire TV',
  camera: [{ at: 0, scale: 1.0, x: 0.5, y: 0.5 }, { at: 4.5, scale: 1.12, x: 0.56, y: 0.5 }] }, tStart - LEAD);

// 6. Start a jam: OK on Ma, Join Ma.
const joinIn = Math.max(0, (event('tv-join-ma', 'ma-pin-ok') ?? 0.7) - 0.45);
const joinDur = Math.min(1.9, (event('tv-join-ma', 'player-started') ?? 1.7) + 0.15 - joinIn);
add({ id: 'join', kind: 'clip', src: 'broll/tv-join-ma.mp4', in: joinIn, label: 'Start a jam' }, tStart - LEAD + joinDur);

// 7. One shared clock: the TV and Ma's laptop side by side; Ma's pause lands on "pause".
const splitStart = last;
const pauseInClip = event('tv-player-sync', 'ma-paused-banner') ?? 4.2;
const syncIn = Math.max(0, pauseInClip - (tPause + 0.45 - splitStart));
const skipInClip = event('tv-player-sync', 'skip-hud') ?? 11.2;
const chipAt = Math.max(0.6, tWithin - splitStart - 0.6);
add({
  id: 'sync', kind: 'split', title: 'Two screens, one playhead',
  left: { src: 'broll/tv-player-sync.mp4', in: syncIn, label: 'Fire TV · Sydney' },
  right: { src: 'broll/laptop-player-sync.mp4', in: syncIn, label: "Ma's laptop · Hyderabad" },
  callouts: [
    { at: 0.6, text: 'Same frame, two countries' },
    { at: tPause - splitStart + 0.4, text: 'Ma pauses. Everyone pauses.', target: 'left' },
    { at: skipInClip - syncIn, text: '+10 s for everyone', target: 'both' },
  ],
  camera: [
    { at: 0, scale: 1 },
    { at: chipAt, scale: 1 },
    { at: chipAt + 0.7, scale: 2.6, on: 'left', x: 0.86, y: 0.07 },
    { at: chipAt + 2.4, scale: 2.6, on: 'left', x: 0.86, y: 0.07 },
    { at: chipAt + 3.1, scale: 1 },
  ],
}, tPhone - LEAD);

// 8. Your phone is the remote for chat and reactions.
add({ id: 'phone', kind: 'phone', tv: { src: 'broll/tv-reactions.mp4', in: 0.6 }, phone: { src: 'broll/web-phone-companion.mp4', in: 0.6 } }, tPrime - LEAD);

// 9. Prime titles play in each TV's own Prime Video: the friends row's Prime card on Home.
add({ id: 'prime', kind: 'clip', src: 'broll/tv-home-hero.mp4', in: 0.5, label: 'Prime Video jams',
  crop: { x: 0.02, y: 0.56, w: 0.5, h: 0.42 },
  camera: [{ at: 0, scale: 1 }, { at: 3, scale: 1.08, x: 0.3, y: 0.45 }] }, tHow - 0.1);

// 10. How it's built.
add({ id: 'how', kind: 'title', text: "How it's built", captions: false }, tKotlin - LEAD);

// 11. A Kotlin Fire TV app hosts a React interface built for the D-pad: the real stick, in a jam.
add({ id: 'native', kind: 'clip', src: 'broll/firetv-player.mp4', in: 1.6, label: 'Kotlin + React, built for the D-pad',
  camera: [{ at: 0, scale: 1.0 }, { at: 4, scale: 1.08, x: 0.5, y: 0.75 }] }, tFollows - LEAD);

// 12. The architecture, step by step with the narration.
const awsStart = last;
add({
  id: 'aws', kind: 'aws', captions: false,
  steps: [
    { at: 0, focus: 'tv', title: 'Native Fire TV app', lines: ["Follows Prime Video through Android's media session", 'Handles Alexa voice commands', 'Kotlin shell, React UI built for the D-pad'] },
    { at: round(tNode - 0.6 - awsStart), focus: 'server', title: 'One shared clock', lines: ['Node + Socket.IO on AWS Graviton (EC2 t4g)', 'Every jam synced, served worldwide via CloudFront'] },
    { at: round(tBedrock - LEAD - awsStart), focus: 'ai', title: "Amazon Bedrock picks what's next", lines: ["Amazon Nova Lite knows everyone's local time", '"It\'s 11:40 pm in Hyderabad, so something short"'] },
  ],
}, tVoEnd + 0.5);

// 13. End card over the music's final chord.
add({ id: 'end', kind: 'end', captions: false }, last + END_CARD);

const total = last;
// Music: full under the open and the end card, ducked under speech.
// bed-b.mp3 was scored to these sections (work/music/gen2.py), so it is never moved, only ducked.
const DUCK = 0.2, OPEN = 0.7;
const music = {
  src: 'music/bed-b.mp3', in: 0, startAt: 0,
  volume: [
    { at: 0, v: 0 }, { at: 0.6, v: OPEN }, { at: INTRO - 0.2, v: OPEN }, { at: INTRO + 0.4, v: DUCK },
    { at: tHow - 0.2, v: DUCK }, { at: tHow + 0.2, v: 0.45 }, { at: tKotlin - 0.1, v: DUCK },
    { at: tVoEnd + 0.1, v: DUCK }, { at: tVoEnd + 0.8, v: OPEN }, { at: total - 1.4, v: OPEN }, { at: total, v: 0 },
  ],
};

const edit = { fps: 30, width: 1920, height: 1080, voiceover: { src: voFile, in: 0, startAt: INTRO, volume: 1 }, music, segments };
await writeFile(path.join(project, 'manifest/edit.json'), JSON.stringify(edit, null, 2) + '\n');
console.log(`edit.json: ${segments.length} segments, ${total.toFixed(2)} s (voiceover ${voDuration.toFixed(2)} s)`);
for (const s of segments) console.log(`  ${s.start.toFixed(2).padStart(6)} +${s.dur.toFixed(2).padStart(5)}  ${s.kind.padEnd(6)} ${s.id}`);
