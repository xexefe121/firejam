// Shapes of the data files in manifest/. Seconds everywhere unless a name says frames.

export type AudioOpts = { volume?: number };

/**
 * A camera keyframe. `at` is seconds from the start of the segment, `scale` is the zoom (1 = whole
 * capture), `x`/`y` are the focus point as 0-1 coordinates in the source (0.5/0.5 = centre).
 * Anything left out carries over from the previous keyframe. Moves are eased between keyframes.
 */
export type CameraKey = {
  at: number;
  scale?: number;
  x?: number;
  y?: number;
  /**
   * split only, on the segment's own `camera`: aim at a point inside one device's screen instead of the frame.
   * With `on: "left"` (the TV) or `"right"` (the laptop), x/y are 0-1 positions in that capture, so
   * `{ at: 4, scale: 3, on: "left", x: 0.9, y: 0.08 }` zooms in on the TV's top-right chip.
   */
  on?: 'left' | 'right';
};

export type Media = {
  src: string;
  in?: number;
  label?: string;
  audio?: AudioOpts;
  /** Overrides the segment's camera for this one video. */
  camera?: CameraKey[];
};

/**
 * Soft transitions only. `fade` is a cross-dissolve, `blur` is a blur/scale-through, `cut` is a hard cut.
 * `slide` is accepted for old edits and plays as `blur`.
 */
export type Transition = 'fade' | 'blur' | 'slide' | 'cut';

type SegmentBase = {
  id: string;
  start: number;
  dur: number;
  audio?: AudioOpts;
  transitionIn?: Transition;
  /** false hides the voiceover subtitles while this segment is on screen (the scene already shows the words). */
  captions?: boolean;
  /**
   * Zoom/pan keyframes, eased. Default is a gentle push-in.
   * clip: the capture (after `crop`). phone: the TV. split: the whole pair of devices, x/y are 0-1 in the frame
   * (or in one device's capture with `on`). Give `left.camera` / `right.camera` to move inside one screen instead.
   */
  camera?: CameraKey[];
};

export type TimedLine = { at: number; text: string };

export type Callout = TimedLine & {
  /** Which screen it points at. Default 'both'. */
  target?: 'left' | 'right' | 'both';
};

export type HookSegment = SegmentBase & {
  kind: 'hook';
  bg: Media;
  lines: TimedLine[];
};

export type Crop = { x: number; y: number; w: number; h: number };

export type ClipSegment = SegmentBase & {
  kind: 'clip';
  src: string;
  in?: number;
  /** Small caps line above the headline. */
  label?: string;
  caption?: string;
  /** Show only this part of the capture (0-1 of the source); the floating screen takes the crop's shape. */
  crop?: Crop;
};

export type SplitSegment = SegmentBase & {
  kind: 'split';
  title?: string;
  left: Media;
  right: Media;
  callouts: Callout[];
};

export type PhoneSegment = SegmentBase & {
  kind: 'phone';
  tv: Media;
  phone: Media;
  caption?: string;
};

export type AwsFocus = 'tv' | 'edge' | 'server' | 'ai';

/** One beat of the architecture sequence. `at` is seconds from the start of the segment. */
export type AwsStep = {
  at: number;
  /** Which node lights up. `server` lights CloudFront and EC2 together. */
  focus: AwsFocus;
  title?: string;
  /** Up to three short lines under the title. */
  lines?: string[];
};

export type AwsNodeKey = 'tv' | 'web' | 'edge' | 'server' | 'ai';

export type AwsSegment = SegmentBase & {
  kind: 'aws';
  /** Defaults to the three-step walkthrough (Fire TV app, one shared clock, Bedrock). */
  steps?: AwsStep[];
  /** Optional node name / sub line overrides. */
  nodes?: Partial<Record<AwsNodeKey, { name?: string; sub?: string }>>;
};

export type TitleSegment = SegmentBase & {
  kind: 'title';
  /** One big centred statement, e.g. "How it's built". */
  text: string;
  sub?: string;
  /** Show the app icon above the text and set the text as the wordmark ("Jam" in the brand gradient). */
  logo?: boolean;
};
export type EndSegment = SegmentBase & { kind: 'end' };

export type Segment =
  | HookSegment
  | TitleSegment
  | ClipSegment
  | SplitSegment
  | PhoneSegment
  | AwsSegment
  | EndSegment;

/** `startAt` is where the voiceover begins on the timeline, `in` is how far into the file it starts. */
export type Voiceover = { src: string; in?: number; startAt?: number; volume?: number };

/** A volume level at a time on the timeline (seconds); levels are eased linearly between keys. */
export type VolumeKey = { at: number; v: number };

/** Music bed under the whole film. `volume` keys duck it under the voiceover. */
export type Music = { src: string; in?: number; startAt?: number; volume: VolumeKey[] };

export type EditManifest = {
  fps: number;
  width: number;
  height: number;
  voiceover: Voiceover | null;
  music?: Music | null;
  segments: Segment[];
};

export type BrollClip = {
  id: string;
  file: string;
  duration?: number;
  [key: string]: unknown;
};

export type BrollManifest = { clips: BrollClip[] };

// Structurally the same as @remotion/captions' Caption.
export type CaptionItem = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};

export type DemoProps = {
  edit: EditManifest;
  broll: BrollManifest;
  captions: CaptionItem[];
};
