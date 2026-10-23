import type { DemoProps, EditManifest, Segment } from './types';

export const toFrames = (seconds: number, fps: number) => Math.round(seconds * fps);

export const totalFrames = (edit: EditManifest): number => {
  if (edit.segments.length === 0) return 1;
  const end = Math.max(...edit.segments.map((s) => s.start + s.dur));
  return Math.max(1, toFrames(end, edit.fps));
};

export type TransitionKind = 'cut' | 'fade' | 'blur';

export type PlacedSegment = {
  seg: Segment;
  from: number; // first frame on the global timeline
  frames: number; // the segment's own length
  transition: { kind: TransitionKind; frames: number };
  overshoot: number; // frames this segment keeps playing under the next segment's transition
  exit: { kind: 'none' | 'blur'; frames: number }; // how it leaves, when the next segment blurs in
};

const FADE_FRAMES = 8;
const LONG_FRAMES = 12;

const FLOATING = new Set<Segment['kind']>(['clip', 'split', 'phone']);

// Boundaries are soft. Between two floating-screen scenes the old screen blurs away and the new one settles in
// (a blur/scale-through, 12 frames): a straight cross-dissolve there would double-expose two similar UIs.
// Everything else is a cross-dissolve (8 frames; 10 out of the hook, 12 into the end card).
// `transitionIn: "fade"` or "blur" forces one, "cut" gives a hard cut, "slide" is treated as "blur".
// A transition never moves a segment: the previous one just keeps playing for `overshoot` frames.

export const placeSegments = (edit: EditManifest): PlacedSegment[] => {
  const placed: PlacedSegment[] = edit.segments.map((seg, i) => {
    const prev = i > 0 ? edit.segments[i - 1] : null;
    let transition: PlacedSegment['transition'] = { kind: 'cut', frames: 0 };
    if (prev) {
      if (seg.transitionIn === 'cut') transition = { kind: 'cut', frames: 0 };
      else if (seg.transitionIn === 'fade') transition = { kind: 'fade', frames: FADE_FRAMES };
      else if (seg.transitionIn === 'blur' || seg.transitionIn === 'slide')
        transition = { kind: 'blur', frames: LONG_FRAMES };
      else if (FLOATING.has(prev.kind) && FLOATING.has(seg.kind)) transition = { kind: 'blur', frames: LONG_FRAMES };
      else if (seg.kind === 'end') transition = { kind: 'fade', frames: LONG_FRAMES };
      else if (prev.kind === 'hook') transition = { kind: 'fade', frames: 10 };
      else transition = { kind: 'fade', frames: FADE_FRAMES };
    }
    return {
      seg,
      from: toFrames(seg.start, edit.fps),
      frames: Math.max(1, toFrames(seg.dur, edit.fps)),
      transition,
      overshoot: 0,
      exit: { kind: 'none', frames: 0 },
    };
  });
  for (let i = 0; i < placed.length - 1; i++) {
    const t = placed[i + 1].transition;
    placed[i].overshoot = t.frames;
    if (t.kind === 'blur') placed[i].exit = { kind: 'blur', frames: t.frames };
  }
  return placed;
};

export const getTimeline = (props: DemoProps) => placeSegments(props.edit);
