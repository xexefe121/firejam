import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { ClipSegment, Crop } from '../types';
import { MediaClip, resolveClip, resolveVolume, useBroll } from '../media';
import { Backdrop, CameraView, FloatingScreen, Headline } from '../ui';

// One screen, floating. The same area is used for every clip so dissolves between them stay calm.
// Above it: a small eyebrow (from y 98). The screen is 80% of the frame so the UI reads on a phone;
// the voiceover subtitles sit over its lower edge, where every capture is dark UI chrome or letterbox.
export const CLIP_W = 1536;
export const CLIP_H = 864;
const CLIP_CX = 960;
const CLIP_CY = 586; // the area spans y 154 to 1018

const clamp01 = (v: number) => Math.min(1, Math.max(0.02, v));

/** Fits a crop of the capture into the screen area, keeping the crop's own shape. */
export const clipSize = (crop: Crop | undefined, sourceAspect: number) => {
  if (!crop) return { w: CLIP_W, h: CLIP_H };
  const aspect = (clamp01(crop.w) * sourceAspect) / clamp01(crop.h);
  return aspect >= CLIP_W / CLIP_H
    ? { w: CLIP_W, h: Math.round(CLIP_W / aspect) }
    : { w: Math.round(CLIP_H * aspect), h: CLIP_H };
};

/** Shows only the `crop` part of what it contains: the content is sized and offset so the crop fills the box. */
const CropBox: React.FC<{ crop?: Crop; children: React.ReactNode }> = ({ crop, children }) => {
  if (!crop) return <>{children}</>;
  const w = clamp01(crop.w);
  const h = clamp01(crop.h);
  const x = Math.min(1 - w, Math.max(0, crop.x));
  const y = Math.min(1 - h, Math.max(0, crop.y));
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          width: `${100 / w}%`,
          height: `${100 / h}%`,
          left: `${(-100 * x) / w}%`,
          top: `${(-100 * y) / h}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const ClipScene: React.FC<{ segment: ClipSegment }> = ({ segment }) => {
  const { fps } = useVideoConfig();
  const broll = useBroll();
  const frames = Math.max(1, Math.round(segment.dur * fps));
  const volume = resolveVolume(segment.src, segment.audio?.volume);
  const info = resolveClip(broll, segment.src);
  const sourceAspect = info.width && info.height ? info.width / info.height : 16 / 9;
  const { w, h } = clipSize(segment.crop, sourceAspect);

  return (
    <AbsoluteFill>
      <Backdrop />
      <Headline text={segment.caption} eyebrow={segment.label} frames={frames} centerY={segment.caption ? 146 : 104} />
      <FloatingScreen cx={CLIP_CX} cy={CLIP_CY} width={w} height={h} frames={frames} float={0.022}>
        <CameraView keys={segment.camera} frames={frames} width={w} height={h} push={segment.crop ? 1.03 : 1.06}>
          <CropBox crop={segment.crop}>
            <MediaClip src={segment.src} from={segment.in} volume={volume} variant="full" />
          </CropBox>
        </CameraView>
      </FloatingScreen>
    </AbsoluteFill>
  );
};
