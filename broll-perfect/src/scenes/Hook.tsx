import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { HookSegment } from '../types';
import { MediaClip, resolveVolume } from '../media';
import { C, FONT_DISPLAY } from '../theme';
import { WordReveal, clamp, easeInOut } from '../ui';

const HookLine: React.FC<{
  text: string;
  startFrame: number;
  /** Frame the next line takes over, or null for the last line (it stays until the cut). */
  nextFrame: number | null;
  last: boolean;
}> = ({ text, startFrame, nextFrame, last }) => {
  const frame = useCurrentFrame();
  if (frame < startFrame || (nextFrame !== null && frame > nextFrame)) return null;
  // The old line is gone just before the next one starts.
  const out = nextFrame === null ? 1 : interpolate(frame, [nextFrame - 14, nextFrame - 3], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 190px' }}>
      <WordReveal
        text={text}
        delay={startFrame}
        stagger={3}
        out={out}
        gradient={last}
        style={{
          maxWidth: 1380,
          textAlign: 'center',
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: last ? 112 : 88,
          lineHeight: 1.06,
          letterSpacing: last ? '-0.045em' : '-0.04em',
          color: C.text,
          filter: 'drop-shadow(0 6px 40px rgba(0,0,0,0.55))',
        }}
      />
    </AbsoluteFill>
  );
};

export const HookScene: React.FC<{ segment: HookSegment }> = ({ segment }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const volume = resolveVolume(segment.bg.src, segment.bg.audio?.volume, segment.audio?.volume);
  const lines = segment.lines;
  // the picture behind the words pushes in very slowly
  const push = 1.05 + 0.06 * interpolate(frame, [0, durationInFrames], [0, 1], { ...clamp, easing: easeInOut });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* The footage sits behind, dark and soft, so the words carry the scene. */}
      <div
        style={{
          position: 'absolute',
          inset: -60,
          transform: `scale(${push})`,
          filter: 'brightness(0.4) saturate(1.05) blur(18px)',
        }}
      >
        <MediaClip src={segment.bg.src} from={segment.bg.in} volume={volume} variant="ambient" />
      </div>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 80% 75% at 50% 50%, rgba(7,6,11,0.1) 0%, rgba(7,6,11,0.8) 100%)',
        }}
      />
      {lines.map((line, i) => (
        <HookLine
          key={i}
          text={line.text}
          startFrame={Math.round(line.at * fps)}
          nextFrame={i + 1 < lines.length ? Math.round(lines[i + 1].at * fps) : null}
          last={i === lines.length - 1}
        />
      ))}
    </AbsoluteFill>
  );
};
