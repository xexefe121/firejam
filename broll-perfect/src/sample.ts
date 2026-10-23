import type {
  AwsSegment,
  TitleSegment,
  ClipSegment,
  EndSegment,
  HookSegment,
  PhoneSegment,
  SplitSegment,
} from './types';

// Sample props for the preview compositions. They use the same file names as manifest/edit.json, so
// they pick up real captures as soon as the capture script has listed them in broll.json.

export const sampleHook: HookSegment = {
  id: 'hook',
  kind: 'hook',
  start: 0,
  dur: 8,
  bg: { src: 'broll/firetv-home.mp4', in: 0 },
  lines: [
    { at: 0.2, text: 'TV used to be something families did together.' },
    { at: 3.0, text: "Now Mum's in Hyderabad. I'm in Sydney." },
    { at: 5.6, text: 'FireJam makes TV multiplayer again.' },
  ],
};

export const sampleClip: ClipSegment = {
  id: 'home',
  kind: 'clip',
  start: 0,
  dur: 4,
  src: 'broll/firetv-home.mp4',
  in: 0,
  label: 'Real Fire TV Stick 4K Max',
  caption: 'See what your friends are watching',
};

export const sampleSplit: SplitSegment = {
  id: 'sync',
  kind: 'split',
  start: 0,
  dur: 14,
  left: { src: 'broll/tv-player-sync.mp4', in: 0, label: 'Fire TV · Sydney' },
  right: { src: 'broll/laptop-player-sync.mp4', in: 0, label: "Ma's laptop · Hyderabad" },
  callouts: [
    { at: 0.5, text: 'Same frame, two countries' },
    { at: 4.0, text: 'Ma pauses. Everyone pauses.', target: 'right' },
    { at: 8.0, text: 'Anyone can drive, like Spotify Jam' },
  ],
};

export const samplePhone: PhoneSegment = {
  id: 'phone',
  kind: 'phone',
  start: 0,
  dur: 9,
  phone: { src: 'broll/web-phone-companion.mp4', in: 0 },
  tv: { src: 'broll/tv-reactions.mp4', in: 0 },
  caption: 'Your phone is the keyboard. No app to install.',
};

export const sampleTitle: TitleSegment = {
  id: 'title',
  kind: 'title',
  start: 0,
  dur: 2,
  text: "How it's built",
  sub: 'Running on AWS in Sydney',
};

// Steps are left out, so the default three-step walkthrough plays.
export const sampleAws: AwsSegment = { id: 'aws', kind: 'aws', start: 0, dur: 24 };
export const sampleEnd: EndSegment = { id: 'end', kind: 'end', start: 0, dur: 5 };
