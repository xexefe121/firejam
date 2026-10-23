import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { PhoneSegment } from '../types';
import { MediaClip, resolveVolume } from '../media';
import { PhoneFrame, TvFrame, phoneOuterHeight, phoneOuterWidth, tvOuterHeight, tvOuterWidth } from '../devices';
import { C, FONT_DISPLAY } from '../theme';
import { Backdrop, CameraView, Headline, clamp, easeInOut, useEnter } from '../ui';

// The TV carries the story (about 72% of the frame width) and the phone stands in front of its right edge.
// Both are centred on one line, above the subtitle lane (subtitles start near y 938).
const TV_SCREEN_W = 1366;
const TV_SCREEN_H = 768; // 16:9
const PHONE_SCREEN_H = 840;
const PHONE_SCREEN_W = Math.round((PHONE_SCREEN_H * 780) / 1688); // keeps the 780x1688 source ratio
const OVERLAP = 96; // how far the phone reaches over the TV
const CENTER_Y = 484;
// With a headline there is less room, so the whole pair shrinks and sits lower.
const HEADLINE_FIT = { scale: 0.74, centerY: 556 };

const tvW = tvOuterWidth(TV_SCREEN_W);
const phoneW = phoneOuterWidth(PHONE_SCREEN_W);
const groupW = tvW + phoneW - OVERLAP;
const TV_LEFT = Math.round((1920 - groupW) / 2);
const PHONE_LEFT = TV_LEFT + tvW - OVERLAP;
const TV_TOP = Math.round(CENTER_Y - tvOuterHeight(TV_SCREEN_H) / 2);
const PHONE_TOP = Math.round(CENTER_Y - phoneOuterHeight(PHONE_SCREEN_H) / 2);

const Label: React.FC<{ text: string; left: number; width: number; top: number; progress: number }> = ({
  text,
  left,
  width,
  top,
  progress,
}) => (
  <div
    style={{
      position: 'absolute',
      left,
      width,
      top,
      textAlign: 'center',
      fontFamily: FONT_DISPLAY,
      fontWeight: 500,
      fontSize: 21,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: C.muted,
      opacity: progress,
    }}
  >
    {text}
  </div>
);

export const PhoneScene: React.FC<{ segment: PhoneSegment }> = ({ segment }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const frames = Math.max(1, Math.round(segment.dur * fps));
  const tvIn = useEnter(0, 36);
  const phoneIn = useEnter(12, 38);
  const labelIn = useEnter(18, 28);
  const prog = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: easeInOut });

  const tvVol = resolveVolume(segment.tv.src, segment.tv.audio?.volume, segment.audio?.volume);
  const phoneVol = resolveVolume(segment.phone.src, segment.phone.audio?.volume);

  const fitStyle: React.CSSProperties = segment.caption
    ? {
        transformOrigin: `960px ${CENTER_Y}px`,
        transform: `translateY(${HEADLINE_FIT.centerY - CENTER_Y}px) scale(${HEADLINE_FIT.scale})`,
      }
    : {};

  return (
    <AbsoluteFill>
      <Backdrop drift={prog} />
      <Headline text={segment.caption} frames={frames} />

      {/* parallax: the phone drifts a little more than the TV, the backdrop glow moves against both */}
      <div style={{ position: 'absolute', inset: 0, ...fitStyle }}>
      <div
        style={{
          position: 'absolute',
          left: TV_LEFT,
          top: TV_TOP,
          opacity: Math.min(1, tvIn * 2.2),
          transformOrigin: '50% 60%',
          transform: `translateY(${(1 - tvIn) * 26 - prog * 8}px) scale(${(0.97 + tvIn * 0.03) * (1 + 0.02 * prog)})`,
        }}
      >
        <TvFrame screenW={TV_SCREEN_W} screenH={TV_SCREEN_H}>
          <CameraView
            keys={segment.tv.camera ?? segment.camera}
            frames={frames}
            width={TV_SCREEN_W}
            height={TV_SCREEN_H}
            push={1.05}
          >
            <MediaClip src={segment.tv.src} from={segment.tv.in} volume={tvVol} variant="full" />
          </CameraView>
        </TvFrame>
      </div>

      <div
        style={{
          position: 'absolute',
          left: PHONE_LEFT,
          top: PHONE_TOP,
          opacity: Math.min(1, phoneIn * 2.2),
          transformOrigin: '50% 60%',
          transform: `translate(${prog * -10}px, ${(1 - phoneIn) * 46 - prog * 18}px) scale(${(0.96 + phoneIn * 0.04) * (1 + 0.03 * prog)})`,
        }}
      >
        <PhoneFrame screenW={PHONE_SCREEN_W} screenH={PHONE_SCREEN_H}>
          <CameraView
            keys={segment.phone.camera}
            frames={frames}
            width={PHONE_SCREEN_W}
            height={PHONE_SCREEN_H}
            push={1}
          >
            <MediaClip src={segment.phone.src} from={segment.phone.in} volume={phoneVol} variant="phone" />
          </CameraView>
        </PhoneFrame>
      </div>

      {segment.tv.label ? (
        <Label text={segment.tv.label} left={TV_LEFT} width={tvW - OVERLAP} top={TV_TOP - 44} progress={labelIn} />
      ) : null}
      {segment.phone.label ? (
        <Label text={segment.phone.label} left={PHONE_LEFT} width={phoneW} top={PHONE_TOP - 44} progress={labelIn} />
      ) : null}
      </div>
    </AbsoluteFill>
  );
};
