import React from 'react';
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import type { CalculateMetadataFunction } from 'remotion';
import type { DemoProps, Segment } from './types';
import { BrollContext } from './media';
import { Captions } from './Captions';
import { C } from './theme';
import { TimeOffsetContext, clamp, easeOut } from './ui';
import { placeSegments, totalFrames } from './timeline';
import type { TransitionKind } from './timeline';
import { HookScene } from './scenes/Hook';
import { ClipScene } from './scenes/Clip';
import { SplitScene } from './scenes/Split';
import { PhoneScene } from './scenes/Phone';
import { AwsScene } from './scenes/Aws';
import { TitleScene } from './scenes/Title';
import { EndScene } from './scenes/End';

export const calculateDemoMetadata: CalculateMetadataFunction<DemoProps> = ({ props }) => ({
  durationInFrames: totalFrames(props.edit),
  fps: props.edit.fps,
  width: props.edit.width,
  height: props.edit.height,
});

const SceneFor: React.FC<{ seg: Segment }> = ({ seg }) => {
  switch (seg.kind) {
    case 'hook':
      return <HookScene segment={seg} />;
    case 'title':
      return <TitleScene segment={seg} />;
    case 'clip':
      return <ClipScene segment={seg} />;
    case 'split':
      return <SplitScene segment={seg} />;
    case 'phone':
      return <PhoneScene segment={seg} />;
    case 'aws':
      return <AwsScene segment={seg} />;
    case 'end':
      return <EndScene segment={seg} />;
    default:
      return null;
  }
};

/**
 * Brings the incoming scene in over the previous one, which is still running underneath it.
 * fade: a soft cross-dissolve. blur: a blur/scale-through, the old scene is already going when the new one
 * settles in from a slight blur and scale.
 */
const TransitionIn: React.FC<{ kind: TransitionKind; frames: number; children: React.ReactNode }> = ({
  kind,
  frames,
  children,
}) => {
  const frame = useCurrentFrame();
  if (kind === 'cut' || frames <= 0) return <>{children}</>;
  const p = interpolate(frame, [0, frames], [0, 1], clamp);
  if (kind === 'fade') return <AbsoluteFill style={{ opacity: easeOut(p) }}>{children}</AbsoluteFill>;
  const e = easeOut(p);
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(p, [0.3, 1], [0, 1], clamp),
        transform: `scale(${1.035 - 0.035 * e})`,
        filter: p < 1 ? `blur(${(1 - e) * 12}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** The outgoing half of a blur/scale-through: from `startAt` the scene softens, grows a touch and fades out. */
const TransitionOut: React.FC<{ startAt: number; frames: number; children: React.ReactNode }> = ({
  startAt,
  frames,
  children,
}) => {
  const frame = useCurrentFrame();
  // always the same wrapper, so the scene underneath never remounts when the exit begins
  const p = interpolate(frame, [startAt, startAt + Math.max(1, frames)], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(p, [0, 0.7], [1, 0], clamp),
        transform: p > 0 ? `scale(${1 + 0.02 * easeOut(p)})` : undefined,
        filter: p > 0 ? `blur(${easeOut(p) * 10}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const FireJamDemo: React.FC<DemoProps> = ({ edit, broll, captions }) => {
  const { fps } = useVideoConfig();
  const placed = placeSegments(edit);
  const vo = edit.voiceover;
  const music = edit.music;
  const voStart = vo?.startAt ?? 0;
  const src = (path: string) => (/^https?:/.test(path) ? path : staticFile(path.replace(/^\/+/, '')));
  const quiet = placed
    .filter(({ seg }) => seg.captions === false)
    .map(({ from, frames }) => [from, from + frames] as [number, number]);

  return (
    <BrollContext.Provider value={broll}>
      <AbsoluteFill style={{ background: C.bg }}>
        {vo ? (
          <Sequence from={Math.round(voStart * fps)} name="voiceover" layout="none">
            <Audio src={src(vo.src)} trimBefore={Math.round((vo.in ?? 0) * fps)} volume={vo.volume ?? 1} />
          </Sequence>
        ) : null}

        {music ? (
          <Sequence from={Math.round((music.startAt ?? 0) * fps)} name="music" layout="none">
            <Audio
              src={src(music.src)}
              trimBefore={Math.round((music.in ?? 0) * fps)}
              volume={(f) => {
                // f counts from the music's own start; keys are on the film's timeline.
                const t = f / fps + (music.startAt ?? 0);
                const keys = music.volume;
                if (keys.length === 1) return keys[0].v;
                return interpolate(t, keys.map((k) => k.at), keys.map((k) => k.v), clamp);
              }}
            />
          </Sequence>
        ) : null}

        {placed.map(({ seg, from, frames, transition, overshoot, exit }) => (
          <Sequence
            key={seg.id}
            name={`${seg.kind}: ${seg.id}`}
            from={from}
            durationInFrames={frames + overshoot}
            premountFor={fps}
          >
            <TimeOffsetContext.Provider value={from}>
              <TransitionIn kind={transition.kind} frames={transition.frames}>
                {exit.kind === 'blur' ? (
                  <TransitionOut startAt={frames} frames={exit.frames}>
                    <SceneFor seg={seg} />
                  </TransitionOut>
                ) : (
                  <SceneFor seg={seg} />
                )}
              </TransitionIn>
            </TimeOffsetContext.Provider>
          </Sequence>
        ))}

        <Captions captions={captions} offsetMs={(voStart - (vo?.in ?? 0)) * 1000} quiet={quiet} />
      </AbsoluteFill>
    </BrollContext.Provider>
  );
};
